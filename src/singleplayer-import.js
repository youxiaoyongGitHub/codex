import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configPath } from "./ini.js";
import { defaultMapId } from "./maps.js";
import { saveDirForInstance } from "./save-backups.js";
import { defaultInstance, pathExists, resolveInstallDir, saveInstance } from "./storage.js";

const INI_FILES = ["GameUserSettings.ini", "Game.ini"];

export function singleplayerCandidates() {
  const home = os.homedir();
  return {
    saveDirs: [
      path.join(home, "AppData", "Local", "ARK Survival Ascended", "ShooterGame", "Saved", "SavedArksLocal"),
      path.join(home, "AppData", "Local", "ArkAscended", "Saved", "SavedArksLocal"),
    ],
    configDirs: [
      path.join(home, "AppData", "Local", "ARK Survival Ascended", "ShooterGame", "Saved", "Config", "WindowsNoEditor"),
      path.join(home, "AppData", "Local", "ArkAscended", "Saved", "Config", "WindowsNoEditor"),
    ],
  };
}

export function inferMapFromSaveDir(saveDir, fallback = defaultMapId()) {
  const base = String(saveDir || "").split(/[\\/]/).filter(Boolean).at(-1) || "";
  if (/_WP$/i.test(base)) return base;
  return fallback;
}

export async function importSingleplayerInstance(appSettings, input = {}, validate = null) {
  const sourceSaveDir = path.resolve(String(input.saveDir || ""));
  if (!input.saveDir || !(await pathExists(sourceSaveDir))) {
    throw Object.assign(new Error(`单机存档目录不存在：${sourceSaveDir}`), { statusCode: 400 });
  }

  const map = input.map || inferMapFromSaveDir(sourceSaveDir);
  const instance = {
    ...defaultInstance(input.name || "单机导入服务器"),
    map,
    installDir: input.installDir || "",
    launch: { battleEye: false, culture: "zh", extraArgs: "" },
  };
  instance.installDir = instance.installDir || resolveInstallDir(appSettings, instance);
  const installDir = resolveInstallDir(appSettings, instance);
  if (validate) await validate(instance);
  const targetSaveDir = saveDirForInstance(instance, installDir);
  await fs.mkdir(path.dirname(targetSaveDir), { recursive: true });
  await fs.rm(targetSaveDir, { recursive: true, force: true });
  await fs.cp(sourceSaveDir, targetSaveDir, { recursive: true, force: true });

  const copiedConfigs = [];
  if (input.configDir) {
    const configDir = path.resolve(String(input.configDir));
    for (const file of INI_FILES) {
      const source = path.join(configDir, file);
      if (!(await pathExists(source))) continue;
      const target = configPath(installDir, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      copiedConfigs.push(target);
    }
  }

  const saved = await saveInstance(instance);
  return {
    instance: saved,
    sourceSaveDir,
    targetSaveDir,
    copiedConfigs,
  };
}
