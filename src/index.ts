/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   outboxLedger.ts                                     :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/06/03 12:00:00 by dlesieur          #+#    #+#             */
/*   Updated: 2026/06/03 12:00:00 by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

/**
 * Generic confirmed-sync ledger (the OUTBOX, by difference). It records, per entity id,
 * the stamp last SUCCESSFULLY written to the server. An entity is "pending" whenever its
 * desired stamp differs from its ledger entry, or it was synced and is now gone. The
 * ledger persists to localStorage so pending writes survive a reload during an outage,
 * and it is only advanced AFTER the server confirms a write — so nothing made offline is
 * lost. Engine-agnostic: each caller (notes, pages) passes its own storage key.
 */

/** entityId → last stamp CONFIRMED-written to the server. */
export type SyncLedger = Record<string, string>;

// A save the storage refuses (a full origin) must not make the next load stale: every outbox flush
// reloads the ledger, and a stale one republishes pages already confirmed — this tab's older copy
// over a newer edit made elsewhere, the server taking the client's updatedAt as given. osionos'
// live demo origin sat at 96% of its quota with these writes failing silently (2026-10-14). So
// each storage object keeps this session's copy of every key saved through it, and a load answers
// from that first. Keyed by the storage object: a test's fresh stub starts clean.
// Ponytail: a tab no longer reads another tab's confirmations within a session, and the disk copy
// is last-writer-wins: the tab that saves last writes its whole ledger over the other's. A fresh
// tab can then find an older stamp there and republish an older body over a newer confirmed edit
// (devil C2, two tabs). Saving a merge onto a fresh disk read is the planned fix.
const sessionCopies = new WeakMap<object, Map<string, SyncLedger>>();

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // a sandboxed frame throws on access
  }
}

export function loadLedger(key: string): SyncLedger {
  const storage = storageOrNull();
  const mine = storage ? sessionCopies.get(storage)?.get(key) : undefined;
  if (mine) return { ...mine };
  try {
    const raw = storage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    // An array is an object too, but ids set on it are dropped by JSON.stringify: a ledger
    // stored as "[]" (osionos' page cache once overwrote it) would never persist again.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as SyncLedger) : {};
  } catch {
    return {};
  }
}

/** Keeps the ledger for this session and writes it; true once it is on disk. A refused write
 *  (quota) calls `makeRoom` once and retries. Without storage the ledger lives nowhere — the
 *  caller's own state is then the only copy, as before. */
export function saveLedger(key: string, ledger: SyncLedger, makeRoom?: () => void): boolean {
  const storage = storageOrNull();
  if (!storage) return false;
  let copies = sessionCopies.get(storage);
  if (!copies) sessionCopies.set(storage, (copies = new Map()));
  copies.set(key, { ...ledger });
  const text = JSON.stringify(ledger);
  try {
    storage.setItem(key, text);
    return true;
  } catch {
    if (!makeRoom) return false;
  }
  try {
    makeRoom();
    storage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export interface SyncActions {
  /** ids whose desired stamp differs from the confirmed ledger → (re)publish. */
  toPublish: string[];
  /** ids confirmed-synced before but no longer present → drop (delete or forget). */
  toUnpublish: string[];
}

/**
 * Diff the desired stamps (from a store) against the confirmed-sync ledger. Pure — the
 * orchestrator performs the writes and advances the ledger only on success.
 */
export function computeSyncActions(
  desired: ReadonlyMap<string, string>,
  ledger: SyncLedger,
): SyncActions {
  const toPublish: string[] = [];
  for (const [id, stamp] of desired) {
    if (ledger[id] !== stamp) toPublish.push(id);
  }
  const toUnpublish: string[] = [];
  for (const id of Object.keys(ledger)) {
    if (!desired.has(id)) toUnpublish.push(id);
  }
  return { toPublish, toUnpublish };
}
