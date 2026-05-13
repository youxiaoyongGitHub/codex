import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readRuntime, saveRuntime } from "./storage.js";
import { syncIniFiles } from "./ini.js";
import { defaultMapId } from "./maps.js";
import { ensureClusterRuntimeDir } from "./clusters.js";

export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function buildLaunchArgs(instance, cluster = null) {
  const config = instance.config || {};
  const map = instance.map || defaultMapId();
  const query = [
    `listen`,
    `SessionName=${sanitizeLaunchValue(config.SessionName || instance.name || "方舟飞升私服")}`,
    `Port=${instance.ports?.game || 7777}`,
    `QueryPort=${instance.ports?.query || 27015}`,
    `MaxPlayers=${config.MaxPlayers || 10}`,
  ];
  if (config.ServerPassword) query.push(`ServerPassword=${sanitizeLaunchValue(config.ServerPassword)}`);
  if (config.ServerAdminPassword) query.push(`ServerAdminPassword=${sanitizeLaunchValue(config.ServerAdminPassword)}`);

  const args = [`${map}?${query.join("?")}`];
  const modIds = normalizeModIds(instance.mods);
  if (modIds.length) args.push(`-mods=${modIds.join(",")}`);
  if (instance.config?.RCONEnabled !== false) args.push("-RCONEnabled=True", `-RCONPort=${instance.ports?.rcon || instance.config?.RCONPort || 27020}`);
  if (cluster) args.push(`-clusterid=${cluster.arkClusterId}`, `-ClusterDirOverride=${cluster.clusterDir}`);
  if (instance.launch?.battleEye === false) args.push("-NoBattlEye");
  if (instance.launch?.extraArgs) args.push(...splitExtraArgs(instance.launch.extraArgs));
  return args;
}

export function normalizeModIds(mods = []) {
  return mods
    .map((mod) => (typeof mod === "object" ? mod.id : mod))
    .map((mod) => String(mod || "").trim())
    .filter(Boolean);
}

function sanitizeLaunchValue(value) {
  return String(value ?? "").replace(/[?\r\n]/g, " ").trim();
}

