import test from "node:test";
import assert from "node:assert/strict";
import { buildConfigEntries, mergeIni, normalizeIniValue, parseIni } from "../src/ini.js";

test("INI 合并会覆盖已管理项并保留未知项", () => {
  const raw = [
    "[ServerSettings]",
    "UnknownOption=KeepMe",
    "XPMultiplier=1",
    "",
    "[Other]",
    "Foo=Bar",
    "",
  ].join("\n");
  const next = mergeIni(raw, [
    { section: "ServerSettings", key: "XPMultiplier", value: "2" },
    { section: "ServerSettings", key: "TamingSpeedMultiplier", value: "3" },
  ]);
  assert.match(next, /UnknownOption=KeepMe/);
  assert.match(next, /XPMultiplier=2/);
  assert.match(next, /TamingSpeedMultiplier=3/);
  assert.match(next, /\[Other\]\nFoo=Bar/);
});

test("中文 UI 布尔值保存为 ARK 需要的 True/False", () => {
  const item = {
    displayNameZh: "PVE 模式",
    type: "boolean",
    defaultValue: true,
  };
  assert.equal(normalizeIniValue(item, true), "True");
  assert.equal(normalizeIniValue(item, false), "False");
});

test("实例配置按原始 key 生成 INI 条目", () => {
  const entries = buildConfigEntries({
    config: {
      XPMultiplier: 2,
      ServerPVE: false,
    },
    customConfigs: [
      { file: "Game.ini", section: "/Script/ShooterGame.ShooterGameMode", key: "CustomKey", value: "abc" },
    ],
  });
  const gus = entries.get("GameUserSettings.ini");
  assert.ok(gus.find((item) => item.key === "XPMultiplier" && item.value === "2"));
  assert.ok(gus.find((item) => item.key === "ServerPVE" && item.value === "False"));
  assert.ok(entries.get("Game.ini").find((item) => item.key === "CustomKey" && item.value === "abc"));
});

test("INI 解析能读取 section 下的 key", () => {
  const parsed = parseIni("[ServerSettings]\nXPMultiplier=2\n");
  assert.equal(parsed.ServerSettings.XPMultiplier, "2");
});
