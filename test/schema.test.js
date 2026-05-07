import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG_SCHEMA, validateSchema, schemaId } from "../src/config-schema.js";

test("内置配置字典字段完整且无重复项", () => {
  assert.deepEqual(validateSchema(), []);
  const ids = new Set(CONFIG_SCHEMA.map(schemaId));
  assert.equal(ids.size, CONFIG_SCHEMA.length);
});

test("配置项使用中文展示信息并保留原始 key", () => {
  const xp = CONFIG_SCHEMA.find((item) => item.key === "XPMultiplier");
  assert.equal(xp.displayNameZh, "经验倍率");
  assert.equal(xp.file, "GameUserSettings.ini");
  assert.equal(xp.section, "ServerSettings");
});