export function splitExtraArgs(value) {
  const input = String(value || "").trim();
  if (!input) return [];
  const matches = input.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  return matches.map((item) => item.replace(/^["']|["']$/g, ""));
}

export function serverExecutable(installDir) {
  return path.join(installDir, "ShooterGame", "Binaries", "Win64", "ArkAscendedServer.exe");
}

export function buildSteamcmdInstallArgs(installDir) {
  return [
    "+@sSteamCmdForcePlatformType",
    "windows",
    "+force_install_dir",
    installDir,
    "+login",
    "anonymous",
    "+app_update",
    "2430930",
    "validate",
    "+quit",
  ];
}

export async function installOrUpdateInstance(appSettings, instance, installDir) {
  if (!appSettings.steamcmdPath) throw new Error("请先在全局设置中配置 SteamCMD 路径");
  await fs.mkdir(installDir, { recursive: true });
  const logsDir = path.join(installDir, "manager-logs");
  await fs.mkdir(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `steamcmd-install-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const runtime = await readRuntime();
  runtime.instances[instance.id] = {
    ...(runtime.instances[instance.id] || {}),
    status: "安装更新中",
    logPath,
    updatedAt: new Date().toISOString(),
  };
  await saveRuntime(runtime);

  return runCommand(instance.id, appSettings.steamcmdPath, buildSteamcmdInstallArgs(installDir), logPath);
}

export async function startInstance(instance, installDir, cluster = null) {
  const exe = serverExecutable(installDir);
  await fs.access(exe);
  if (cluster) await ensureClusterRuntimeDir(cluster);
  await syncIniFiles(instance, installDir);

  const logsDir = path.join(installDir, "manager-logs");
  await fs.mkdir(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn(exe, buildLaunchArgs(instance, cluster), {
    cwd: path.dirname(exe),
    detached: false,
    windowsHide: false,
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  let runtimeStarted = false;
  let exitRecord = null;
  let resolveEarlyExit;
  const earlyExit = new Promise((resolve) => {
    resolveEarlyExit = resolve;
  });
  const persistExit = async ({ code, error }) => {
    const runtime = await readRuntime();
    runtime.instances[instance.id] = {
      ...(runtime.instances[instance.id] || {}),
      status: code === 0 ? "已停止" : "异常退出",
      lastExitCode: code,
      lastError: error?.message,
      stoppedAt: new Date().toISOString(),
      pid: null,
      logPath,
    };
    await saveRuntime(runtime);
    logStream.end();
  };
  const handleExit = async (code, error) => {
    if (exitRecord) return;
    exitRecord = { code, error };
    resolveEarlyExit(exitRecord);
    if (runtimeStarted) await persistExit(exitRecord);
  };
  child.on("exit", (code) => handleExit(code));
  child.on("error", (error) => handleExit(null, error));

  const runtime = await readRuntime();
  runtime.instances[instance.id] = {
    status: "运行中",
    pid: child.pid,
    startedAt: new Date().toISOString(),
    logPath,
  };
  await saveRuntime(runtime);
  runtimeStarted = true;
  if (exitRecord) await persistExit(exitRecord);
  const early = await Promise.race([earlyExit, delay(3000).then(() => null)]);
  if (early?.error) throw early.error;
  if (early) {
    throw new Error(`服务端启动后立即退出，退出码 ${early.code ?? "未知"}，请查看日志 ${logPath}`);
  }
  return runtime.instances[instance.id];
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stopInstance(instanceId) {
  const runtime = await readRuntime();
  const state = runtime.instances[instanceId];
  if (!state?.pid) {
    runtime.instances[instanceId] = { ...(state || {}), status: "已停止", pid: null };
    await saveRuntime(runtime);
    return runtime.instances[instanceId];
  }

  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const child = spawn("taskkill", ["/PID", String(state.pid), "/T", "/F"], { windowsHide: true });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`停止进程失败，退出码 ${code}`))));
    });
  } else if (isProcessAlive(state.pid)) {
    process.kill(state.pid, "SIGTERM");
  }

  if (isProcessAlive(state.pid)) {
    throw new Error(`停止进程失败，PID ${state.pid} 仍在运行`);
  }

  runtime.instances[instanceId] = {
    ...state,
    status: "已停止",
    pid: null,
    stoppedAt: new Date().toISOString(),
  };
  await saveRuntime(runtime);
  return runtime.instances[instanceId];
}

export async function refreshRuntimeStates() {
  const runtime = await readRuntime();
  for (const [id, state] of Object.entries(runtime.instances || {})) {
    if (state.pid && !isProcessAlive(state.pid)) {
      runtime.instances[id] = { ...state, status: "已停止", pid: null };
    }
  }
  await saveRuntime(runtime);
  return runtime;
}

function runCommand(instanceId, command, args, logPath) {
  return new Promise(async (resolve, reject) => {
    const runtime = await readRuntime();
    const logStream = logPath ? createWriteStream(logPath, { flags: "a" }) : null;
    const child = spawn(command, args, {
      cwd: path.dirname(command),
      windowsHide: false,
    });
    if (logStream) {
      child.stdout?.pipe(logStream, { end: false });
      child.stderr?.pipe(logStream, { end: false });
    }
    runtime.instances[instanceId] = {
      ...(runtime.instances[instanceId] || {}),
      status: "安装更新中",
      pid: child.pid,
      logPath,
      updatedAt: new Date().toISOString(),
    };
    await saveRuntime(runtime);

    child.on("exit", async (code) => {
      const next = await readRuntime();
      next.instances[instanceId] = {
        ...(next.instances[instanceId] || {}),
        status: code === 0 ? "已停止" : "异常退出",
        pid: null,
        lastExitCode: code,
        logPath,
        updatedAt: new Date().toISOString(),
      };
      await saveRuntime(next);
      logStream?.end();
      if (code === 0) resolve(next.instances[instanceId]);
      else reject(new Error(`安装/更新失败，退出码 ${code}${logPath ? `，请在运行日志中查看 ${logPath}` : ""}`));
    });
    child.on("error", async (error) => {
      const next = await readRuntime();
      next.instances[instanceId] = {
        ...(next.instances[instanceId] || {}),
        status: "异常退出",
        pid: null,
        lastError: error.message,
        logPath,
        updatedAt: new Date().toISOString(),
      };
      await saveRuntime(next);
      logStream?.end();
      reject(error);
    });
  });
}
