import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readRuntime, saveRuntime } from "./storage.js";
import { syncIniFiles } from "./ini.js";
import { defaultMapId } from "./maps.js";

export function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function buildLaunchArgs(instance) {
  const config = instance.config || {};
  const map = instance.map || defaultMapId();
  const query = [
    `listen`,
    `SessionName=${encodeURIComponent(config.SessionName || instance.name || "方舟飞升私服")}`,
    `Port=${instance.ports?.game || 7777}`,
    `QueryPort=${instance.ports?.query || 27015}`,
    `MaxPlayers=${config.MaxPlayers || 10}`,
  ];
  if (config.ServerPassword) query.push(`ServerPassword=${encodeURIComponent(config.ServerPassword)}`);
  if (config.ServerAdminPassword) query.push(`ServerAdminPassword=${encodeURIComponent(config.ServerAdminPassword)}`);

  const args = [`${map}?${query.join("?")}`];
  if (instance.mods?.length) args.push(`-mods=${instance.mods.join(",")}`);
  if (instance.config?.RCONEnabled !== false) args.push("-RCONEnabled=True", `-RCONPort=${instance.ports?.rcon || instance.config?.RCONPort || 27020}`);
  if (instance.launch?.battleEye === false) args.push("-NoBattlEye");
  if (instance.launch?.extraArgs) args.push(...splitExtraArgs(instance.launch.extraArgs));
  return args;
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

export async function startInstance(instance, installDir) {
  const exe = serverExecutable(installDir);
  await fs.access(exe);
  await syncIniFiles(instance, installDir);

  const logsDir = path.join(installDir, "manager-logs");
  await fs.mkdir(logsDir, { recursive: true });
  const logPath = path.join(logsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const logStream = createWriteStream(logPath, { flags: "a" });
  const child = spawn(exe, buildLaunchArgs(instance), {
    cwd: path.dirname(exe),
    detached: false,
    windowsHide: false,
  });
  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });
  child.on("exit", async (code) => {
    const runtime = await readRuntime();
    runtime.instances[instance.id] = {
      ...(runtime.instances[instance.id] || {}),
      status: "已停止",
      lastExitCode: code,
      stoppedAt: new Date().toISOString(),
      pid: null,
      logPath,
    };
    await saveRuntime(runtime);
    logStream.end();
  });

  const runtime = await readRuntime();
  runtime.instances[instance.id] = {
    status: "运行中",
    pid: child.pid,
    startedAt: new Date().toISOString(),
    logPath,
  };
  await saveRuntime(runtime);
  return runtime.instances[instance.id];
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
      const child = spawn("taskkill", ["/PID", String(state.pid), "/T"], { windowsHide: true });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`停止进程失败，退出码 ${code}`))));
    });
  } else if (isProcessAlive(state.pid)) {
    process.kill(state.pid, "SIGTERM");
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
