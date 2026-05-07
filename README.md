# 方舟生存飞升私服开服器

一个无需登录的本机 Web 管理面板，用于管理多个 ARK: Survival Ascended 私服实例。数据使用 JSON 文件保存，页面全部中文显示，INI 配置项以中文展示并按原始 key 写回游戏配置文件。

## 运行

```bash
node src/server.js
```

默认监听：

```text
http://127.0.0.1:3050
```

如果使用 Codex 打包 Node：

```bash
/mnt/c/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe src/server.js
```

## 数据目录

- `data/app.json`：全局设置
- `data/instances/*.json`：私服实例配置
- `data/runtime.json`：运行状态

## 功能

- 多实例管理
- SteamCMD 安装/更新 ASA Dedicated Server，AppID `2430930`
- Mod ID 列表管理
- 启动、停止、重启
- 中文结构化 INI 配置管理
- 自定义 INI 配置项
- 启动前同步 `GameUserSettings.ini` 和 `Game.ini`
- 原始 INI 导入/导出

## 测试

```bash
node --test
```
