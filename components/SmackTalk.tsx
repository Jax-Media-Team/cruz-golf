import type { Moment } from "@/lib/recap";

export function SmackTalk({ moments, title = "Clubhouse recap" }: { moments: Moment[]; title?: string }) {
  if (moments.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="h-eyebrow text-gold-400">{title}</p>
      <ul className="space-y-2">
        {moments.map((m, i) => (
          <li
            key={i}
            className="card p-4 flex items-start gap-3 border-l-4 border-gold-500"
          >
            <span className="text-2xl shrink-0 leading-none mt-0.5" aria-hidden>{m.emoji}</span>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-400">{m.title}</div>
              <p className="text-sm text-cream-50 mt-0.5 leading-relaxed">{m.caption}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
