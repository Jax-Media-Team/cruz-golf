"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Search box for the course-library moderation page. Pushes the query
 * into the `?q=` search param so the server-side filter on the parent
 * page can do the actual filtering. Debounced so typing doesn't fire
 * a refresh on every keystroke.
 */
export function LibrarySearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      const qs = params.toString();
      router.replace(`/admin/course-library${qs ? `?${qs}` : ""}`);
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="card p-3 flex items-center gap-3">
      <span className="text-sm text-cream-100/55 shrink-0">Search</span>
      <input
        className="input text-sm flex-1"
        type="search"
        placeholder="Course name, city, state…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          className="btn-ghost text-xs"
        >
          Clear
        </button>
      )}
    </div>
  );
}
