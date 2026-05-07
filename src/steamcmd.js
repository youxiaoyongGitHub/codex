import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

export const STEAMCMD_DOWNLOAD_URL = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";

const WINDOWS_CANDIDATES = [
  "C:\\steamcmd\\steamcmd.exe",
  "C:\\SteamCMD\\steamcmd.exe",
  "C:\\Program Files\\SteamCMD\\steamcmd.exe",
  "C:\\Program Files (x86)\\SteamCMD\\steamcmd.exe",
  "C:\\Program Files (x86)\\Steam\\steamcmd.exe",
  "D:\\steamcmd\\steamcmd.exe",
  "D:\\SteamCMD\\steamcmd.exe",
  "E:\\steamcmd\\steamcmd.exe",
  "E:\\SteamCMD\\steamcmd.exe",
];

const POSIX_CANDIDATES = [
  "/usr/games/steamcmd",
  "/usr/bin/steamcmd",
  "/usr/local/bin/steamcmd",
  path.join(os.homedir(), "steamcmd", "steamcmd.sh"),
  path.join(os.homedir(), "Steam", "steamcmd.sh"),
];

function toWslPath(windowsPath) {
  const match = windowsPath.match(/^([A-Za-z]):\\(.+)$/);
  if (!match) return windowsPath;
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

async function executableExists(candidate) {
  const probePath = process.platform === "win32" ? candidate : toWslPath(candidate);
  try {
    const stat = await fs.stat(probePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function findOnPath() {
  const pathValue = process.env.PATH || "";
  const names = process.platform === "win32" ? ["steamcmd.exe"] : ["steamcmd", "steamcmd.sh", "steamcmd.exe"];
  const found = [];
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await executableExists(candidate)) found.push(candidate);
    }
  }
  return found;
}

export async function findSteamcmd() {
  const candidates = [...WINDOWS_CANDIDATES, ...POSIX_CANDIDATES, ...(await findOnPath())];
  const seen = new Set();
  const matches = [];
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    if (await executableExists(normalized)) {
      matches.push({
        path: normalized,
        source: WINDOWS_CANDIDATES.includes(normalized) || POSIX_CANDIDATES.includes(normalized) ? "常见安装路径" : "系统 PATH",
      });
    }
  }
  return {
    found: matches.length > 0,
    bestPath: matches[0]?.path || "",
    matches,
    searched: candidates.length,
  };
}

export function defaultSteamcmdInstallDir(appSettings = {}) {
  return path.join(appSettings.defaultInstallRoot || process.cwd(), "steamcmd");
}

export function steamcmdExecutableForDir(installDir) {
  return path.join(installDir, "steamcmd.exe");
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载 SteamCMD 失败：HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.byteLength) throw new Error("下载 SteamCMD 失败：安装包为空");
  await fs.writeFile(targetPath, buffer);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`解压 SteamCMD 失败，退出码 ${code}${stderr ? `：${stderr}` : ""}`));
    });
  });
}

async function extractZip(zipPath, installDir) {
  if (process.platform === "win32") {
    await runCommand("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${installDir.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }
  await runCommand("unzip", ["-o", zipPath, "-d", installDir]);
}

export async function installSteamcmd(appSettings = {}, requestedInstallDir = "") {
  const installDir = path.resolve(requestedInstallDir || defaultSteamcmdInstallDir(appSettings));
  await fs.mkdir(installDir, { recursive: true });
  const zipPath = path.join(installDir, "steamcmd.zip");
  await downloadFile(STEAMCMD_DOWNLOAD_URL, zipPath);
  await extractZip(zipPath, installDir);

  const executablePath = steamcmdExecutableForDir(installDir);
  if (!(await executableExists(executablePath))) {
    throw new Error(`SteamCMD 已下载但未找到 steamcmd.exe：${executablePath}`);
  }
  return { installDir, executablePath };
}
