import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, pathExists, writeJsonAtomic } from "./storage.js";

export const SAVE_BACKUPS_DIR = path.join(DATA_DIR, "save-backups");

export function saveDirForInstance(instance, installDir) {
  return path.join(installDir, "ShooterGame", "Saved", "SavedArks", instance.map || "TheIsland_WP");
}

export function backupRootForInstance(instanceId) {
  return path.join(SAVE_BACKUPS_DIR, instanceId);
}

export function backupPathForInstance(instanceId, backupId) {
  if (!/^[a-z0-9._-]+$/i.test(backupId)) throw Object.assign(new Error("备份 ID 非法"), { statusCode: 400 });
  return path.join(backupRootForInstance(instanceId), backupId);
}

function createBackupId(prefix = "backup") {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

async function directorySize(dir) {
  let total = 0;
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const itemPath = path.join(dir, item.name);
    if (item.isDirectory()) total += await directorySize(itemPath);
    else if (item.isFile()) total += (await fs.stat(itemPath)).size;
  }
  return total;
}

export async function listSaveBackups(instance) {
  const root = backupRootForInstance(instance.id);
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const backups = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    try {
      const raw = await fs.readFile(path.join(root, entry.name, "manifest.json"), "utf8");
      backups.push(JSON.parse(raw));
    } catch {
      backups.push({ id: entry.name, instanceId: instance.id, createdAt: "", note: "缺少备份元数据" });
    }
  }
  return backups.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function createSaveBackup(instance, installDir, options = {}) {
  const source = saveDirForInstance(instance, installDir);
  if (!(await pathExists(source))) {
    throw Object.assign(new Error(`存档目录不存在：${source}`), { statusCode: 404 });
  }
  const id = createBackupId(options.prefix || "backup");
  const target = backupPathForInstance(instance.id, id);
  const saveTarget = path.join(target, "save");
  await fs.mkdir(target, { recursive: true });
  await fs.cp(source, saveTarget, { recursive: true, force: true });
  const manifest = {
    id,
    instanceId: instance.id,
    instanceName: instance.name,
    map: instance.map,
    sourcePath: source,
    createdAt: new Date().toISOString(),
    sizeBytes: await directorySize(saveTarget),
    note: options.note || "",
  };
  await writeJsonAtomic(path.join(target, "manifest.json"), manifest);
  return manifest;
}

export async function restoreSaveBackup(instance, installDir, backupId) {
  const backupDir = backupPathForInstance(instance.id, backupId);
  const backupSaveDir = path.join(backupDir, "save");
  if (!(await pathExists(backupSaveDir))) {
    throw Object.assign(new Error("备份存档不存在或已损坏"), { statusCode: 404 });
  }

  const target = saveDirForInstance(instance, installDir);
  let safetyBackup = null;
  if (await pathExists(target)) {
    safetyBackup = await createSaveBackup(instance, installDir, {
      prefix: "restore-before",
      note: `恢复 ${backupId} 前自动备份`,
    });
    await fs.rm(target, { recursive: true, force: true });
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.cp(backupSaveDir, target, { recursive: true, force: true });
  return { restoredFrom: backupId, target, safetyBackup };
}
