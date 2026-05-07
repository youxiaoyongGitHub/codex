import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  deleteInstance,
  instanceFile,
  saveInstance,
  saveRuntime,
} from "../src/storage.js";

test("删除实例可选删除实例数据目录并清理运行态", async () => {
  const id = `delete-test-${Date.now()}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "asa-delete-"));
  await fs.writeFile(path.join(dataDir, "marker.txt"), "data", "utf8");

  await saveInstance({ id, name: "删除测试", createdAt: new Date().toISOString() });
  await saveRuntime({ instances: { [id]: { status: "已停止", pid: null } } });

  const deleted = await deleteInstance(id, { deleteData: true, installDir: dataDir });

  await assert.rejects(fs.stat(instanceFile(id)));
  await assert.rejects(fs.stat(dataDir));
  assert.equal(deleted.runtime, true);
  assert.equal(deleted.dataDir, dataDir);
});
