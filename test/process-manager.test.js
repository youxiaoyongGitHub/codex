import test from "node:test";
import assert from "node:assert/strict";
import { buildLaunchArgs, buildSteamcmdInstallArgs, isProcessAlive, normalizeModIds, splitExtraArgs } from "../src/process-manager.js";

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
  assert.ok(args.includes("-culture=zh-Hans-CN"));
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

test("加入集群的启动参数包含集群 ID 和共享目录", () => {
  const args = buildLaunchArgs(
    {
      name: "集群服",
      map: "TheIsland_WP",
      ports: { game: 7777, query: 27015, rcon: 27020 },
      mods: [],
      launch: {},
      config: {},
    },
    { arkClusterId: "asa-test", clusterDir: "D:\\ArkClusters\\asa-test" },
  );
  assert.ok(args.includes("-clusterid=asa-test"));
  assert.ok(args.includes("-ClusterDirOverride=D:\\ArkClusters\\asa-test"));
  assert.ok(!args.includes("-NoTransferFromFiltering"));
});

test("未加入集群时启动参数保持单实例行为", () => {
  const args = buildLaunchArgs({
    name: "单服",
    map: "TheIsland_WP",
    ports: { game: 7777, query: 27015, rcon: 27020 },
    mods: [],
    launch: {},
    config: {},
  });
  assert.equal(args.some((item) => item.startsWith("-clusterid=")), false);
  assert.equal(args.some((item) => item.startsWith("-ClusterDirOverride=")), false);
});

test("额外启动参数支持带引号参数", () => {
  assert.deepEqual(splitExtraArgs('-foo "bar baz" -flag'), ["-foo", "bar baz", "-flag"]);
});

test("Mod 启动参数只使用原始 ID，中文显示名不影响启动", () => {
  assert.deepEqual(normalizeModIds([{ id: "928501", displayNameZh: "中文模组" }, "123456"]), ["928501", "123456"]);
});

test("服务器语言可关闭为服务端默认", () => {
  const args = buildLaunchArgs({
    name: "默认语言测试",
    map: "TheIsland_WP",
    ports: { game: 7777, query: 27015, rcon: 27020 },
    mods: [],
    launch: { culture: "default" },
    config: {},
  });
  assert.equal(args.some((item) => item.startsWith("-culture=")), false);
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
