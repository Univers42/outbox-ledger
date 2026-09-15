import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeSyncActions,
  loadLedger,
  saveLedger,
  type SyncLedger,
} from "../src/index.ts";

/** Minimal in-memory localStorage so the ledger's persistence path is testable. */
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

test("computeSyncActions: an unseen id is pending", () => {
  const desired = new Map([["a", "s1"]]);
  assert.deepEqual(computeSyncActions(desired, {}), {
    toPublish: ["a"],
    toUnpublish: [],
  });
});

test("computeSyncActions: a confirmed id at the same stamp is NOT republished", () => {
  const desired = new Map([["a", "s1"]]);
  assert.deepEqual(computeSyncActions(desired, { a: "s1" }), {
    toPublish: [],
    toUnpublish: [],
  });
});

test("computeSyncActions: a changed stamp republishes", () => {
  const desired = new Map([["a", "s2"]]);
  assert.deepEqual(computeSyncActions(desired, { a: "s1" }), {
    toPublish: ["a"],
    toUnpublish: [],
  });
});

test("computeSyncActions: an id dropped from desired unpublishes", () => {
  assert.deepEqual(computeSyncActions(new Map(), { a: "s1" }), {
    toPublish: [],
    toUnpublish: ["a"],
  });
});

test("computeSyncActions: empty on both sides is a no-op", () => {
  assert.deepEqual(computeSyncActions(new Map(), {}), {
    toPublish: [],
    toUnpublish: [],
  });
});

test("computeSyncActions: does not mutate its inputs", () => {
  const desired = new Map([["a", "s2"]]);
  const ledger: SyncLedger = { a: "s1", b: "s1" };
  computeSyncActions(desired, ledger);
  assert.deepEqual(ledger, { a: "s1", b: "s1" });
  assert.deepEqual([...desired], [["a", "s2"]]);
});

test("load/save round-trips through storage", () => {
  installMemoryStorage();
  saveLedger("k", { a: "s1" });
  assert.deepEqual(loadLedger("k"), { a: "s1" });
});

test("loadLedger returns {} for a missing key", () => {
  installMemoryStorage();
  assert.deepEqual(loadLedger("absent"), {});
});

test("loadLedger returns {} on malformed JSON rather than throwing", () => {
  const store = installMemoryStorage();
  store.set("k", "{not json");
  assert.deepEqual(loadLedger("k"), {});
});

test("loadLedger returns {} when the stored value is not an object", () => {
  const store = installMemoryStorage();
  store.set("k", '"a string"');
  assert.deepEqual(loadLedger("k"), {});
});

test("saveLedger swallows storage failures (quota / private mode)", () => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceeded");
    },
  };
  assert.doesNotThrow(() => saveLedger("k", { a: "s1" }));
});

test("works with no localStorage at all (SSR / worker)", () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.deepEqual(loadLedger("k"), {});
  assert.doesNotThrow(() => saveLedger("k", { a: "s1" }));
});
