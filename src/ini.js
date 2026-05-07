import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_SCHEMA } from "./config-schema.js";

export function normalizeIniValue(item, value) {
  const raw = value === undefined || value === null || value === "" ? item.defaultValue : value;
  if (item.type === "boolean") return raw === true || raw === "true" || raw === "True" ? "True" : "False";
  if (item.type === "number") {
    const num = Number(raw);
    if (!Number.isFinite(num)) throw new Error(`${item.displayNameZh} 必须是数字`);
    if (item.min !== undefined && num < item.min) throw new Error(`${item.displayNameZh} 不能小于 ${item.min}`);
    if (item.max !== undefined && num > item.max) throw new Error(`${item.displayNameZh} 不能大于 ${item.max}`);
    return String(num);
  }
  return String(raw ?? "");
}

export function parseIni(raw) {
  const lines = String(raw || "").split(/\r?\n/);
  const values = {};
  let section = "";
  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (!values[section]) values[section] = {};
      continue;
    }
    const kv = line.match(/^\s*([^=;#][^=]*?)\s*=\s*(.*)\s*$/);
    if (kv && section) {
      values[section][kv[1].trim()] = kv[2];
    }
  }
  return values;
}

export function mergeIni(raw, entries) {
  const lines = String(raw || "").split(/\r?\n/);
  const pending = new Map(entries.map((entry) => [`${entry.section}\u0000${entry.key}`, entry]));
  const sectionRanges = new Map();
  let section = "";

  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = lines[index].match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      if (!sectionRanges.has(section)) sectionRanges.set(section, { header: index, end: index });
      continue;
    }
    if (section && sectionRanges.has(section)) sectionRanges.get(section).end = index;
    const kv = lines[index].match(/^\s*([^=;#][^=]*?)\s*=\s*(.*)\s*$/);
    if (!kv || !section) continue;
    const key = kv[1].trim();
    const id = `${section}\u0000${key}`;
    const entry = pending.get(id);
    if (entry) {
      lines[index] = `${entry.key}=${entry.value}`;
      pending.delete(id);
    }
  }

  const additionsBySection = new Map();
  for (const entry of pending.values()) {
    if (!additionsBySection.has(entry.section)) additionsBySection.set(entry.section, []);
    additionsBySection.get(entry.section).push(`${entry.key}=${entry.value}`);
  }

  const knownSections = [...additionsBySection.keys()].filter((item) => sectionRanges.has(item));
  knownSections.sort((a, b) => sectionRanges.get(b).end - sectionRanges.get(a).end);
  for (const sectionName of knownSections) {
    const range = sectionRanges.get(sectionName);
    lines.splice(range.end + 1, 0, ...additionsBySection.get(sectionName));
    additionsBySection.delete(sectionName);
  }

  for (const [sectionName, sectionLines] of additionsBySection.entries()) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(`[${sectionName}]`, ...sectionLines);
  }

  return `${lines.join("\n").replace(/\n+$/g, "")}\n`;
}

export function configPath(installDir, file) {
  return path.join(installDir, "ShooterGame", "Saved", "Config", "WindowsServer", file);
}

export function buildConfigEntries(instance, schema = CONFIG_SCHEMA) {
  const entriesByFile = new Map();
  for (const item of schema) {
    const value = normalizeIniValue(item, instance.config?.[item.key]);
    if (!entriesByFile.has(item.file)) entriesByFile.set(item.file, []);
    entriesByFile.get(item.file).push({ section: item.section, key: item.key, value });
  }

  for (const custom of instance.customConfigs || []) {
    if (!custom.file || !custom.section || !custom.key) continue;
    if (!entriesByFile.has(custom.file)) entriesByFile.set(custom.file, []);
    entriesByFile.get(custom.file).push({
      section: custom.section,
      key: custom.key,
      value: String(custom.value ?? ""),
    });
  }

  return entriesByFile;
}

export async function syncIniFiles(instance, installDir) {
  const entriesByFile = buildConfigEntries(instance);
  const written = [];
  for (const [file, entries] of entriesByFile.entries()) {
    const filePath = configPath(installDir, file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    let raw = "";
    try {
      raw = await fs.readFile(filePath, "utf8");
      const backupDir = path.join(installDir, "backups");
      await fs.mkdir(backupDir, { recursive: true });
      const safeName = `${file}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      await fs.writeFile(path.join(backupDir, safeName), raw, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.writeFile(filePath, mergeIni(raw, entries), "utf8");
    written.push(filePath);
  }
  return written;
}

export async function readRawIni(installDir, file) {
  try {
    return await fs.readFile(configPath(installDir, file), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
