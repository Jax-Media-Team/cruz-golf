"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { HELP_ENTRIES, type HelpEntry } from "@/lib/help-knowledge";

function score(query: string, entry: HelpEntry): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const haystack = [entry.q, entry.a, ...(entry.keywords ?? [])].join(" ").toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (haystack.includes(t)) s += 2;
    if (entry.q.toLowerCase().includes(t)) s += 3;
    if ((entry.keywords ?? []).some((k) => k.toLowerCase().includes(t))) s += 4;
  }
  return s;
}

export function HelpButton() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const ranked = useMemo(() => {
    if (!query.trim()) return HELP_ENTRIES.map((e, i) => ({ entry: e, idx: i }));
    return HELP_ENTRIES
      .map((e, i) => ({ entry: e, idx: i, s: score(query, e) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
  }, [query]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-30 w-12 h-12 rounded-full bg-gold-500 text-brand-900 font-serif text-2xl shadow-soft active:scale-95 transition-transform"
        aria-label="Help"
        title="Help"
      >
        ?
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-brand-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="card w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl rounded-b-none sm:rounded-b-2xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-cream-100/10">
              <div>
                <p className="h-eyebrow text-gold-400">Help</p>
                <h2 className="font-serif text-xl text-cream-50 mt-0.5">Ask Cruz Golf</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="btn-ghost text-sm"
                aria-label="Close help"
              >
                ✕
              </button>
            </header>

            <div className="px-5 pt-4 pb-2">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setExpanded(null);
                }}
                placeholder="How do I invite people? How do skins work?"
                className="input w-full"
                aria-label="Search help"
              />
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
              {ranked.length === 0 && (
                <div className="text-sm text-cream-100/60 py-6 text-center">
                  No matches. Try shorter terms — &quot;invite&quot;, &quot;skins&quot;, &quot;handicap&quot; — or ask the commissioner.
                </div>
              )}
              {ranked.map(({ entry, idx }) => {
                const isOpen = expanded === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setExpanded(isOpen ? null : idx)}
                    className={`w-full text-left rounded-xl border transition-colors p-3 ${
                      isOpen
                        ? "border-gold-500/40 bg-brand-900/60"
                        : "border-cream-100/10 bg-brand-900/30 hover:bg-brand-900/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-serif text-cream-50 text-base leading-snug">{entry.q}</span>
                      <span className="text-cream-100/40 text-sm shrink-0">{isOpen ? "−" : "+"}</span>
                    </div>
                    {isOpen && (
                      <p className="mt-2 text-sm text-cream-100/80 leading-relaxed">{entry.a}</p>
                    )}
                  </button>
                );
              })}
            </div>

            <footer className="px-5 py-3 border-t border-cream-100/10 text-[11px] text-cream-100/45 text-center">
              Can&apos;t find it? Ask the commissioner of your group.
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
