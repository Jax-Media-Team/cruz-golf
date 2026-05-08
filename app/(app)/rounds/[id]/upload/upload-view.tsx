"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

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
  const [parsed, setParsed] = useState<Array<{ name: string; scores: Array<number | null> }>>([]);

  async function onFile(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const r = await fetch("/api/scorecard-ocr", {
        method: "POST",
        body: JSON.stringify({ dataUrl, players: players.map((p) => p.name), holes })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "OCR failed");
      // For each provided player, find a matching parsed row or seed empty.
      const seeded = players.map((p) => {
        const match = j.players?.find((x: any) => fuzzyMatch(x.name, p.name));
        return { name: p.name, scores: match?.scores ?? new Array(holes).fill(null) };
      });
      setParsed(seeded);
    } catch (e: any) {
      setErr(e?.message ?? "OCR failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    const { data: userData } = await sb.auth.getUser();
    const inserts: any[] = [];
    for (const row of parsed) {
      const target = players.find((p) => p.name === row.name);
      if (!target) continue;
      row.scores.forEach((g, i) => {
        if (g != null) {
          inserts.push({
            round_player_id: target.round_player_id,
            hole_number: i + 1,
            gross: g,
            updated_by: userData.user?.id ?? null,
            updated_at: new Date().toISOString()
          });
        }
      });
    }
    if (inserts.length) {
      const { error } = await sb.from("scores").upsert(inserts, { onConflict: "round_player_id,hole_number" });
      if (error) {
        setBusy(false);
        setErr(error.message);
        return;
      }
    }
    setBusy(false);
    router.push(`/rounds/${roundId}`);
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <header>
        <p className="h-eyebrow">Card photo</p>
        <h1 className="h-display text-3xl text-cream-50 mt-1">Upload scorecard photo</h1>
      </header>
      <p className="text-sm text-cream-100/70">
        Take a photo of the paper card. We&apos;ll OCR it and pre-fill the grid below for you to confirm before saving.
      </p>
      <div className="card p-4">
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        {busy && <p className="mt-2 text-sm text-cream-100/55">Processing…</p>}
        {err && <p className="mt-2 text-sm text-red-300">{err}</p>}
      </div>

      {parsed.length > 0 && (
        <div className="card p-2 overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="text-cream-100/55 text-xs uppercase tracking-wide">
                <th className="p-2 text-left">Player</th>
                {Array.from({ length: holes }, (_, i) => <th key={i} className="p-1 w-12 text-center">{i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {parsed.map((p, idx) => (
                <tr key={idx} className="border-t border-cream-100/8">
                  <td className="p-2 font-medium whitespace-nowrap text-cream-50">{p.name}</td>
                  {p.scores.map((v, i) => (
                    <td key={i} className="p-1">
                      <input
                        className="input w-12 px-1 text-center"
                        type="number"
                        value={v ?? ""}
                        onChange={(e) => {
                          const next = [...parsed];
                          next[idx] = {
                            ...next[idx],
                            scores: next[idx].scores.map((x, j) => (j === i ? (e.target.value === "" ? null : parseInt(e.target.value)) : x))
                          };
                          setParsed(next);
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {parsed.length > 0 && (
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save scores"}
        </button>
      )}
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
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}
