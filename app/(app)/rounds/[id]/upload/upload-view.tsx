"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PhotoPicker } from "@/components/PhotoPicker";
import { bestMatch } from "@/lib/ocr/name-match";

type Card = {
  id: string;
  filename: string;
  status: "uploading" | "parsed" | "failed";
  err?: string;
  rows?: Array<{ name: string; scores: Array<number | null> }>;
  /** Total non-null cells parsed across all player rows on this card. */
  score_count?: number;
  /** Total cells the card SHOULD have (rows × holes). */
  cells_total?: number;
  /** Diagnostics from the OCR endpoint (raw model text + pre/post
   *  coerce shapes). Surfaced in a collapsible panel for "where did
   *  the scores get lost" debugging. */
  debug?: {
    raw_text: string;
    pre_coerce: any;
    post_coerce: any;
  };
  /** Per-row outcome captured during the merge step — what the score
   *  count was, who it matched, why it was dropped if unmatched.
   *  Used by the diagnostics panel so failure modes are legible. */
  row_outcomes?: Array<{
    ocr_name: string;
    scores_parsed: number;
    matched_to: string | null;
    match_score: number;
    outcome: "merged" | "unmatched_panel" | "dropped_no_name_no_scores";
  }>;
};

type CellSource = "db" | "ocr" | "manual" | null;

