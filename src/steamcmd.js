import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

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
