#!/usr/bin/env python3
"""Prefix-based reverse proxy for multiple FRP-exposed intranet services.

This server listens on one public HTTP port and forwards requests according to
URL path prefixes. Each prefix can target a different local FRP port, which in
turn may belong to a different FRP client / intranet.
"""

from __future__ import annotations

import argparse
import html
import json
import posixpath
import re
import socket
import sys
import threading
from dataclasses import dataclass
from http import HTTPStatus
from http.client import HTTPConnection, HTTPResponse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit


HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

REWRITE_TEXT_TYPES = (
    "text/html",
    "text/css",
    "application/javascript",
    "application/x-javascript",
    "text/javascript",
    "application/json",
)


@dataclass(frozen=True)
class Route:
    prefix: str
    target_host: str
    target_port: int
    strip_prefix: bool = True

    @property
    def normalized_prefix(self) -> str:
        prefix = self.prefix.strip()
        if not prefix.startswith("/"):
            prefix = "/" + prefix
        prefix = prefix.rstrip("/")
        return prefix or "/"


def load_routes(config_path: Path) -> List[Route]:
    with config_path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    routes = []
    for item in raw.get("routes", []):
        route = Route(
            prefix=item["prefix"],
            target_host=item.get("target_host", "127.0.0.1"),
            target_port=int(item["target_port"]),
            strip_prefix=bool(item.get("strip_prefix", True)),
        )
        routes.append(route)

    routes.sort(key=lambda r: len(r.normalized_prefix), reverse=True)
    return routes


def join_url_path(base_path: str, suffix_path: str) -> str:
    if not base_path.endswith("/"):
        base_path += "/"
    joined = posixpath.normpath(base_path + suffix_path.lstrip("/"))
    if suffix_path.endswith("/") and not joined.endswith("/"):
        joined += "/"
    if not joined.startswith("/"):
        joined = "/" + joined
    return joined


def build_upstream_path(route: Route, incoming_path: str, query: str) -> str:
    prefix = route.normalized_prefix
    suffix = incoming_path[len(prefix):] if incoming_path.startswith(prefix) else incoming_path
    if route.strip_prefix:
        upstream_path = suffix or "/"
    else:
        upstream_path = incoming_path
    if not upstream_path.startswith("/"):
        upstream_path = "/" + upstream_path
    return upstream_path + (("?" + query) if query else "")


def match_route(path: str, routes: Iterable[Route]) -> Optional[Route]:
    for route in routes:
        prefix = route.normalized_prefix
        if prefix == "/":
            return route
        if path == prefix or path.startswith(prefix + "/"):
            return route
    return None


def rewrite_location(location: str, route: Route) -> str:
    parts = urlsplit(location)
    prefix = route.normalized_prefix

    if parts.scheme or parts.netloc:
        upstream_netloc = f"{route.target_host}:{route.target_port}"
        if parts.netloc != upstream_netloc:
            return location
        new_path = prefix if parts.path in ("", "/") else join_url_path(prefix, parts.path)
        return urlunsplit(("", "", new_path, parts.query, parts.fragment))

    if location.startswith("/"):
        new_path = prefix if location == "/" else join_url_path(prefix, location)
        return urlunsplit(("", "", new_path, parts.query, parts.fragment))

    return location


def rewrite_body(body: bytes, content_type: str, route: Route) -> bytes:
    lowered = content_type.lower()
    if not any(token in lowered for token in REWRITE_TEXT_TYPES):
        return body

    charset_match = re.search(r"charset=([^\s;]+)", lowered)
    encoding = charset_match.group(1) if charset_match else "utf-8"
    try:
        text = body.decode(encoding, errors="replace")
    except LookupError:
        text = body.decode("utf-8", errors="replace")
        encoding = "utf-8"

    prefix = route.normalized_prefix
    if prefix == "/":
        return body

    replacements = [
        (r'(?P<attr>\b(?:href|src|action|data|poster)=["\'])/(?!/)', rf"\g<attr>{prefix}/"),
        (r'(?P<attr>\b(?:href|src|action|data|poster)=["\'])' + re.escape(prefix) + r"/", rf"\g<attr>{prefix}/"),
        (r'(?P<css>\burl\(["\']?)/(?!/)', rf"\g<css>{prefix}/"),
        (r'(?P<json>["\'])/(api|static|assets|js|css|img|images|fonts|favicon)', rf"\g<json>{prefix}/\2"),
    ]
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text)

    base_tag = f'<base href="{html.escape(prefix + "/")}">'
    if "<head>" in text and "<base " not in text:
        text = text.replace("<head>", "<head>" + base_tag, 1)

    return text.encode(encoding, errors="replace")


class ProxyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "PrefixProxy/1.0"

    def do_GET(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()

    def do_PUT(self) -> None:
        self._handle()

    def do_PATCH(self) -> None:
        self._handle()

    def do_DELETE(self) -> None:
        self._handle()

    def do_HEAD(self) -> None:
        self._handle()

    def do_OPTIONS(self) -> None:
        self._handle()

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write(
            "[%s] %s - %s\n"
            % (threading.current_thread().name, self.address_string(), fmt % args)
        )

    def _handle(self) -> None:
        parsed = urlsplit(self.path)
        route = match_route(parsed.path, self.server.routes)
        if route is None:
            self._send_json_error(
                HTTPStatus.NOT_FOUND,
                {
                    "error": "route_not_found",
                    "path": parsed.path,
                    "known_prefixes": [r.normalized_prefix for r in self.server.routes],
                },
            )
            return

        body = self._read_request_body()
        upstream_path = build_upstream_path(route, parsed.path, parsed.query)
        upstream_headers = self._build_upstream_headers(route)

        try:
            response = self._forward(route, upstream_path, upstream_headers, body)
        except (ConnectionError, OSError, socket.timeout) as exc:
            self._send_json_error(
                HTTPStatus.BAD_GATEWAY,
                {
                    "error": "upstream_unreachable",
                    "prefix": route.normalized_prefix,
                    "target": f"{route.target_host}:{route.target_port}",
                    "detail": str(exc),
                },
            )
            return

        try:
            self._relay_response(route, response)
        finally:
            response.close()

    def _read_request_body(self) -> bytes:
        length = self.headers.get("Content-Length")
        if not length:
            return b""
        return self.rfile.read(int(length))

    def _build_upstream_headers(self, route: Route) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        for key, value in self.headers.items():
            if key.lower() in HOP_BY_HOP_HEADERS:
                continue
            if key.lower() == "host":
                headers[key] = f"{route.target_host}:{route.target_port}"
                continue
            headers[key] = value

        original_host = self.headers.get("Host", "")
        client_ip = self.client_address[0]
        forwarded_for = self.headers.get("X-Forwarded-For")
        if forwarded_for:
            headers["X-Forwarded-For"] = f"{forwarded_for}, {client_ip}"
        else:
            headers["X-Forwarded-For"] = client_ip
        headers["X-Forwarded-Host"] = original_host
        headers["X-Forwarded-Proto"] = "http"
        headers["X-Forwarded-Prefix"] = route.normalized_prefix
        return headers

    def _forward(
        self,
        route: Route,
        upstream_path: str,
        headers: Dict[str, str],
        body: bytes,
    ) -> HTTPResponse:
        conn = HTTPConnection(route.target_host, route.target_port, timeout=self.server.timeout_seconds)
        conn.request(self.command, upstream_path, body=body, headers=headers)
        return conn.getresponse()

    def _relay_response(self, route: Route, response: HTTPResponse) -> None:
        raw_body = response.read()
        content_type = response.getheader("Content-Type", "")
        body = rewrite_body(raw_body, content_type, route)

        self.send_response(response.status, response.reason)
        for key, value in response.getheaders():
            lower = key.lower()
            if lower in HOP_BY_HOP_HEADERS:
                continue
            if lower == "location":
                value = rewrite_location(value, route)
            if lower == "content-length":
                continue
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()

        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json_error(self, status: HTTPStatus, payload: Dict[str, object]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ProxyHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: Tuple[str, int],
        routes: List[Route],
        timeout_seconds: float,
    ) -> None:
        super().__init__(server_address, ProxyHandler)
        self.routes = routes
        self.timeout_seconds = timeout_seconds


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prefix-based reverse proxy for FRP services")
    parser.add_argument("--host", default="0.0.0.0", help="Listen host")
    parser.add_argument("--port", type=int, default=8080, help="Listen port")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("routes.json"),
        help="Route config path",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        help="Upstream timeout in seconds",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    routes = load_routes(args.config)
    if not routes:
        print(f"No routes found in {args.config}", file=sys.stderr)
        return 1

    print("Loaded routes:")
    for route in routes:
        print(
            f"  {route.normalized_prefix} -> {route.target_host}:{route.target_port}"
            f" (strip_prefix={route.strip_prefix})"
        )

    server = ProxyHTTPServer((args.host, args.port), routes, args.timeout)
    print(f"Listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
