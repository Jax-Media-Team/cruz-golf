"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PhotoPicker } from "@/components/PhotoPicker";

type Card = {
  id: string;
  filename: string;
  status: "uploading" | "parsed" | "failed";
  err?: string;
  rows?: Array<{ name: string; scores: Array<number | null> }>;
};

type GridRow = {
  round_player_id: string;
  name: string;
  /** scores indexed 0..holes-1; null = no value yet */
  scores: Array<number | null>;
  /** Where this row's scores came from (filenames). Empty = manual. */
  source_filenames: string[];
};

/**
 * Multi-scorecard upload + review.
 *
 * - Accept multiple files in one go (e.g., one card per foursome on an 8-player round)
 * - OCR each in parallel; show per-card status
 * - Merge OCR results into one grid keyed by player; if multiple cards have
 *   scores for the same player, later cards overwrite per-cell, but rows
 *   stay distinct visually with source-card indicators
 * - Editable cells before saving
 * - Confirms before overwriting existing DB scores on save
 * - Manual mode: skip uploads, show empty grid for hand-fill
 */
export function UploadView({
  roundId,
  holes,
  players
}: {
  roundId: string;
  holes: 9 | 18;
  players: Array<{ round_player_id: string; name: string }>;
}) {
  const router = useRouter();
  const sb = supabaseBrowser();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [grid, setGrid] = useState<GridRow[]>(() =>
    players.map((p) => ({
      round_player_id: p.round_player_id,
      name: p.name,
      scores: new Array(holes).fill(null),
      source_filenames: []
    }))
  );
  const [existingByPlayer, setExistingByPlayer] = useState<Record<string, Set<number>>>({});

  // Pull existing scores once on mount so we can warn if uploads would overwrite.
  useEffect(() => {
    (async () => {
      const rpIds = players.map((p) => p.round_player_id);
      if (rpIds.length === 0) return;
      const { data } = await sb
        .from("scores")
        .select("round_player_id, hole_number, gross")
        .in("round_player_id", rpIds);
      const map: Record<string, Set<number>> = {};
      for (const s of (data as any[]) ?? []) {
        if (s.gross == null) continue;
        const set = map[s.round_player_id] ?? new Set<number>();
        set.add(s.hole_number);
        map[s.round_player_id] = set;
      }
      setExistingByPlayer(map);
      // Pre-fill the grid with existing scores so we don't mistakenly drop them.
      setGrid((prev) =>
        prev.map((row) => {
          const filled = (data as any[])?.filter((s) => s.round_player_id === row.round_player_id) ?? [];
          if (filled.length === 0) return row;
          const next = [...row.scores];
          for (const s of filled) {
            if (s.gross != null && s.hole_number >= 1 && s.hole_number <= holes) {
              next[s.hole_number - 1] = s.gross;
            }
          }
          return { ...row, scores: next };
        })
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onFiles(files: FileList | File[]) {
    setErr(null);
    const list = Array.from(files);
    if (list.length === 0) return;
    const startCount = cards.length;
    const newCards: Card[] = list.map((f, i) => ({
      id: `c-${Date.now()}-${startCount + i}`,
      filename: f.name,
      status: "uploading"
    }));
    setCards((prev) => [...prev, ...newCards]);

    await Promise.all(
      list.map(async (file, i) => {
        const cardId = newCards[i].id;
        try {
          const dataUrl = await fileToDataUrl(file);
          const r = await fetch("/api/scorecard-ocr", {
            method: "POST",
            body: JSON.stringify({ dataUrl, players: players.map((p) => p.name), holes })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "OCR failed");
          const rows = (j.players ?? []) as Array<{ name: string; scores: Array<number | null> }>;
          setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, status: "parsed", rows } : c)));
          // Merge into grid: for each parsed row, find best-matching existing
          // grid row by fuzzy name match. Per-cell overwrite if the OCR cell
          // has a value.
          setGrid((prev) =>
            prev.map((row) => {
              const match = rows.find((x) => fuzzyMatch(x.name, row.name));
              if (!match) return row;
              const nextScores = row.scores.map((existing, idx) => {
                const ocrVal = match.scores[idx] ?? null;
                return ocrVal != null ? ocrVal : existing;
              });
              const sources = row.source_filenames.includes(file.name)
                ? row.source_filenames
                : [...row.source_filenames, file.name];
              return { ...row, scores: nextScores, source_filenames: sources };
            })
          );
        } catch (e: any) {
          setCards((prev) =>
            prev.map((c) => (c.id === cardId ? { ...c, status: "failed", err: e?.message ?? "OCR failed" } : c))
          );
        }
      })
    );
  }

  async function save() {
    setBusy(true);
    setErr(null);

    // Detect overwrites of existing values that the user kept (or that came
    // from OCR). We only confirm when we're about to OVERWRITE an existing
    // server-side cell with a DIFFERENT value.
    const overwrites: Array<{ name: string; hole: number }> = [];
    for (const row of grid) {
      const ex = existingByPlayer[row.round_player_id];
      if (!ex) continue;
      row.scores.forEach((v, i) => {
        const hole = i + 1;
        if (v != null && ex.has(hole)) {
          // We had an existing value; check if it'd be overwritten with a
          // different number. Without round-tripping the existing value here
          // (we already merged it into the grid on mount), this signals
          // "row touched cells that existed". Conservative: just warn.
          overwrites.push({ name: row.name, hole });
        }
      });
    }
    if (overwrites.length > 0) {
      const ok = confirm(
        `This save will write to ${overwrites.length} existing cell${overwrites.length === 1 ? "" : "s"}. Continue?`
      );
      if (!ok) {
        setBusy(false);
        return;
      }
    }

    const { data: userData } = await sb.auth.getUser();
    const inserts: any[] = [];
    for (const row of grid) {
      row.scores.forEach((g, i) => {
        if (g != null) {
          inserts.push({
            round_player_id: row.round_player_id,
            hole_number: i + 1,
            gross: g,
            updated_by: userData.user?.id ?? null,
            updated_at: new Date().toISOString()
          });
        }
      });
    }
    if (inserts.length === 0) {
      setBusy(false);
      setErr("No scores to save.");
      return;
    }
    const { error } = await sb
      .from("scores")
      .upsert(inserts, { onConflict: "round_player_id,hole_number" });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    router.push(`/rounds/${roundId}`);
  }

  function setCell(rowIdx: number, holeIdx: number, value: number | null) {
    setGrid((prev) =>
      prev.map((row, i) =>
        i === rowIdx
          ? { ...row, scores: row.scores.map((s, j) => (j === holeIdx ? value : s)) }
          : row
      )
    );
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <header>
        <p className="h-eyebrow">Card upload</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Upload scorecard photos</h1>
        <p className="text-sm text-cream-100/65 mt-1">
          Snap a photo per foursome (or front/back nine) and we&apos;ll OCR each one
          into the same grid. Confirm and edit before saving.
        </p>
      </header>

      <div className="card p-4 space-y-3">
        <div>
          <p className="label text-xs">Add photo(s)</p>
          <p className="text-[11px] text-cream-100/55 mt-0.5 mb-2">
            Take a fresh photo or choose a saved scorecard from your library
            — screenshots and texted images work too.
          </p>
          <PhotoPicker onFiles={onFiles}>
            {({ openCamera, openLibrary }) => (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openCamera}
                  className="btn-secondary text-sm"
                >
                  📸 Take photo
                </button>
                <button
                  type="button"
                  onClick={openLibrary}
                  className="btn-ghost text-sm"
                >
                  🖼 Choose from library
                </button>
              </div>
            )}
          </PhotoPicker>
        </div>

        {cards.length > 0 && (
          <ul className="text-xs space-y-1.5">
            {cards.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3">
                <span className="text-cream-100/85 truncate">{c.filename}</span>
                <span
                  className={
                    c.status === "uploading"
                      ? "text-cream-100/55"
                      : c.status === "failed"
                      ? "text-red-300"
                      : "text-emerald-300"
                  }
                >
                  {c.status === "uploading"
                    ? "OCR in progress…"
                    : c.status === "failed"
                    ? `Failed: ${c.err ?? ""}`
                    : `Parsed ${c.rows?.length ?? 0} player${c.rows?.length === 1 ? "" : "s"}`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {err && <p className="text-sm text-red-300">{err}</p>}

        <p className="text-[11px] text-cream-100/55">
          OCR is a best-effort parse. You can also skip uploads entirely and
          fill scores by hand in the grid below.
        </p>
      </div>

      <div className="card p-2 overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-cream-100/55 text-xs uppercase tracking-wide">
              <th className="p-2 text-left">Player</th>
              {Array.from({ length: holes }, (_, i) => (
                <th key={i} className="p-1 w-12 text-center">{i + 1}</th>
              ))}
              <th className="p-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {grid.map((row, idx) => {
              const total = row.scores.reduce((s: number, v) => s + (v ?? 0), 0);
              return (
                <tr key={row.round_player_id} className="border-t border-cream-100/8">
                  <td className="p-2 font-medium whitespace-nowrap text-cream-50">
                    <div>{row.name}</div>
                    {row.source_filenames.length > 0 && (
                      <div className="text-[10px] text-cream-100/45">
                        from {row.source_filenames.length} card
                        {row.source_filenames.length === 1 ? "" : "s"}
                      </div>
                    )}
                  </td>
                  {row.scores.map((v, i) => (
                    <td key={i} className="p-1">
                      <input
                        className="input w-12 px-1 text-center text-sm"
                        type="number"
                        inputMode="numeric"
                        value={v ?? ""}
                        onChange={(e) =>
                          setCell(idx, i, e.target.value === "" ? null : parseInt(e.target.value))
                        }
                      />
                    </td>
                  ))}
                  <td className="p-2 text-right tabular-nums text-cream-50">
                    {total > 0 ? total : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save scores"}
        </button>
      </div>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

function fuzzyMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na) || na.includes(nb) || nb.includes(na);
}
