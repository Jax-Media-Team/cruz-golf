"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { HELP_ENTRIES, type HelpEntry } from "@/lib/help-knowledge";

type Mode = "ask" | "browse";
type ChatTurn = { role: "user" | "assistant"; text: string; provider?: string };

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
  const [mode, setMode] = useState<Mode>("ask");
  const [question, setQuestion] = useState("");
  const [browseQuery, setBrowseQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasLlm, setHasLlm] = useState<boolean | null>(null); // null = unknown until first try
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll the chat to the bottom when a new message arrives.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat, busy]);

  const ranked = useMemo(() => {
    if (!browseQuery.trim()) return HELP_ENTRIES.map((e, i) => ({ entry: e, idx: i }));
    return HELP_ENTRIES.map((e, i) => ({ entry: e, idx: i, s: score(browseQuery, e) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
  }, [browseQuery]);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    setErr(null);
    setChat((c) => [...c, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await fetch("/api/help/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      if (res.status === 501) {
        setHasLlm(false);
        // Fall back to FAQ search inline.
        const faqMatches = HELP_ENTRIES.map((e, i) => ({ e, s: score(q, e) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 3);
        const fallback =
          faqMatches.length > 0
            ? `I don't have AI configured here yet, but the FAQ has these matches:\n\n${faqMatches.map((m) => `**${m.e.q}**\n${m.e.a}`).join("\n\n")}`
            : "I don't have AI configured yet and the FAQ doesn't match. Try asking the commissioner of your group.";
        setChat((c) => [...c, { role: "assistant", text: fallback }]);
      } else if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `${res.status}`);
      } else {
        const json = (await res.json()) as { answer: string; provider: string };
        setHasLlm(true);
        setChat((c) => [...c, { role: "assistant", text: json.answer, provider: json.provider }]);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

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
            className="card w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl rounded-b-none sm:rounded-b-2xl max-h-[88vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-cream-100/10">
              <div>
                <p className="h-eyebrow text-gold-400">Help</p>
                <h2 className="font-serif text-xl text-cream-50 mt-0.5">Ask Cruz Golf</h2>
              </div>
              <div className="flex items-center gap-2">
                <a href="/feedback" className="text-xs text-gold-400 underline">
                  Feedback / request a feature
                </a>
                <button onClick={() => setOpen(false)} className="btn-ghost text-sm" aria-label="Close help">
                  ✕
                </button>
              </div>
            </header>

            <div className="px-5 pt-3 pb-2 flex items-center gap-2 text-xs">
              <button
                onClick={() => setMode("ask")}
                className={`pill px-3 py-1.5 ${mode === "ask" ? "bg-gold-500 text-brand-900" : "bg-brand-900/60 border border-cream-100/15 text-cream-100/65"}`}
              >
                Ask
              </button>
              <button
                onClick={() => setMode("browse")}
                className={`pill px-3 py-1.5 ${mode === "browse" ? "bg-gold-500 text-brand-900" : "bg-brand-900/60 border border-cream-100/15 text-cream-100/65"}`}
              >
                Browse FAQ
              </button>
              {hasLlm === false && mode === "ask" && (
                <span className="ml-auto text-[10px] text-cream-100/55">FAQ-only mode</span>
              )}
            </div>

            {mode === "ask" ? (
              <>
                <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-3 space-y-3">
                  {chat.length === 0 && (
                    <div className="text-sm text-cream-100/65 py-6 space-y-2">
                      <p>Ask anything about how Cruz Golf works:</p>
                      <ul className="text-xs text-cream-100/55 space-y-1 list-disc list-inside">
                        <li>How do net skins work?</li>
                        <li>Why did I get a stroke on hole 7?</li>
                        <li>How do I invite another foursome?</li>
                        <li>What does my account owe after this round?</li>
                        <li>How do I change the stroke index?</li>
                      </ul>
                    </div>
                  )}
                  {chat.map((turn, i) => (
                    <div
                      key={i}
                      className={
                        turn.role === "user"
                          ? "ml-6 rounded-2xl bg-brand-900/70 px-3 py-2 text-sm text-cream-50"
                          : "mr-6 rounded-2xl bg-brand-950/60 border border-cream-100/10 px-3 py-2 text-sm text-cream-100/90 whitespace-pre-line"
                      }
                    >
                      {turn.text}
                      {turn.provider && (
                        <div className="mt-1 text-[10px] text-cream-100/35 uppercase tracking-wider">
                          via {turn.provider}
                        </div>
                      )}
                    </div>
                  ))}
                  {busy && (
                    <div className="mr-6 rounded-2xl bg-brand-950/60 border border-cream-100/10 px-3 py-2 text-sm text-cream-100/55">
                      Thinking…
                    </div>
                  )}
                  {err && <p className="text-xs text-red-300">{err}</p>}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask();
                  }}
                  className="px-5 py-3 border-t border-cream-100/10 flex gap-2"
                >
                  <input
                    ref={inputRef}
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a question…"
                    className="input flex-1 text-sm"
                    aria-label="Question"
                    disabled={busy}
                  />
                  <button
                    type="submit"
                    disabled={busy || !question.trim()}
                    className="btn-primary text-sm px-4"
                  >
                    Ask
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="px-5 pt-2 pb-2">
                  <input
                    value={browseQuery}
                    onChange={(e) => {
                      setBrowseQuery(e.target.value);
                      setExpanded(null);
                    }}
                    placeholder="Filter FAQ — e.g. invite, skins, handicap"
                    className="input w-full text-sm"
                    aria-label="Search FAQ"
                  />
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
                  {ranked.length === 0 && (
                    <div className="text-sm text-cream-100/60 py-6 text-center">
                      No matches.
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
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
