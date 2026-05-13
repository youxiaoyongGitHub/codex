import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importSingleplayerInstance, inferMapFromSaveDir, singleplayerCandidates } from "../src/singleplayer-import.js";
import { instanceFile } from "../src/storage.js";

test("单机导入会复制存档和可选 INI 配置", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asa-sp-import-"));
  const saveDir = path.join(root, "TheIsland_WP");
  const configDir = path.join(root, "Config");
  await fs.mkdir(saveDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(path.join(saveDir, "TheIsland_WP.ark"), "save", "utf8");
  await fs.writeFile(path.join(configDir, "Game.ini"), "[/Script/ShooterGame.ShooterGameMode]\n", "utf8");

  const result = await importSingleplayerInstance(
    { defaultInstallRoot: path.join(root, "servers") },
    { name: "导入测试", map: "TheIsland_WP", saveDir, configDir },
  );
  const importedSave = await fs.readFile(path.join(result.targetSaveDir, "TheIsland_WP.ark"), "utf8");

  assert.equal(importedSave, "save");
  assert.equal(result.instance.map, "TheIsland_WP");
  assert.equal(result.copiedConfigs.length, 1);

  await fs.rm(instanceFile(result.instance.id), { force: true });
  await fs.rm(root, { recursive: true, force: true });
});

test("单机导入候选路径和地图推断结构稳定", () => {
  const candidates = singleplayerCandidates();
  assert.ok(Array.isArray(candidates.saveDirs));
  assert.ok(Array.isArray(candidates.configDirs));
  assert.equal(inferMapFromSaveDir("C:\\SavedArksLocal\\Astraeos_WP"), "Astraeos_WP");
});
