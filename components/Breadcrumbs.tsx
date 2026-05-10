import Link from "next/link";

export type Crumb = {
  label: string;
  href?: string;
};

/**
 * Lightweight breadcrumb trail. The last item renders without a link.
 * Avoids cluttering pages where the existing "← Back to round" link is
 * enough — use only on deeper / multi-level pages.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-xs text-cream-100/55">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((c, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-2">
              {c.href && !isLast ? (
                <Link
                  href={c.href}
                  className="hover:text-cream-50 hover:underline"
                >
                  {c.label}
                </Link>
              ) : (
                <span className={isLast ? "text-cream-50" : ""}>{c.label}</span>
              )}
              {!isLast && <span className="text-cream-100/30">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
