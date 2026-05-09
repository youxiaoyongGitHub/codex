import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteInstance,
  defaultInstance,
  ensureDataDirs,
  listInstances,
  readAppSettings,
  readInstance,
  readRuntime,
  resolveInstallDir,
  saveAppSettings,
  saveInstance,
} from "./storage.js";
import { CONFIG_CATEGORIES, CONFIG_SCHEMA, validateSchema } from "./config-schema.js";
import { configPath, readRawIni, syncIniFiles } from "./ini.js";
import { ASA_MAPS } from "./maps.js";
import { connectionInfoForInstance, ensureFirewallRules, getPortStatus, requiredPorts } from "./network.js";
import { createSaveBackup, listSaveBackups, restoreSaveBackup, saveDirForInstance } from "./save-backups.js";
import {
  addInstanceToCluster,
  clusterDirectoryStatus,
  clusterMembers,
  createCluster,
  deleteCluster,
  ensureClusterDirs,
  listClusters,
  readCluster,
  removeInstanceFromAllClusters,
  removeInstanceFromCluster,
  resolveInstanceCluster,
  saveCluster,
} from "./clusters.js";
import {
  installOrUpdateInstance,
  refreshRuntimeStates,
  startInstance,
  stopInstance,
} from "./process-manager.js";
import { findSteamcmd, installSteamcmd } from "./steamcmd.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const status = error.statusCode || 500;
  sendJson(res, status, { error: error.message || "服务器内部错误" });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function route(method, pathname, pattern) {
  if (method !== pattern.method) return null;
  const match = pathname.match(pattern.regex);
  return match ? match.groups || {} : null;
}

function validateInstance(instance, allInstances, appSettings) {
  if (!instance.name?.trim()) throw Object.assign(new Error("实例名称不能为空"), { statusCode: 400 });
  if (!instance.map?.trim()) throw Object.assign(new Error("地图名称不能为空"), { statusCode: 400 });
  const ports = Object.values(requiredPorts(instance));
  if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw Object.assign(new Error("端口必须在 1 到 65535 之间"), { statusCode: 400 });
  }
  if (new Set(ports).size !== ports.length) {
    throw Object.assign(new Error("同一实例内端口不能重复"), { statusCode: 400 });
  }
  const ownDir = resolveInstallDir(appSettings, instance);
  for (const other of allInstances) {
    if (other.id === instance.id) continue;
    const otherPorts = Object.values(requiredPorts(other));
    if (ports.some((port) => otherPorts.includes(port))) {
      throw Object.assign(new Error(`端口与实例“${other.name}”冲突`), { statusCode: 400 });
    }
    if (resolveInstallDir(appSettings, other) === ownDir) {
      throw Object.assign(new Error(`安装目录与实例“${other.name}”冲突`), { statusCode: 400 });
    }
  }
}

