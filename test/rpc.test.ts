// Imports the contracts through the real defineRpc, which refuses an invalid
// name when the module loads, as the daemon does when it loads the server entry.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as contracts from "../shared/rpc.ts";

// Paseo's RPC_NAME in packages/plugin/src/rpc.ts at v0.15.3.
const RPC_NAME = /^[a-z][a-z0-9._-]*$/;

describe("RPC contracts", () => {
  const rpcs = Object.entries(contracts).flatMap(([exported, value]: [string, unknown]) =>
    typeof value === "object" && value !== null && "input" in value && "name" in value && typeof value.name === "string"
      ? [[exported, { name: value.name }] as const]
      : [],
  );

  it("finds every contract", () => {
    assert.equal(rpcs.length, 5);
  });

  for (const [exported, { name }] of rpcs) {
    it(`${exported} has a name Paseo accepts`, () => {
      assert.match(name, RPC_NAME);
    });
  }
});
