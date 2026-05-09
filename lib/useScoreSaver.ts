"use client";
/**
 * Hook that owns score persistence. Guarantees:
 *  - every score the user enters either reaches the DB OR shows up as failed
 *  - writes survive page reloads via a localStorage queue (drained on mount)
 *  - retries on transient errors with exponential backoff
 *  - exposes per-key status so the UI can show pending / saved / failed
 *
 * Why this exists: the previous save paths fired-and-forgot the upsert. If RLS,
 * network, or auth denied the write, the local React state would still show the
 * score and the user would think it was saved. Closing the browser would then
 * lose every "saved" score that never actually reached Postgres.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "./supabase/client";
import { retry } from "./retry";
import {
  type PendingItem,
  type SaveKey,
  QUEUE_STORAGE_KEY,
  deserialize,
  dropHead,
  enqueueOrReplace,
  makeKey,
  serialize
} from "./score-queue";

type Status = "idle" | "saving" | "saved" | "failed";

function loadQueue(): PendingItem[] {
  if (typeof window === "undefined") return [];
  return deserialize(window.localStorage.getItem(QUEUE_STORAGE_KEY));
}

function saveQueue(items: PendingItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, serialize(items));
  } catch {
    /* localStorage full or disabled — write was already attempted; nothing else to do */
  }
}

export type SaverState = {
  /** Per-key status keyed by `${rpId}:${hole}` */
  status: Record<SaveKey, Status>;
  /** Most recent error per key (for surfacing to the user) */
  errors: Record<SaveKey, string>;
  /** Total items still in flight. Useful for an unsaved-changes warning. */
  pending: number;
};

export function useScoreSaver(scope: { roundId: string }) {
  const sb = supabaseBrowser();
  const [state, setState] = useState<SaverState>({ status: {}, errors: {}, pending: 0 });
  const queueRef = useRef<PendingItem[]>([]);
  const drainingRef = useRef(false);

  const setStatus = useCallback((key: SaveKey, status: Status, err?: string) => {
    setState((s) => {
      const nextStatus = { ...s.status, [key]: status };
      const nextErrors = { ...s.errors };
      if (err) nextErrors[key] = err;
      else if (status === "saved" || status === "saving") delete nextErrors[key];
      const pending = Object.values(nextStatus).filter((v) => v === "saving" || v === "failed").length;
      return { status: nextStatus, errors: nextErrors, pending };
    });
  }, []);

  const persistQueue = useCallback(() => {
    saveQueue(queueRef.current);
  }, []);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      // Park items by index so a stuck head doesn't block the queue. We walk
      // forward until we've tried every item; failed ones stay marked as
      // "failed" but other writes continue.
      let i = 0;
      while (i < queueRef.current.length) {
        const item = queueRef.current[i];
        setStatus(item.key, "saving");
        try {
          const { data: userData } = await sb.auth.getUser();
          const writer = async () => {
            const { error } = await sb.from("scores").upsert(
              {
                round_player_id: item.round_player_id,
                hole_number: item.hole_number,
                gross: item.gross,
                updated_by: userData.user?.id ?? null,
                updated_at: new Date().toISOString()
              },
              { onConflict: "round_player_id,hole_number" }
            );
            if (error) throw error;
          };
          await retry(writer, { attempts: 3, baseMs: 400 });
          // Success — remove this item. Other items shift down so we don't
          // increment i.
          queueRef.current = queueRef.current.filter((_, idx) => idx !== i);
          persistQueue();
          setStatus(item.key, "saved");
        } catch (e: any) {
          // Failed after retries. Leave it in the queue but skip past it so
          // the next item can attempt to write. Surfaces as "failed" in the
          // banner; user can Retry or Discard.
          item.attempts += 1;
          persistQueue();
          // eslint-disable-next-line no-console
          console.error("[score-saver] save failed", {
            round_player_id: item.round_player_id,
            hole_number: item.hole_number,
            gross: item.gross,
            attempts: item.attempts,
            error: e?.message ?? e
          });
          setStatus(item.key, "failed", e?.message ?? "Save failed");
          i += 1;
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, [sb, setStatus, persistQueue]);

  // Boot: load any queued items from a previous session and drain.
  useEffect(() => {
    const loaded = loadQueue();
    if (loaded.length > 0) {
      queueRef.current = loaded;
      // Mark them as saving so the UI shows pending dots.
      for (const it of loaded) setStatus(it.key, "saving");
      void drain();
    }
    // Drain on tab focus / online — covers the laptop-closed-and-reopened path.
    const onWake = () => {
      if (queueRef.current.length > 0) void drain();
    };
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);

    // Also drain on auth state change — when a user signs back in after a
    // session expiry, any items that were parked as "failed" due to 401
    // should automatically retry with the fresh token. Without this, items
    // sit forever even though the user can now write.
    const { data: authSub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (queueRef.current.length > 0) {
          // Reset all "failed" items back to "saving" so they get a fresh
          // attempt on the next drain.
          setState((s) => {
            const next = { ...s.status };
            for (const k of Object.keys(next)) {
              if (next[k] === "failed") next[k] = "saving";
            }
            return { ...s, status: next, errors: {} };
          });
          void drain();
        }
      }
    });

    return () => {
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      authSub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    (round_player_id: string, hole_number: number, gross: number) => {
      const key: SaveKey = makeKey(round_player_id, hole_number);
      queueRef.current = enqueueOrReplace(queueRef.current, {
        key,
        round_player_id,
        hole_number,
        gross,
        attempts: 0,
        enqueuedAt: Date.now()
      });
      persistQueue();
      setStatus(key, "saving");
      void drain();
    },
    [drain, persistQueue, setStatus]
  );

  // Warn the user if they try to leave with pending writes.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (state.pending > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state.pending]);

  // Clear all queued items. Used when items are stuck (e.g., RLS denial on
  // a deleted round_player_id from a prior test) and the user wants to
  // start fresh without losing any other on-screen state.
  const discard = useCallback(() => {
    const ids = queueRef.current.map((it) => it.key);
    queueRef.current = [];
    persistQueue();
    setState((s) => {
      const status = { ...s.status };
      const errors = { ...s.errors };
      for (const id of ids) {
        delete status[id];
        delete errors[id];
      }
      const pending = Object.values(status).filter((v) => v === "saving" || v === "failed").length;
      return { status, errors, pending };
    });
  }, [persistQueue]);

  return { save, state, retry: drain, discard };
}