type GridRow = {
  round_player_id: string;
  name: string;
  /** scores indexed 0..holes-1; null = no value yet */
  scores: Array<number | null>;
  /** Per-cell provenance — so OCR'd cells can be visually marked for review. */
  sources: Array<CellSource>;
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
      sources: new Array<CellSource>(holes).fill(null),
      source_filenames: []
    }))
  );
  const [existingByPlayer, setExistingByPlayer] = useState<Record<string, Set<number>>>({});
  // OCR rows we couldn't auto-match to a round player. Surfaced as a
  // "Map these rows" panel — the user picks the right player from a
  // dropdown and the scores merge into the grid. This was the major
  // dead-end before: rows that didn't fuzzy-match were silently
  // dropped, so a card with "Pat" couldn't reach "Patrick Cruz".
  type UnmatchedRow = {
    id: string;
    ocr_name: string;
    scores: Array<number | null>;
    /** Suggested round_player_id from bestMatch (may be null). */
    suggested_rp_id: string | null;
    suggested_score: number; // bestMatch score, 0-100
    filename: string;
  };
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);

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
          const sources = [...row.sources];
          for (const s of filled) {
            if (s.gross != null && s.hole_number >= 1 && s.hole_number <= holes) {
              next[s.hole_number - 1] = s.gross;
              sources[s.hole_number - 1] = "db";
            }
          }
          return { ...row, scores: next, sources };
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
          // Count successfully-parsed cells so the card list can show
          // "Read 56 of 72 cells" instead of just "Parsed 4 players".
          const score_count = rows.reduce(
            (sum, p) => sum + p.scores.filter((s) => s != null).length,
            0
          );
          const cells_total = rows.length * holes;
          // Capture diagnostics (raw model text + pre/post coerce) so
          // the UI can surface "where did scores get lost?" when the
          // grid comes back empty. The API returns _debug on every
          // call; we just stash it on the card row.
          const debug = (j._debug ?? undefined) as Card["debug"];
          setCards((prev) =>
            prev.map((c) =>
              c.id === cardId
                ? { ...c, status: "parsed", rows, score_count, cells_total, debug }
                : c
            )
          );
          // Merge into grid: for each parsed row, find the best-
          // scoring matching player via bestMatch (handles
          // initials, comma-reversed names, nickname → full-name,
          // etc.). Per-cell overwrite if the OCR cell has a value.
          // Unmatched rows (no candidate scored > 0) go into the
          // `unmatched` list with a "Map to:" dropdown — the user
          // resolves them manually instead of losing the scores.
          const roundPlayerCandidates = players.map((p) => ({
            round_player_id: p.round_player_id,
            name: p.name
          }));
          const matchAssignments = new Map<string, number>(); // rp_id → row index
          rows.forEach((row, rowIdx) => {
            const best = bestMatch(row.name, roundPlayerCandidates);
            if (best) matchAssignments.set(best.round_player_id, rowIdx);
          });

          setGrid((prev) =>
            prev.map((row) => {
              const matchedIdx = matchAssignments.get(row.round_player_id);
              if (matchedIdx == null) return row;
              const match = rows[matchedIdx];
              const nextScores = row.scores.map((existing, idx) => {
                const ocrVal = match.scores[idx] ?? null;
                return ocrVal != null ? ocrVal : existing;
              });
              const nextSources = row.sources.map((existingSrc, idx) => {
                const ocrVal = match.scores[idx] ?? null;
                if (ocrVal != null) return "ocr" as CellSource;
                return existingSrc;
              });
              const sources = row.source_filenames.includes(file.name)
                ? row.source_filenames
                : [...row.source_filenames, file.name];
              return {
                ...row,
                scores: nextScores,
                sources: nextSources,
                source_filenames: sources
              };
            })
          );

          // Track unmatched rows for manual mapping. Skip rows that
          // have zero scores AND no name (pure noise).
          // Also build the per-row outcome list for the diagnostics
          // panel — every row that went through the pipeline gets one
          // entry so "where did the scores go" is answerable per row.
          const matchedRowIndexes = new Set(matchAssignments.values());
          const newUnmatched: UnmatchedRow[] = [];
          const rowOutcomes: NonNullable<Card["row_outcomes"]> = [];
          rows.forEach((row, idx) => {
            const scoreCount = row.scores.filter((s) => s != null).length;
            const best = bestMatch(row.name, roundPlayerCandidates);

            if (matchedRowIndexes.has(idx)) {
              // Find which round_player_id this row was assigned to
              // (the inverse of matchAssignments).
              let matchedRpId: string | null = null;
              for (const [rpId, assignedIdx] of matchAssignments) {
                if (assignedIdx === idx) {
                  matchedRpId = rpId;
                  break;
                }
              }
              const matchedRp = players.find(
                (p) => p.round_player_id === matchedRpId
              );
              rowOutcomes.push({
                ocr_name: row.name || `Row ${idx + 1}`,
                scores_parsed: scoreCount,
                matched_to: matchedRp?.name ?? null,
                match_score: best?.score ?? 0,
                outcome: "merged"
              });
              return;
            }
            if (!row.name && scoreCount === 0) {
              rowOutcomes.push({
                ocr_name: row.name || `Row ${idx + 1}`,
                scores_parsed: 0,
                matched_to: null,
                match_score: 0,
                outcome: "dropped_no_name_no_scores"
              });
              return;
            }
            rowOutcomes.push({
              ocr_name: row.name || `Row ${idx + 1}`,
              scores_parsed: scoreCount,
              matched_to: null,
              match_score: best?.score ?? 0,
              outcome: "unmatched_panel"
            });
            newUnmatched.push({
              id: `${cardId}-${idx}`,
              ocr_name: row.name || `Row ${idx + 1}`,
              scores: row.scores,
              suggested_rp_id: best?.round_player_id ?? null,
              suggested_score: best?.score ?? 0,
              filename: file.name
            });
          });
          if (newUnmatched.length > 0) {
            setUnmatched((prev) => [...prev, ...newUnmatched]);
          }
          // Stash the per-row outcomes on the card so the diagnostics
          // panel can render them.
          setCards((prev) =>
            prev.map((c) =>
              c.id === cardId ? { ...c, row_outcomes: rowOutcomes } : c
            )
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
      setErr(
        "Add at least one score before saving — type values in the grid below, or upload a scorecard photo above."
      );
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
          ? {
              ...row,
              scores: row.scores.map((s, j) => (j === holeIdx ? value : s)),
              // Manual edit flips this cell's source to "manual" so the
              // OCR-highlight goes away after the user touches it.
              sources: row.sources.map((src, j) =>
                j === holeIdx ? (value == null ? null : "manual") : src
              )
            }
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
              <li key={c.id} className="space-y-1">
                <div className="flex items-center justify-between gap-3">
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
                      : (() => {
                          const players = c.rows?.length ?? 0;
                          const cells = c.score_count ?? 0;
                          const cellsTotal = c.cells_total ?? 0;
                          if (cells === 0) {
                            return `Parsed ${players} player${players === 1 ? "" : "s"} · no scores read — see diagnostics`;
                          }
                          const pct = cellsTotal > 0 ? Math.round((cells / cellsTotal) * 100) : 0;
                          return `Read ${cells} of ${cellsTotal} cells (${pct}%) · review highlighted cells`;
                        })()}
                  </span>
                </div>
                {/* Diagnostics — collapsible per-card. Patrick asked
                    to see EXACTLY where scores get lost. We expose:
                    1) per-row outcomes (merged / mapping panel /
                       dropped), with match score
                    2) the raw model text — so a "model returned
                       all nulls" failure is legible
                    Always shown for parsed/failed cards; the
                    diagnostics state is captured on every OCR call.
                */}
                {(c.status === "parsed" || c.status === "failed") &&
                  (c.row_outcomes || c.debug) && (
                    <details className="text-[11px] text-cream-100/65 pl-3 border-l border-cream-100/10">
                      <summary className="cursor-pointer hover:text-cream-100/85 select-none">
                        Diagnostics — what the OCR saw
                      </summary>
                      <div className="mt-2 space-y-2 pl-2">
                        {c.row_outcomes && c.row_outcomes.length > 0 && (
                          <div>
                            <p className="font-medium text-cream-100/75">
                              Per-row outcome ({c.row_outcomes.length})
                            </p>
                            <ul className="space-y-1 mt-1">
                              {c.row_outcomes.map((o, i) => {
                                const tone =
                                  o.outcome === "merged"
                                    ? "text-emerald-300"
                                    : o.outcome === "unmatched_panel"
                                    ? "text-amber-300"
                                    : "text-cream-100/45";
                                return (
                                  <li
                                    key={i}
                                    className="flex items-start justify-between gap-2"
                                  >
                                    <span className="font-mono truncate">
                                      &ldquo;{o.ocr_name}&rdquo;
                                    </span>
                                    <span className={`shrink-0 ${tone}`}>
                                      {o.scores_parsed} score
                                      {o.scores_parsed === 1 ? "" : "s"} ·{" "}
                                      {o.outcome === "merged"
                                        ? `→ ${o.matched_to} (${o.match_score}%)`
                                        : o.outcome === "unmatched_panel"
                                        ? o.match_score > 0
                                          ? `mapping (${o.match_score}% best)`
                                          : "mapping (no suggestion)"
                                        : "dropped — empty row"}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                        {c.debug?.raw_text && (
                          <details className="text-[10px] font-mono">
                            <summary className="cursor-pointer hover:text-cream-100/85">
                              Raw model output
                            </summary>
                            <pre className="mt-1 whitespace-pre-wrap break-all text-cream-100/55 max-h-48 overflow-auto">
                              {c.debug.raw_text}
                            </pre>
                          </details>
                        )}
                      </div>
                    </details>
                  )}
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

      {grid.some((r) => r.sources.some((s) => s === "ocr")) && (
        <div className="card p-3 border border-amber-400/30 bg-amber-500/5 text-xs text-cream-100/85 flex items-center gap-3 flex-wrap">
          <span className="inline-block w-3 h-3 rounded-sm ring-1 ring-amber-400/60 bg-amber-500/10 shrink-0" />
          <span>
            Amber cells came from the scorecard photo. Tap any to review or
            fix. Cells with a dashed outline are still blank.
          </span>
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="card p-4 border border-amber-400/40 bg-amber-500/5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="h-eyebrow text-amber-300">
                Map {unmatched.length} row
                {unmatched.length === 1 ? "" : "s"} to players
              </p>
              <p className="text-xs text-cream-100/75 mt-1 leading-snug">
                The scorecard had these names that didn&apos;t auto-match.
                Pick the right player and the scores will merge into the
                grid below. Skip a row to drop it.
              </p>
            </div>
            {unmatched.some((u) => u.suggested_rp_id) && (
              <button
                type="button"
                onClick={() => {
                  // Merge every row that has a suggested player. Rows
                  // without a suggestion stay in the panel for manual
                  // mapping. Useful when the user just wants to
                  // accept all the bestMatch picks at once.
                  const toMerge = unmatched.filter(
                    (u) => u.suggested_rp_id
                  );
                  if (toMerge.length === 0) return;
                  setGrid((prev) =>
                    prev.map((row) => {
                      const match = toMerge.find(
                        (u) => u.suggested_rp_id === row.round_player_id
                      );
                      if (!match) return row;
                      const nextScores = row.scores.map((existing, idx) => {
                        const ocrVal = match.scores[idx] ?? null;
                        return ocrVal != null ? ocrVal : existing;
                      });
                      const nextSources = row.sources.map(
                        (existingSrc, idx) => {
                          const ocrVal = match.scores[idx] ?? null;
                          if (ocrVal != null) return "ocr" as CellSource;
                          return existingSrc;
                        }
                      );
                      const sources = row.source_filenames.includes(match.filename)
                        ? row.source_filenames
                        : [...row.source_filenames, match.filename];
                      return {
                        ...row,
                        scores: nextScores,
                        sources: nextSources,
                        source_filenames: sources
                      };
                    })
                  );
                  setUnmatched((prev) =>
                    prev.filter((u) => !u.suggested_rp_id)
                  );
                }}
                className="btn-secondary text-xs shrink-0"
                title="Apply all suggested matches in one tap"
              >
                Merge all suggested
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {unmatched.map((u) => {
              const scoredCells = u.scores.filter((s) => s != null).length;
              return (
                <li
                  key={u.id}
                  className="rounded-xl border border-cream-100/12 bg-brand-900/30 p-3 space-y-2"
                >
                  {/* Top row: OCR name + meta. Always full-width. */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-cream-50 text-sm truncate">
                        &ldquo;{u.ocr_name}&rdquo;
                      </div>
                      <p className="text-[11px] text-cream-100/55 mt-0.5">
                        {scoredCells} score
                        {scoredCells === 1 ? "" : "s"} parsed · from{" "}
                        {u.filename}
                      </p>
                    </div>
                    {u.suggested_rp_id && u.suggested_score > 0 && (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30 shrink-0">
                        {u.suggested_score}% match
                      </span>
                    )}
                  </div>
                  {/* Action row: full-width select on mobile, inline
                      on sm+. Buttons sit below so they don't pinch the
                      select into a tiny touch target. */}
                  <div className="flex items-stretch gap-2 flex-col sm:flex-row">
                    <select
                      className="input text-sm flex-1 min-w-0"
                      value={u.suggested_rp_id ?? ""}
                      onChange={(e) => {
                        const rpId = e.target.value;
                        setUnmatched((prev) =>
                          prev.map((row) =>
                            row.id === u.id
                              ? { ...row, suggested_rp_id: rpId || null }
                              : row
                          )
                        );
                      }}
                      aria-label="Map this row to a player"
                    >
                      <option value="">— pick player —</option>
                      {players.map((p) => (
                        <option key={p.round_player_id} value={p.round_player_id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        className="btn-primary text-xs flex-1 sm:flex-none"
                        disabled={!u.suggested_rp_id}
                        onClick={() => {
                          if (!u.suggested_rp_id) return;
                          setGrid((prev) =>
                            prev.map((row) => {
                              if (row.round_player_id !== u.suggested_rp_id)
                                return row;
                              const nextScores = row.scores.map((existing, idx) => {
                                const ocrVal = u.scores[idx] ?? null;
                                return ocrVal != null ? ocrVal : existing;
                              });
                              const nextSources = row.sources.map(
                                (existingSrc, idx) => {
                                  const ocrVal = u.scores[idx] ?? null;
                                  if (ocrVal != null) return "ocr" as CellSource;
                                  return existingSrc;
                                }
                              );
                              const sources = row.source_filenames.includes(u.filename)
                                ? row.source_filenames
                                : [...row.source_filenames, u.filename];
                              return {
                                ...row,
                                scores: nextScores,
                                sources: nextSources,
                                source_filenames: sources
                              };
                            })
                          );
                          setUnmatched((prev) =>
                            prev.filter((row) => row.id !== u.id)
                          );
                        }}
                      >
                        Merge →
                      </button>
                      <button
                        type="button"
                        className="btn-ghost text-xs text-cream-100/55 flex-1 sm:flex-none"
                        onClick={() =>
                          setUnmatched((prev) =>
                            prev.filter((row) => row.id !== u.id)
                          )
                        }
                        title="Drop this row — its scores won't be saved"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
                  {row.scores.map((v, i) => {
                    // Visual provenance: amber outline on OCR-extracted
                    // cells so the user knows what to review. db cells
                    // (loaded from server) are default. manual cells
                    // (user typed) are default. Empty cells get a faint
                    // dashed border so missing cells are scannable.
                    const src = row.sources[i];
                    const tone =
                      src === "ocr"
                        ? "ring-1 ring-amber-400/60 bg-amber-500/10"
                        : v == null
                        ? "border border-dashed border-cream-100/15"
                        : "";
                    return (
                      <td key={i} className="p-1">
                        <input
                          className={`input w-12 px-1 text-center text-sm ${tone}`}
                          type="number"
                          inputMode="numeric"
                          value={v ?? ""}
                          title={
                            src === "ocr"
                              ? "Read from scorecard photo — review before saving"
                              : src === "db"
                              ? "Saved on the server"
                              : src === "manual"
                              ? "Hand-entered"
                              : "Blank — tap to fill"
                          }
                          onChange={(e) =>
                            setCell(
                              idx,
                              i,
                              e.target.value === ""
                                ? null
                                : parseInt(e.target.value)
                            )
                          }
                        />
                      </td>
                    );
                  })}
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

// fuzzy name matching lives in lib/ocr/name-match.ts (testable in
// isolation). Use bestMatch / fuzzyMatchScore there for any new code.
