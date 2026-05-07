import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  defaultSteamcmdInstallDir,
  findSteamcmd,
  steamcmdExecutableForDir,
  STEAMCMD_DOWNLOAD_URL,
} from "../src/steamcmd.js";

test("SteamCMD 自动查找返回稳定结构", async () => {
  const result = await findSteamcmd();
  assert.equal(typeof result.found, "boolean");
  assert.equal(typeof result.bestPath, "string");
  assert.ok(Array.isArray(result.matches));
  assert.equal(typeof result.searched, "number");
});

test("SteamCMD 安装路径和可执行文件路径可预测", () => {
  assert.match(STEAMCMD_DOWNLOAD_URL, /^https:\/\/.+steamcmd\.zip$/);
  const root = path.join("D:", "ArkServers");
  const installDir = defaultSteamcmdInstallDir({ defaultInstallRoot: root });
  assert.equal(installDir, path.join(root, "steamcmd"));
  assert.equal(steamcmdExecutableForDir(installDir), path.join(installDir, "steamcmd.exe"));
});