function sanitizeInstanceInput(input) {
  return {
    id: input.id,
    name: input.name,
    map: input.map,
    installDir: input.installDir,
    ports: input.ports,
    mods: Array.isArray(input.mods) ? input.mods : [],
    launch: input.launch,
    clusterId: input.clusterId || "",
    config: input.config || {},
    customConfigs: Array.isArray(input.customConfigs) ? input.customConfigs : [],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

async function clusterPayload(cluster, runtime = null) {
  const members = await clusterMembers(cluster);
  return {
    ...cluster,
    directory: await clusterDirectoryStatus(cluster),
    members: members.map((instance) => ({
      id: instance.id,
      name: instance.name,
      map: instance.map,
      ports: instance.ports,
      runtime: runtime?.instances?.[instance.id] || { status: "已停止" },
    })),
  };
}

async function apiHandler(req, res, pathname) {
  const appSettings = await readAppSettings();

  if (route(req.method, pathname, { method: "GET", regex: /^\/api\/status$/ })) {
    const runtime = await refreshRuntimeStates();
    return sendJson(res, 200, { app: appSettings, runtime });
  }
  if (route(req.method, pathname, { method: "GET", regex: /^\/api\/settings$/ })) {
    return sendJson(res, 200, appSettings);
  }
  if (route(req.method, pathname, { method: "PUT", regex: /^\/api\/settings$/ })) {
    const body = await readBody(req);
    return sendJson(res, 200, await saveAppSettings(body));
  }
  if (route(req.method, pathname, { method: "GET", regex: /^\/api\/steamcmd\/find$/ })) {
    return sendJson(res, 200, await findSteamcmd());
  }
  if (route(req.method, pathname, { method: "POST", regex: /^\/api\/steamcmd\/install$/ })) {
    const body = await readBody(req);
    const installed = await installSteamcmd(appSettings, body.installDir);
    const settings = await saveAppSettings({
      ...appSettings,
      steamcmdPath: installed.executablePath,
      steamcmdInstallDir: installed.installDir,
    });
    return sendJson(res, 200, { ...installed, settings });
  }
  if (route(req.method, pathname, { method: "GET", regex: /^\/api\/config-schema$/ })) {
    return sendJson(res, 200, {
      categories: CONFIG_CATEGORIES,
      schema: CONFIG_SCHEMA,
      validationErrors: validateSchema(),
    });
  }
  if (route(req.method, pathname, { method: "GET", regex: /^\/api\/maps$/ })) {
    return sendJson(res, 200, { maps: ASA_MAPS });
  }
  if (route(req.method, pathname, { method: "GET", regex: /^\/api\/clusters$/ })) {
    const runtime = await refreshRuntimeStates();
    const clusters = await Promise.all((await listClusters()).map((cluster) => clusterPayload(cluster, runtime)));
    return sendJson(res, 200, { clusters });
  }
  if (route(req.method, pathname, { method: "POST", regex: /^\/api\/clusters$/ })) {
    const body = await readBody(req);
    const cluster = await createCluster({ name: body.name || "新建方舟集群", clusterDir: body.clusterDir });
    return sendJson(res, 201, await clusterPayload(cluster, await readRuntime()));
  }
  if (route(req.method, pathname, { method: "GET", regex: /^\/api\/instances$/ })) {
    const runtime = await refreshRuntimeStates();
    const instances = await listInstances();
    return sendJson(res, 200, instances.map((instance) => ({
      ...instance,
      resolvedInstallDir: resolveInstallDir(appSettings, instance),
      runtime: runtime.instances[instance.id] || { status: "已停止" },
    })));
  }
  if (route(req.method, pathname, { method: "POST", regex: /^\/api\/instances$/ })) {
    const body = await readBody(req);
    const instance = sanitizeInstanceInput({ ...defaultInstance(body.name || "新建方舟私服"), ...body });
    instance.installDir = instance.installDir || resolveInstallDir(appSettings, instance);
    validateInstance(instance, await listInstances(), appSettings);
    return sendJson(res, 201, await saveInstance(instance));
  }

  const clusterMatch = route(req.method, pathname, {
    method: req.method,
    regex: /^\/api\/clusters\/(?<id>[^/]+)(?<suffix>\/.*)?$/,
  });
  if (clusterMatch) {
    const cluster = await readCluster(decodeURIComponent(clusterMatch.id));
    const suffix = clusterMatch.suffix || "";
    if (req.method === "GET" && suffix === "") {
      return sendJson(res, 200, await clusterPayload(cluster, await refreshRuntimeStates()));
    }
    if (req.method === "PUT" && suffix === "") {
      const body = await readBody(req);
      const next = await saveCluster({
        ...cluster,
        name: body.name || cluster.name,
        arkClusterId: body.arkClusterId || cluster.arkClusterId,
        clusterDir: body.clusterDir || cluster.clusterDir,
      });
      return sendJson(res, 200, await clusterPayload(next, await readRuntime()));
    }
    if (req.method === "DELETE" && suffix === "") {
      return sendJson(res, 200, { ok: true, deleted: await deleteCluster(cluster.id) });
    }
    if (req.method === "POST" && suffix === "/members") {
      const body = await readBody(req);
      if (!body.instanceId) throw Object.assign(new Error("请选择要加入集群的实例"), { statusCode: 400 });
      const next = await addInstanceToCluster(cluster.id, body.instanceId);
      return sendJson(res, 200, await clusterPayload(next, await readRuntime()));
    }
    if (req.method === "DELETE" && suffix.startsWith("/members/")) {
      const instanceId = decodeURIComponent(suffix.replace("/members/", ""));
      const next = await removeInstanceFromCluster(cluster.id, instanceId);
      return sendJson(res, 200, await clusterPayload(next, await readRuntime()));
    }
    return false;
  }

  const instanceMatch = route(req.method, pathname, {
    method: req.method,
    regex: /^\/api\/instances\/(?<id>[^/]+)(?<suffix>\/.*)?$/,
  });
  if (!instanceMatch) return false;

  const instance = await readInstance(decodeURIComponent(instanceMatch.id));
  const suffix = instanceMatch.suffix || "";

  if (req.method === "GET" && suffix === "") {
    const runtime = await readRuntime();
    return sendJson(res, 200, {
      ...instance,
      resolvedInstallDir: resolveInstallDir(appSettings, instance),
      runtime: runtime.instances[instance.id] || { status: "已停止" },
    });
  }
  if (req.method === "PUT" && suffix === "") {
    const body = await readBody(req);
    const next = sanitizeInstanceInput({ ...instance, ...body, id: instance.id, createdAt: instance.createdAt });
    validateInstance(next, await listInstances(), appSettings);
    return sendJson(res, 200, await saveInstance(next));
  }
  if (req.method === "DELETE" && suffix === "") {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const deleteData = url.searchParams.get("deleteData") === "true";
    const deleted = await deleteInstance(instance.id, {
      deleteData,
      installDir: resolveInstallDir(appSettings, instance),
    });
    await removeInstanceFromAllClusters(instance.id);
    return sendJson(res, 200, { ok: true, deleted });
  }
  if (req.method === "GET" && suffix === "/config") {
    return sendJson(res, 200, {
      schema: CONFIG_SCHEMA,
      values: instance.config || {},
      customConfigs: instance.customConfigs || [],
    });
  }
  if (req.method === "PUT" && suffix === "/config") {
    const body = await readBody(req);
    const next = {
      ...instance,
      config: body.values || {},
      customConfigs: Array.isArray(body.customConfigs) ? body.customConfigs : [],
    };
    const saved = await saveInstance(next);
    if (body.syncToIni) await syncIniFiles(saved, resolveInstallDir(appSettings, saved));
    return sendJson(res, 200, saved);
  }
  if (req.method === "POST" && suffix === "/sync-ini") {
    const written = await syncIniFiles(instance, resolveInstallDir(appSettings, instance));
    return sendJson(res, 200, { written });
  }
  if (req.method === "POST" && suffix === "/install") {
    const state = await installOrUpdateInstance(appSettings, instance, resolveInstallDir(appSettings, instance));
    return sendJson(res, 200, state);
  }
  if (req.method === "POST" && suffix === "/start") {
    const state = await startInstance(instance, resolveInstallDir(appSettings, instance), await resolveInstanceCluster(instance));
    return sendJson(res, 200, state);
  }
  if (req.method === "POST" && suffix === "/stop") {
    const state = await stopInstance(instance.id);
    return sendJson(res, 200, state);
  }
  if (req.method === "POST" && suffix === "/restart") {
    await stopInstance(instance.id);
    const state = await startInstance(instance, resolveInstallDir(appSettings, instance), await resolveInstanceCluster(instance));
    return sendJson(res, 200, state);
  }
  if (req.method === "GET" && suffix === "/ports") {
    return sendJson(res, 200, await getPortStatus(instance));
  }
  if (req.method === "GET" && suffix === "/connection") {
    return sendJson(res, 200, connectionInfoForInstance(instance));
  }
  if (req.method === "GET" && suffix === "/backups") {
    const installDir = resolveInstallDir(appSettings, instance);
    return sendJson(res, 200, {
      saveDir: saveDirForInstance(instance, installDir),
      backups: await listSaveBackups(instance),
    });
  }
  if (req.method === "POST" && suffix === "/backups") {
    const backup = await createSaveBackup(instance, resolveInstallDir(appSettings, instance));
    return sendJson(res, 201, backup);
  }
  if (req.method === "POST" && suffix.startsWith("/backups/") && suffix.endsWith("/restore")) {
    const runtime = await readRuntime();
    const state = runtime.instances[instance.id];
    if (state?.pid || state?.status === "运行中") {
      throw Object.assign(new Error("恢复存档前请先停止实例"), { statusCode: 409 });
    }
    const backupId = decodeURIComponent(suffix.replace(/^\/backups\//, "").replace(/\/restore$/, ""));
    const result = await restoreSaveBackup(instance, resolveInstallDir(appSettings, instance), backupId);
    return sendJson(res, 200, result);
  }
  if (req.method === "POST" && suffix === "/firewall") {
    return sendJson(res, 200, await ensureFirewallRules(instance));
  }
  if (req.method === "GET" && suffix === "/logs") {
    const runtime = await readRuntime();
    const logPath = runtime.instances[instance.id]?.logPath;
    if (!logPath) return sendJson(res, 200, { log: "" });
    try {
      const raw = await fs.readFile(logPath, "utf8");
      return sendJson(res, 200, { log: raw.slice(-20000), logPath });
    } catch {
      return sendJson(res, 200, { log: "", logPath });
    }
  }
  if (req.method === "GET" && suffix.startsWith("/ini/")) {
    const file = decodeURIComponent(suffix.replace("/ini/", ""));
    if (!["GameUserSettings.ini", "Game.ini"].includes(file)) throw Object.assign(new Error("不支持的 INI 文件"), { statusCode: 400 });
    return sendJson(res, 200, {
      file,
      path: configPath(resolveInstallDir(appSettings, instance), file),
      content: await readRawIni(resolveInstallDir(appSettings, instance), file),
      emptyMessage: "如果文件为空，请先在“中文 INI 配置”中保存并同步 INI，或启动一次实例让面板自动写入配置。",
    });
  }
  if (req.method === "PUT" && suffix.startsWith("/ini/")) {
    const file = decodeURIComponent(suffix.replace("/ini/", ""));
    if (!["GameUserSettings.ini", "Game.ini"].includes(file)) throw Object.assign(new Error("不支持的 INI 文件"), { statusCode: 400 });
    const body = await readBody(req);
    const target = configPath(resolveInstallDir(appSettings, instance), file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, String(body.content || ""), "utf8");
    return sendJson(res, 200, { file, path: target });
  }

  return false;
}

async function staticHandler(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(PUBLIC_DIR, `.${safePath}`);
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(target);
    res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
    res.end(body);
  } catch {
    const fallback = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "content-type": MIME[".html"] });
    res.end(fallback);
  }
}

async function main() {
  await ensureDataDirs();
  await ensureClusterDirs();
  const settings = await readAppSettings();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    try {
      if (url.pathname.startsWith("/api/")) {
        const handled = await apiHandler(req, res, url.pathname);
        if (handled === false) sendJson(res, 404, { error: "接口不存在" });
        return;
      }
      await staticHandler(req, res, url.pathname);
    } catch (error) {
      sendError(res, error);
    }
  });

  server.listen(settings.port, settings.host, () => {
    console.log(`方舟生存飞升开服器已启动：http://${settings.host}:${settings.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
