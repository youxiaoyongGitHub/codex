# frp + Nginx 路径前缀反向代理

这个方案用于在同一个公网域名下，通过 URL 路径前缀暴露多个内网服务。每个路径前缀可以指向不同 `frpc` 客户端映射到公网机上的不同端口，因此支持多个不同内网。

## 能力

- 同一公网域名，多个路径前缀映射多个内网服务
- 支持多个不同内网客户端，各自映射到不同 FRP 端口
- 自动修复常见绝对路径和重定向问题
- Nginx 原生高并发，不会因单个请求阻塞整体

## 架构

1. 公网服务器运行 `frps`
2. 每个内网运行自己的 `frpc`
3. 每个 `frpc` 把内网服务映射到公网服务器本地不同端口
4. 公网服务器运行 `Nginx`
5. Nginx 按路径前缀转发

```text
http://your-domain/oa/...   -> Nginx -> 127.0.0.1:6001 -> client-a OA
http://your-domain/crm/...  -> Nginx -> 127.0.0.1:6002 -> client-b CRM
http://your-domain/docs/... -> Nginx -> 127.0.0.1:6003 -> client-b Docs
```

## 文件说明

- `nginx.conf`: 主 Nginx 路径前缀反向代理配置
- `nginx-proxy-common.inc`: Nginx 公共代理头配置片段
- `frps.toml`: FRP 服务端示例配置
- `frpc-client-a.toml`: 客户端 A 示例
- `frpc-client-b.toml`: 客户端 B 示例
- `TESTING.md`: 完整联调测试文档
- `e2e-frps.toml`: 本地联调用 FRP 服务端配置
- `e2e-frpc-a.toml`: 本地联调内网 A 配置
- `e2e-frpc-b.toml`: 本地联调内网 B 配置
- `e2e-nginx.conf`: 本地联调用 Nginx 配置
- `e2e_test_service.py`: 本地联调测试服务
- `proxy_server.py`: 早期 Python 反向代理原型，保留作参考
- `routes.json`: Python 原型的示例路由配置

## 快速开始

### 1. 启动 frps

```bash
frps -c frps.toml
```

### 2. 在不同内网启动 frpc

客户端 A:

```bash
frpc -c frpc-client-a.toml
```

客户端 B:

```bash
frpc -c frpc-client-b.toml
```

### 3. 启动 Nginx

```bash
nginx -c /home/youxy/codex/code/nginx.conf
```

如果你要重载配置：

```bash
nginx -s reload -c /home/youxy/codex/code/nginx.conf
```

### 4. 访问

```text
http://your-domain/oa/
http://your-domain/crm/
http://your-domain/docs/
```

## 核心映射

`nginx.conf` 中的关键配置如下：

```nginx
location /oa/ {
    proxy_pass http://127.0.0.1:6001/;
}
```

这表示：

- 外部访问 `/oa/...`
- Nginx 去掉 `/oa/` 前缀后，转发到 `127.0.0.1:6001`
- `6001` 对应某个 `frpc` 暴露出来的内网服务

`/crm/` 和 `/docs/` 同理。

## 绝对路径修复

很多旧系统部署在根路径时，会返回这些内容：

- `href="/static/app.js"`
- `src="/assets/logo.png"`
- `action="/login"`
- `Location: /dashboard`

当前 Nginx 配置通过以下方式修复：

- `proxy_redirect` 修复响应头中的重定向地址
- `sub_filter` 修复 HTML/CSS/JS/JSON 中常见的绝对路径
- `X-Forwarded-Prefix` 透传给上游服务，方便支持前缀部署的应用自行识别
- `Accept-Encoding` 置空，避免上游压缩响应后导致 `sub_filter` 无法生效
- 额外覆盖 `"/api"`、`'/api'` 这类 JS/JSON 字符串形式的根路径

注意：

- `sub_filter` 只能覆盖常见文本场景，不是万能方案
- 如果前端运行时通过 JS 动态拼接绝对路径，例如 `fetch("/api/" + x)`，仍可能需要应用自身支持 `basePath`
- 最稳妥的方式仍然是目标服务支持前缀部署

## 并发说明

Nginx 使用事件驱动模型处理高并发连接，适合做统一入口网关。和简单单线程脚本相比，更适合生产环境。

## 生产建议

- 把 `server_name your-domain.example.com;` 改成你的真实域名
- 如果要上 HTTPS，增加 `listen 443 ssl;` 和证书配置
- `frps.toml` 与所有 `frpc` 使用同一个强 `token`
- 防火墙只开放 80/443 和必要的 `frps` 端口
- 新增更多内网服务时，继续新增 `frpc` 远端端口和对应 `location` 即可

## 测试文档

完整的本地联调步骤、测试目的和验证结果见 [TESTING.md](/home/youxy/codex/code/TESTING.md:1)。
