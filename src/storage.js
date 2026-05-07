import fs from "node:fs/promises";
import path from "node:path";

export const ROOT_DIR = path.resolve(process.cwd());
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const INSTANCES_DIR = path.join(DATA_DIR, "instances");
export const RUNTIME_FILE = path.join(DATA_DIR, "runtime.json");
export const APP_FILE = path.join(DATA_DIR, "app.json");

export const DEFAULT_APP_SETTINGS = {
  host: "127.0.0.1",
  port: 3050,
  steamcmdPath: "",
  defaultInstallRoot: path.join(ROOT_DIR, "servers"),
};

export async function ensureDataDirs() {
  await fs.mkdir(INSTANCES_DIR, { recursive: true });
}

export async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    throw new Error(`读取 JSON 失败：${filePath}，${error.message}`);
  }
}

export async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function readAppSettings() {
  await ensureDataDirs();
  const settings = await readJson(APP_FILE, DEFAULT_APP_SETTINGS);
  return { ...DEFAULT_APP_SETTINGS, ...settings };
}

export async function saveAppSettings(settings) {
  const next = { ...DEFAULT_APP_SETTINGS, ...settings };
  await writeJsonAtomic(APP_FILE, next);
  return next;
}

export async function readRuntime() {
  await ensureDataDirs();
  return readJson(RUNTIME_FILE, { instances: {} });
}

export async function saveRuntime(runtime) {
  await writeJsonAtomic(RUNTIME_FILE, runtime);
  return runtime;
}

export function instanceFile(instanceId) {
  return path.join(INSTANCES_DIR, `${instanceId}.json`);
}

export function createInstanceId(name) {
  const slug = String(name || "server")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "server"}-${Date.now().toString(36)}`;
}

export function defaultInstance(name = "新建方舟私服") {
  const id = createInstanceId(name);
  return {
    id,
    name,
    map: "TheIsland_WP",
    installDir: "",
    ports: {
      game: 7777,
      query: 27015,
      rcon: 27020,
    },
    mods: [],
    launch: {
      battleEye: true,
      extraArgs: "",
    },
    config: {},
    customConfigs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function listInstances() {
  await ensureDataDirs();
  const files = await fs.readdir(INSTANCES_DIR);
  const instances = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    instances.push(await readJson(path.join(INSTANCES_DIR, file), null));
  }
  return instances.filter(Boolean).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function readInstance(instanceId) {
  const instance = await readJson(instanceFile(instanceId), null);
  if (!instance) throw Object.assign(new Error("实例不存在"), { statusCode: 404 });
  return instance;
}

export async function saveInstance(instance) {
  const next = { ...instance, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(instanceFile(next.id), next);
  return next;
}

export async function deleteInstance(instanceId, options = {}) {
  const deleted = { record: instanceFile(instanceId), runtime: false, dataDir: null };
  await fs.rm(instanceFile(instanceId), { force: true });

  const runtime = await readRuntime();
  if (runtime.instances?.[instanceId]) {
    delete runtime.instances[instanceId];
    deleted.runtime = true;
    await saveRuntime(runtime);
  }

  if (options.deleteData && options.installDir) {
    await fs.rm(options.installDir, { recursive: true, force: true });
    deleted.dataDir = options.installDir;
  }

  return deleted;
}

export function resolveInstallDir(appSettings, instance) {
  if (instance.installDir) return path.resolve(instance.installDir);
  return path.join(appSettings.defaultInstallRoot, instance.id);
}
