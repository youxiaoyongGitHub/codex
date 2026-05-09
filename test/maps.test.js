import test from "node:test";
import assert from "node:assert/strict";
import { ASA_MAPS, defaultMapId, isKnownMap } from "../src/maps.js";

test("ASA 地图字典提供中文显示和原始启动名", () => {
  assert.ok(ASA_MAPS.length >= 7);
  const island = ASA_MAPS.find((map) => map.id === "TheIsland_WP");
  assert.equal(island.displayNameZh, "孤岛");
  assert.equal(island.englishName, "The Island");
  assert.equal(defaultMapId(), "TheIsland_WP");
  assert.equal(isKnownMap("ScorchedEarth_WP"), true);
  assert.equal(isKnownMap("Astraeos_WP"), true);
  assert.equal(isKnownMap("LostColony_WP"), true);
  assert.equal(isKnownMap("Unknown_WP"), false);
  assert.ok(ASA_MAPS.find((map) => map.id === "Astraeos_WP").displayNameZh.includes("繁星"));
  assert.ok(ASA_MAPS.find((map) => map.id === "LostIsland_WP").aliasesZh.includes("迷失岛"));
});
