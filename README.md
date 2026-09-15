# outbox-ledger

`@osionos/outbox-ledger` — an offline-first **confirmed-sync ledger**. It records, per entity id,
the stamp last *successfully* written to the server. An entity is pending whenever its desired
stamp differs from its ledger entry, or it was synced and is now gone.

Zero dependencies. The only ambient it touches is `globalThis.localStorage`, and it degrades
cleanly when that is absent (SSR, workers, private mode).

## Why it exists

The ledger is the "outbox, by difference": instead of maintaining a queue of pending mutations,
you diff what you *want* against what the server has *confirmed*. That makes the pending set a
pure function of two values, so it cannot drift out of sync with reality the way a hand-maintained
queue can.

**The invariant that makes it safe: the ledger advances only after the server confirms a write.**
Advance it optimistically and an outage silently discards edits.

## Install

Resolved through the host's bundler/compiler alias as TypeScript source — there is no build step.

```ts
import { computeSyncActions, loadLedger, saveLedger } from "@osionos/outbox-ledger";
```

## API

```ts
type SyncLedger = Record<string, string>;   // entityId → last CONFIRMED stamp

function loadLedger(key: string): SyncLedger;
function saveLedger(key: string, ledger: SyncLedger): void;

interface SyncActions {
  toPublish: string[];    // desired stamp ≠ confirmed stamp
  toUnpublish: string[];  // confirmed before, absent now
}
function computeSyncActions(
  desired: ReadonlyMap<string, string>,
  ledger: SyncLedger,
): SyncActions;
```

`computeSyncActions` is pure and does not mutate its inputs. The caller performs the writes and
advances the ledger **only on success**.

The storage key is supplied by the caller, so several independent engines (pages, notes, live
database mounts) can each keep their own ledger without colliding.

## Usage

```ts
const KEY = "app.synced.pages.v1";

const ledger = loadLedger(KEY);
const desired = new Map(pages.map((p) => [p.id, p.updatedAt]));
const { toPublish, toUnpublish } = computeSyncActions(desired, ledger);

for (const id of toPublish) {
  await server.put(id, byId(id));      // a throw here leaves the ledger untouched…
  ledger[id] = desired.get(id)!;       // …so the entity stays pending and retries later
}
for (const id of toUnpublish) {
  await server.delete(id);
  delete ledger[id];
}
saveLedger(KEY, ledger);
```

Stopping the batch on the first transient failure is deliberate: it prevents a dead server from
turning one outage into a burst of failing requests.

## Development

```sh
make help       # list targets
make check      # typecheck + tests
```
