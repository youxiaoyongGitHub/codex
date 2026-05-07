import test from "node:test";
import assert from "node:assert/strict";
import { findSteamcmd } from "../src/steamcmd.js";

test("SteamCMD 自动查找返回稳定结构", async () => {
  const result = await findSteamcmd();
  assert.equal(typeof result.found, "boolean");
  assert.equal(typeof result.bestPath, "string");
  assert.ok(Array.isArray(result.matches));
  assert.equal(typeof result.searched, "number");
});
