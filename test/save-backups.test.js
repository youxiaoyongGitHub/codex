import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSaveBackup,
  backupRootForInstance,
  listSaveBackups,
  restoreSaveBackup,
  saveDirForInstance,
} from "../src/save-backups.js";

test("存档备份和恢复会复制地图存档目录", async () => {
  const instance = { id: `backup-test-${Date.now()}`, name: "备份测试", map: "TheIsland_WP" };
  const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "asa-backup-"));
  const saveDir = saveDirForInstance(instance, installDir);
  await fs.mkdir(saveDir, { recursive: true });
  await fs.writeFile(path.join(saveDir, "TheIsland_WP.ark"), "original", "utf8");

  const backup = await createSaveBackup(instance, installDir);
  await fs.writeFile(path.join(saveDir, "TheIsland_WP.ark"), "changed", "utf8");
  const restored = await restoreSaveBackup(instance, installDir, backup.id);
  const content = await fs.readFile(path.join(saveDir, "TheIsland_WP.ark"), "utf8");
  const backups = await listSaveBackups(instance);

  assert.equal(content, "original");
  assert.equal(restored.restoredFrom, backup.id);
  assert.ok(restored.safetyBackup.id.startsWith("restore-before-"));
  assert.ok(backups.some((item) => item.id === backup.id));

  await fs.rm(installDir, { recursive: true, force: true });
  await fs.rm(backupRootForInstance(instance.id), { recursive: true, force: true });
});
