# 联调测试文档

本文档用于说明如何在一台机器上模拟以下三类角色，并对整个 `frp + Nginx` 方案做端到端验证：

- 公网服务端：`frps`
- 内网 A：一个 `frpc`，承载 `oa`
- 内网 B：一个 `frpc`，承载 `crm` 和 `docs`

## 测试目标

- 验证不同 `frpc` 客户端可同时连接到同一台 `frps`
- 验证同一公网入口可按路径前缀分发到不同内网服务
- 验证重定向与常见绝对路径修复是否生效
- 验证 GET、POST 和并发访问是否正常

## 测试文件

- `e2e-frps.toml`
- `e2e-frpc-a.toml`
- `e2e-frpc-b.toml`
- `e2e-nginx.conf`
- `e2e_test_service.py`

这些文件不会影响生产配置，只用于本地联调。

## 前置条件

- 已安装 `nginx`
- 能访问官方 `frp` GitHub 发布页，或已提前下载好 `frps`、`frpc`
- 当前工作目录为项目根目录

## 下载 frp

以 Linux x86_64 为例：

```bash
curl -L https://github.com/fatedier/frp/releases/download/v0.68.1/frp_0.68.1_linux_amd64.tar.gz -o /tmp/frp_0.68.1_linux_amd64.tar.gz
tar -xzf /tmp/frp_0.68.1_linux_amd64.tar.gz -C /tmp
```

解压后可执行文件路径：

```text
/tmp/frp_0.68.1_linux_amd64/frps
/tmp/frp_0.68.1_linux_amd64/frpc
```

## 测试拓扑

```text
curl -> Nginx(:18080)
        /oa/   -> frp remote port 16001 -> frpc-a -> oa service(:18081)
        /crm/  -> frp remote port 16002 -> frpc-b -> crm service(:18082)
        /docs/ -> frp remote port 16003 -> frpc-b -> docs service(:18083)
```

## 启动顺序

### 1. 启动三个测试服务

```bash
python3 e2e_test_service.py --port 18081 --name oa
python3 e2e_test_service.py --port 18082 --name crm
python3 e2e_test_service.py --port 18083 --name docs
```

### 2. 启动 frps

```bash
/tmp/frp_0.68.1_linux_amd64/frps -c e2e-frps.toml
```

### 3. 启动 frpc 客户端

内网 A:

```bash
/tmp/frp_0.68.1_linux_amd64/frpc -c e2e-frpc-a.toml
```

内网 B:

```bash
/tmp/frp_0.68.1_linux_amd64/frpc -c e2e-frpc-b.toml
```

### 4. 校验 Nginx 配置并启动

```bash
nginx -t -c /home/youxy/codex/code/e2e-nginx.conf
nginx -c /home/youxy/codex/code/e2e-nginx.conf -g 'daemon off;'
```

## 功能验证

### 1. 首页路由验证

```bash
curl -i http://127.0.0.1:18080/oa/
curl -i http://127.0.0.1:18080/crm/
curl -i http://127.0.0.1:18080/docs/
```

预期：

- 三个请求都返回 `200`
- 页面标题分别为 `oa`、`crm`、`docs`
- HTML 中的静态资源和表单路径已经被改写为带前缀的路径

### 2. 重定向修复验证

```bash
curl -i http://127.0.0.1:18080/oa/redirect
```

预期：

- 返回 `302`
- `Location` 为带 `/oa` 前缀的地址

### 3. 静态资源重写验证

```bash
curl -i http://127.0.0.1:18080/crm/static/app.css
curl -i http://127.0.0.1:18080/oa/static/app.js
```

预期：

- CSS 中的 `url(/...)` 被改写为 `url(/crm/...)`
- JS 中的 `"/api/ping"` 被改写为 `"/oa/api/ping"`

### 4. POST 请求穿透验证

```bash
curl -i -X POST http://127.0.0.1:18080/docs/submit -d 'q=docs-test'
```

预期：

- 返回 `200`
- 响应体中可看到请求已到达 `docs` 服务

### 5. 直接验证 frp 映射端口

```bash
curl -i http://127.0.0.1:16001/
```

预期：

- 直接访问到 `oa` 服务原始页面
- 页面内容仍然是根路径版本，说明前缀重写是在 Nginx 层完成

### 6. 并发验证

```bash
python3 - <<'PY'
import concurrent.futures, urllib.request
urls = [
    'http://127.0.0.1:18080/oa/',
    'http://127.0.0.1:18080/crm/',
    'http://127.0.0.1:18080/docs/',
] * 10

def fetch(url):
    with urllib.request.urlopen(url, timeout=5) as resp:
        body = resp.read().decode('utf-8', errors='replace')
        return resp.status, body

with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
    results = list(ex.map(fetch, urls))

ok = sum(1 for status, _ in results if status == 200)
print(f'concurrent_ok={ok}/{len(results)}')
PY
```

预期：

- 输出 `concurrent_ok=30/30`

## 本项目已完成的实测结论

本项目实际完成过以下联调：

- `nginx -t` 通过
- `frps` 正常启动
- 两个 `frpc` 同时登录到同一个 `frps`
- `/oa/`、`/crm/`、`/docs/` 三条路径全部可用
- `proxy_redirect` 重写成功
- `sub_filter` 对 HTML、CSS、JS 中常见根路径生效
- POST 请求可正常穿透
- 并发测试 `30/30` 成功

## 已知边界

- `sub_filter` 适合常见文本替换，但不是前端框架通用方案
- 如果目标系统大量使用运行时动态拼接绝对路径，最好还是由应用自身支持 `basePath`
- 如果业务依赖 WebSocket、SSE 或更复杂的鉴权头，建议按具体系统再补专项验证
