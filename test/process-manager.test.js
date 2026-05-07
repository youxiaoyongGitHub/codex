import test from "node:test";
import assert from "node:assert/strict";
import { buildLaunchArgs, buildSteamcmdInstallArgs, isProcessAlive, splitExtraArgs } from "../src/process-manager.js";

test("启动参数包含地图、端口、Mod 和中文配置对应的原始值", () => {
  const args = buildLaunchArgs({
    name: "测试服",
    map: "TheIsland_WP",
    ports: { game: 7777, query: 27015, rcon: 27020 },
    mods: ["928501", "123456"],
    launch: { battleEye: false, extraArgs: "-NoTransferFromFiltering" },
    config: {
      SessionName: "中文测试服",
      MaxPlayers: 20,
      ServerAdminPassword: "admin",
      RCONEnabled: true,
    },
  });
  assert.match(args[0], /^TheIsland_WP\?/);
  assert.match(args[0], /Port=7777/);
  assert.match(args[0], /QueryPort=27015/);
  assert.ok(args.includes("-mods=928501,123456"));
  assert.ok(args.includes("-NoBattlEye"));
  assert.ok(args.includes("-NoTransferFromFiltering"));
});

test("启动参数保留中文服务器名称", () => {
  const args = buildLaunchArgs({
    name: "孤岛测试服",
    map: "TheIsland_WP",
    ports: { game: 7777, query: 27015, rcon: 27020 },
    mods: [],
    launch: {},
    config: {},
  });
  assert.match(args[0], /SessionName=孤岛测试服/);
  assert.doesNotMatch(args[0], /%E5/);
});

test("额外启动参数支持带引号参数", () => {
  assert.deepEqual(splitExtraArgs('-foo "bar baz" -flag'), ["-foo", "bar baz", "-flag"]);
});

test("未设置地图时使用默认 ASA 地图启动名", () => {
  const args = buildLaunchArgs({
    name: "默认地图测试",
    ports: { game: 7777, query: 27015, rcon: 27020 },
    mods: [],
    launch: {},
    config: {},
  });
  assert.match(args[0], /^TheIsland_WP\?/);
});

test("SteamCMD 安装参数强制使用 Windows 平台", () => {
  const args = buildSteamcmdInstallArgs("D:\\ArkServers\\Island");
  assert.deepEqual(args.slice(0, 2), ["+@sSteamCmdForcePlatformType", "windows"]);
  assert.ok(args.includes("+force_install_dir"));
  assert.ok(args.includes("2430930"));
  assert.ok(args.includes("validate"));
});

test("不存在的 PID 不会被识别为运行中", () => {
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(99999999), false);
});
