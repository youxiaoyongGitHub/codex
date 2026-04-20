#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HTML_TEMPLATE = """<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>{name}</title>
    <link rel="stylesheet" href="/static/app.css">
    <script src="/static/app.js"></script>
  </head>
  <body>
    <h1>{name}</h1>
    <a id="login-link" href="/login">login</a>
    <form method="post" action="/submit">
      <input name="q" value="{name}">
      <button type="submit">submit</button>
    </form>
    <img src="/static/logo.png" alt="logo">
    <div id="api-endpoint">/api/ping</div>
  </body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = "E2ETestService/1.0"

    def do_GET(self) -> None:
        if self.path == "/":
            body = HTML_TEMPLATE.format(name=self.server.app_name).encode("utf-8")
            self._send(HTTPStatus.OK, body, "text/html; charset=utf-8")
            return
        if self.path == "/login":
            body = json.dumps(
                {"service": self.server.app_name, "path": "/login"},
                ensure_ascii=False,
            ).encode("utf-8")
            self._send(HTTPStatus.OK, body, "application/json; charset=utf-8")
            return
        if self.path == "/redirect":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/login")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/static/app.css":
            body = b'body{background:url(/static/bg.png)}'
            self._send(HTTPStatus.OK, body, "text/css; charset=utf-8")
            return
        if self.path == "/static/app.js":
            body = b'window.__PING__="/api/ping";'
            self._send(HTTPStatus.OK, body, "application/javascript; charset=utf-8")
            return
        if self.path == "/static/logo.png":
            body = b"PNG"
            self._send(HTTPStatus.OK, body, "image/png")
            return
        if self.path == "/api/ping":
            body = json.dumps(
                {"service": self.server.app_name, "path": "/api/ping"},
                ensure_ascii=False,
            ).encode("utf-8")
            self._send(HTTPStatus.OK, body, "application/json; charset=utf-8")
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if self.path == "/submit":
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            payload = json.dumps(
                {
                    "service": self.server.app_name,
                    "path": "/submit",
                    "body": body.decode("utf-8", errors="replace"),
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self._send(HTTPStatus.OK, payload, "application/json; charset=utf-8")
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args) -> None:
        return

    def _send(self, status: HTTPStatus, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--name", required=True)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.app_name = args.name
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
