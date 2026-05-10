import Link from "next/link";

export type RecordScopeKey = "group" | "me" | "course";

export function RecordsScopeNav({
  active,
  myPlayerId,
  courseId,
  courseName
}: {
  active: RecordScopeKey;
  myPlayerId: string | null;
  courseId?: string;
  courseName?: string | null;
}) {
  const tabs: Array<{ key: RecordScopeKey; label: string; href: string; show: boolean }> = [
    { key: "group", label: "Group", href: "/records", show: true },
    {
      key: "me",
      label: "Personal",
      href: "/records/me",
      show: !!myPlayerId
    },
    {
      key: "course",
      label: courseId ? `Course · ${courseName ?? ""}`.trim() : "By course",
      href: courseId ? `/records/course/${courseId}` : "/records",
      show: !!courseId
    }
  ];
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {tabs
        .filter((t) => t.show)
        .map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              className={`pill text-xs px-3 py-1.5 whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-gold-500 text-brand-900"
                  : "bg-brand-900/60 border border-cream-100/15 text-cream-100/85 hover:bg-brand-900"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
    </nav>
  );
}
