import fs from "node:fs/promises";
import path from "node:path";
import {
  DATA_DIR,
  listInstances,
  pathExists,
  readJson,
  readInstance,
  saveInstance,
  writeJsonAtomic,
} from "./storage.js";

export const CLUSTERS_DIR = path.join(DATA_DIR, "clusters");
export const CLUSTERS_DATA_DIR = path.join(DATA_DIR, "clusters-data");

export async function ensureClusterDirs() {
  await fs.mkdir(CLUSTERS_DIR, { recursive: true });
  await fs.mkdir(CLUSTERS_DATA_DIR, { recursive: true });
}

export function clusterFile(clusterId) {
  return path.join(CLUSTERS_DIR, `${clusterId}.json`);
}

export function defaultClusterDir(clusterId) {
  return path.join(CLUSTERS_DATA_DIR, clusterId);
}

export function createClusterId(name = "方舟集群") {
  const slug = String(name || "cluster")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "cluster"}-${Date.now().toString(36)}`;
}

export function createArkClusterId(clusterId) {
  return `asa-${String(clusterId).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 48)}`;
}

export function defaultCluster(name = "新建方舟集群") {
  const id = createClusterId(name);
  return {
    id,
    name,
    arkClusterId: createArkClusterId(id),
    clusterDir: defaultClusterDir(id),
    memberInstanceIds: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listClusters() {
  await ensureClusterDirs();
  const files = await fs.readdir(CLUSTERS_DIR);
  const clusters = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    clusters.push(await readJson(path.join(CLUSTERS_DIR, file), null));
  }
  return clusters.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function readCluster(clusterId) {
  const cluster = await readJson(clusterFile(clusterId), null);
  if (!cluster) throw Object.assign(new Error("集群不存在"), { statusCode: 404 });
  return cluster;
}

export async function saveCluster(cluster) {
  await ensureClusterDirs();
  const next = {
    ...cluster,
    clusterDir: cluster.clusterDir || defaultClusterDir(cluster.id),
    memberInstanceIds: [...new Set(cluster.memberInstanceIds || [])],
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(clusterFile(next.id), next);
  return next;
}

export async function createCluster(input = {}) {
  const cluster = {
    ...defaultCluster(input.name || "新建方舟集群"),
    ...input,
  };
  cluster.arkClusterId = cluster.arkClusterId || createArkClusterId(cluster.id);
  cluster.clusterDir = cluster.clusterDir || defaultClusterDir(cluster.id);
  cluster.memberInstanceIds = Array.isArray(cluster.memberInstanceIds) ? cluster.memberInstanceIds : [];
  return saveCluster(cluster);
}

export async function deleteCluster(clusterId) {
  const cluster = await readCluster(clusterId);
  for (const instanceId of cluster.memberInstanceIds || []) {
    try {
      const instance = await readInstance(instanceId);
      if (instance.clusterId === clusterId) await saveInstance({ ...instance, clusterId: "" });
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
  }
  await fs.rm(clusterFile(clusterId), { force: true });
  return { record: clusterFile(clusterId), dataDir: cluster.clusterDir };
}

export async function addInstanceToCluster(clusterId, instanceId) {
  const cluster = await readCluster(clusterId);
  const instance = await readInstance(instanceId);
  if (!cluster.memberInstanceIds.includes(instanceId)) cluster.memberInstanceIds.push(instanceId);
  await saveCluster(cluster);

  if (instance.clusterId && instance.clusterId !== clusterId) {
    await removeInstanceFromCluster(instance.clusterId, instanceId, { clearInstance: false });
  }
  await saveInstance({ ...instance, clusterId });
  return readCluster(clusterId);
}

export async function removeInstanceFromCluster(clusterId, instanceId, options = {}) {
  const cluster = await readCluster(clusterId);
  cluster.memberInstanceIds = (cluster.memberInstanceIds || []).filter((id) => id !== instanceId);
  await saveCluster(cluster);
  if (options.clearInstance !== false) {
    try {
      const instance = await readInstance(instanceId);
      if (instance.clusterId === clusterId) await saveInstance({ ...instance, clusterId: "" });
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
  }
  return cluster;
}

export async function removeInstanceFromAllClusters(instanceId) {
  for (const cluster of await listClusters()) {
    if ((cluster.memberInstanceIds || []).includes(instanceId)) {
      await removeInstanceFromCluster(cluster.id, instanceId, { clearInstance: false });
    }
  }
}

export async function resolveInstanceCluster(instance) {
  if (!instance.clusterId) return null;
  const cluster = await readCluster(instance.clusterId);
  if (!(cluster.memberInstanceIds || []).includes(instance.id)) {
    throw Object.assign(new Error(`实例未加入集群“${cluster.name}”`), { statusCode: 400 });
  }
  return cluster;
}

export async function ensureClusterRuntimeDir(cluster) {
  try {
    await fs.mkdir(cluster.clusterDir, { recursive: true });
  } catch (error) {
    throw Object.assign(new Error(`无法创建集群共享目录：${cluster.clusterDir}，${error.message}`), { statusCode: 500 });
  }
}

export async function clusterDirectoryStatus(cluster) {
  return {
    path: cluster.clusterDir,
    exists: await pathExists(cluster.clusterDir),
  };
}

export async function clusterMembers(cluster) {
  const instances = await listInstances();
  const byId = new Map(instances.map((instance) => [instance.id, instance]));
  return (cluster.memberInstanceIds || []).map((id) => byId.get(id)).filter(Boolean);
}
