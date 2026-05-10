import type { RecordRow } from "@/lib/records";

export function RecordCard({
  title,
  rows,
  emptyMessage = "No records yet."
}: {
  title: string;
  rows: RecordRow[];
  emptyMessage?: string;
}) {
  return (
    <div className="card p-4">
      <h2 className="font-serif text-lg text-cream-50 mb-2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-cream-100/55 py-2">{emptyMessage}</p>
      ) : (
        <ol className="divide-y divide-cream-100/8">
          {rows.map((r, i) => (
            <li key={i} className="flex items-center justify-between py-2 gap-3">
              <span className="text-cream-100/45 text-xs tabular-nums w-5">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="text-cream-50 truncate">{r.name}</div>
                {r.meta && (
                  <div className="text-[10px] text-cream-100/45 truncate">{r.meta}</div>
                )}
              </div>
              <span
                className={`tabular-nums font-medium text-sm ${
                  r.tone === "win"
                    ? "text-emerald-300"
                    : r.tone === "loss"
                    ? "text-red-300"
                    : "text-cream-50"
                }`}
              >
                {r.value}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
