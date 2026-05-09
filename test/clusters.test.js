import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  addInstanceToCluster,
  clusterFile,
  createCluster,
  deleteCluster,
  ensureClusterRuntimeDir,
  readCluster,
  removeInstanceFromCluster,
} from "../src/clusters.js";
import { instanceFile, readInstance, saveInstance } from "../src/storage.js";

test("集群 JSON 创建、读取、更新成员和删除", async () => {
  const instanceId = `cluster-instance-${Date.now()}`;
  await saveInstance({ id: instanceId, name: "集群成员", map: "TheIsland_WP", createdAt: new Date().toISOString() });

  const cluster = await createCluster({ name: "测试集群" });
  assert.equal(cluster.name, "测试集群");
  assert.ok(cluster.arkClusterId.startsWith("asa-"));

  const withMember = await addInstanceToCluster(cluster.id, instanceId);
  assert.deepEqual(withMember.memberInstanceIds, [instanceId]);
  assert.equal((await readInstance(instanceId)).clusterId, cluster.id);

  const withoutMember = await removeInstanceFromCluster(cluster.id, instanceId);
  assert.deepEqual(withoutMember.memberInstanceIds, []);
  assert.equal((await readInstance(instanceId)).clusterId, "");

  await deleteCluster(cluster.id);
  await assert.rejects(readCluster(cluster.id), /集群不存在/);
  await fs.rm(instanceFile(instanceId), { force: true });
});

test("集群目录不存在时会自动创建", async () => {
  const cluster = await createCluster({ name: "目录测试" });
  await fs.rm(cluster.clusterDir, { recursive: true, force: true });
  await ensureClusterRuntimeDir(cluster);
  const stat = await fs.stat(cluster.clusterDir);

  assert.equal(stat.isDirectory(), true);

  await deleteCluster(cluster.id);
  await fs.rm(cluster.clusterDir, { recursive: true, force: true });
  await fs.rm(clusterFile(cluster.id), { force: true });
});
