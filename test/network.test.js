import test from "node:test";
import assert from "node:assert/strict";
import { peerPortForInstance, requiredPorts } from "../src/network.js";

test("Peer 端口默认等于游戏端口加一", () => {
  assert.equal(peerPortForInstance({ ports: { game: 7777 } }), 7778);
  assert.equal(peerPortForInstance({ ports: { game: 7790, peer: 7799 } }), 7799);
});

test("实例端口配置包含游戏、Peer、查询和 RCON", () => {
  assert.deepEqual(requiredPorts({ ports: { game: 7777, query: 27015, rcon: 27020 } }), {
    game: 7777,
    peer: 7778,
    query: 27015,
    rcon: 27020,
  });
});
