import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Platform diagnostics dashboard. Surfaces the "is this deployment
 * actually configured?" question at a glance so a silent
 * mis-configuration like "OPENAI_API_KEY missing in Vercel" can be
 * caught in seconds instead of by a user uploading a scorecard.
 *
 * Patrick caught the original OCR P0 (env var missing in Vercel
 * production) via the per-upload diagnostics panel. This page is the
 * always-on equivalent — admins land here, scan the checklist,
 * spot any red.
 *
 * Server Component: reads `process.env.*` directly. The page runs on
 * the same Node runtime as the API routes, so env-var presence here
 * matches what the OCR endpoint actually sees. No values are ever
 * sent to the client — only presence + a sanity-check hash suffix.
 *
 * Admin-gated by `app/admin/layout.tsx`.
 */

type EnvCheck = {
  name: string;
  present: boolean;
  /** Last 4 chars of the value as a sanity check that the right value
   *  is set (not a typo-ed placeholder). Never the full value. */
  tail4?: string;
  required: boolean;
  description: string;
  /** Plain-language help shown when this check fails. */
  fix_hint?: string;
};

function check(
  name: string,
  required: boolean,
  description: string,
  fix_hint?: string
): EnvCheck {
  const v = process.env[name];
  const present = typeof v === "string" && v.length > 0;
  return {
    name,
    present,
    tail4: present ? v!.slice(-4) : undefined,
    required,
    description,
    fix_hint
  };
}

export default async function DiagnosticsPage() {
  // Run all env checks. Values stay server-side; we only return
  // presence + tail4 to the rendered HTML.
  const envChecks: EnvCheck[] = [
    check(
      "NEXT_PUBLIC_SUPABASE_URL",
      true,
      "Supabase project URL — read by both client and server.",
      "Add via Vercel → Settings → Environment Variables. Should look like https://<project>.supabase.co."
    ),
    check(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      true,
      "Supabase anon (publishable) key — read by the browser.",
      "Add via Vercel. Copy from Supabase → Project Settings → API → anon public."
    ),
    check(
      "SUPABASE_SERVICE_ROLE_KEY",
      true,
      "Supabase service-role key — server-only, used for admin / cross-RLS operations.",
      "Add via Vercel. SUPABASE → Project Settings → API → service_role. NEVER expose to the browser."
    ),
    check(
      "OPENAI_API_KEY",
      false,
      "Scorecard OCR via gpt-4o vision. Without this, OCR silently no-ops and uploads return empty score arrays.",
      "Add via Vercel → Settings → Environment Variables → New. Scope: Production AND Preview. Then redeploy (env vars only apply to NEW builds)."
    ),
    check(
      "APP_URL",
      false,
      "Canonical public URL used by absolute-URL paths (spectator links, email-style copy).",
      "Add via Vercel. Should match the production domain, e.g. https://cruz-golf.vercel.app."
    ),
    check(
      "NEXT_PUBLIC_GA_ID",
      false,
      "Google Analytics measurement ID. Optional — there's a hardcoded fallback for production.",
      "Add via Vercel only if you want to override the default GA stream."
    )
  ];

  // Supabase connectivity probe — actually run a query that requires
  // both URL + anon key. Distinguishes "URL/key set" from "URL/key
  // wrong" or "Supabase project down".
  const sb = await supabaseServer();
  let supabaseProbe: { ok: boolean; ms: number; error: string | null } = {
    ok: false,
    ms: 0,
    error: null
  };
  try {
    const t0 = Date.now();
    const { error } = await sb.from("groups").select("id").limit(1);
    supabaseProbe = {
      ok: !error,
      ms: Date.now() - t0,
      error: error?.message ?? null
    };
  } catch (e: any) {
    supabaseProbe = { ok: false, ms: 0, error: e?.message ?? "unknown" };
  }

  // Service-role probe — checks the key actually works against the API.
  // Imports inline so the page still renders if the key isn't present.
  let serviceRoleProbe: { ok: boolean; error: string | null } | null = null;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { supabaseAdmin } = await import("@/lib/supabase/admin");
      const sr = supabaseAdmin();
      const { error } = await sr.from("groups").select("id").limit(1);
      serviceRoleProbe = { ok: !error, error: error?.message ?? null };
    } catch (e: any) {
      serviceRoleProbe = { ok: false, error: e?.message ?? "unknown" };
    }
  }

  // Build metadata — useful when verifying "did my new env var take
  // effect on a redeploy?".
  const buildMeta = {
    node_env: process.env.NODE_ENV ?? "unknown",
    vercel_env: process.env.VERCEL_ENV ?? "—",
    vercel_url: process.env.VERCEL_URL ?? "—",
    git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "—",
    git_commit_message:
      process.env.VERCEL_GIT_COMMIT_MESSAGE?.slice(0, 80) ?? "—",
    deployment_id: process.env.VERCEL_DEPLOYMENT_ID ?? "—",
    region: process.env.VERCEL_REGION ?? "—"
  };

  // Aggregate "is this deployment broken?" verdict for the header.
  const requiredMissing = envChecks.filter((c) => c.required && !c.present);
  const optionalMissing = envChecks.filter((c) => !c.required && !c.present);
  const broken = requiredMissing.length > 0 || !supabaseProbe.ok;

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="h-eyebrow text-gold-400">Platform</p>
          <h1 className="h-display text-3xl text-cream-50 mt-1">Diagnostics</h1>
          <p className="text-sm text-cream-100/65 mt-1">
            Environment + connectivity checks for this deployment. If
            something here is red, the live app is broken in a way
            users will only see when they try to use the feature.
          </p>
        </div>
        <Link href="/admin" className="btn-ghost text-sm">
          ← Admin
        </Link>
      </header>

      {/* Verdict banner */}
      <div
        className={`card p-4 border ${
          broken
            ? "border-red-400/40 bg-red-500/10"
            : optionalMissing.length > 0
            ? "border-amber-400/40 bg-amber-500/10"
            : "border-emerald-400/40 bg-emerald-500/10"
        }`}
      >
        <p
          className={`font-serif text-lg ${
            broken
              ? "text-red-200"
              : optionalMissing.length > 0
              ? "text-amber-200"
              : "text-emerald-200"
          }`}
        >
          {broken
            ? "Deployment is missing required config"
            : optionalMissing.length > 0
            ? "Deployment is healthy with optional features disabled"
            : "Deployment is fully configured"}
        </p>
        {broken && (
          <p className="text-xs text-red-100/80 mt-1">
            {requiredMissing.length} required env var
            {requiredMissing.length === 1 ? "" : "s"} missing
            {!supabaseProbe.ok && " · Supabase probe failed"}
          </p>
        )}
        {!broken && optionalMissing.length > 0 && (
          <p className="text-xs text-amber-100/80 mt-1">
            {optionalMissing.length} optional feature
            {optionalMissing.length === 1 ? "" : "s"} not configured —
            those surfaces will silently degrade.
          </p>
        )}
      </div>

      {/* Environment variables */}
      <section className="card p-4 space-y-3">
        <h2 className="font-serif text-lg text-cream-50">
          Environment variables
        </h2>
        <ul className="space-y-2">
          {envChecks.map((c) => (
            <li
              key={c.name}
              className="rounded-lg border border-cream-100/10 bg-brand-900/30 p-3 space-y-1"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-sm text-cream-50 break-all">
                  {c.name}
                </span>
                <span
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    c.present
                      ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30"
                      : c.required
                      ? "bg-red-500/15 text-red-200 ring-1 ring-red-400/30"
                      : "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30"
                  }`}
                >
                  {c.present
                    ? "set"
                    : c.required
                    ? "missing — required"
                    : "missing — optional"}
                </span>
              </div>
              <p className="text-[11px] text-cream-100/65">{c.description}</p>
              {c.present && c.tail4 && (
                <p className="text-[10px] text-cream-100/45 font-mono">
                  ends with …{c.tail4}
                </p>
              )}
              {!c.present && c.fix_hint && (
                <p className="text-[11px] text-cream-100/55 leading-snug">
                  <span className="text-cream-100/85">Fix:</span> {c.fix_hint}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Connectivity probes */}
      <section className="card p-4 space-y-3">
        <h2 className="font-serif text-lg text-cream-50">
          Connectivity probes
        </h2>
        <p className="text-xs text-cream-100/55">
          Live tests that verify the configured services actually respond.
          Run on every page load.
        </p>
        <ul className="space-y-2">
          <li className="rounded-lg border border-cream-100/10 bg-brand-900/30 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-cream-50">Supabase (anon)</span>
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  supabaseProbe.ok
                    ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30"
                    : "bg-red-500/15 text-red-200 ring-1 ring-red-400/30"
                }`}
              >
                {supabaseProbe.ok ? `ok · ${supabaseProbe.ms}ms` : "failed"}
              </span>
            </div>
            <p className="text-[11px] text-cream-100/65 mt-1">
              SELECT id FROM groups LIMIT 1 — tests URL + anon key + RLS read
              path.
            </p>
            {supabaseProbe.error && (
              <p className="text-[11px] text-red-200 mt-1 font-mono break-all">
                {supabaseProbe.error}
              </p>
            )}
          </li>

          <li className="rounded-lg border border-cream-100/10 bg-brand-900/30 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-cream-50">
                Supabase (service role)
              </span>
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  serviceRoleProbe == null
                    ? "bg-cream-500/15 text-cream-200 ring-1 ring-cream-400/30"
                    : serviceRoleProbe.ok
                    ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30"
                    : "bg-red-500/15 text-red-200 ring-1 ring-red-400/30"
                }`}
              >
                {serviceRoleProbe == null
                  ? "skipped (key missing)"
                  : serviceRoleProbe.ok
                  ? "ok"
                  : "failed"}
              </span>
            </div>
            <p className="text-[11px] text-cream-100/65 mt-1">
              Tests that SUPABASE_SERVICE_ROLE_KEY is the right key for this
              project (mismatched keys are a common silent failure).
            </p>
            {serviceRoleProbe?.error && (
              <p className="text-[11px] text-red-200 mt-1 font-mono break-all">
                {serviceRoleProbe.error}
              </p>
            )}
          </li>

          <li className="rounded-lg border border-cream-100/10 bg-brand-900/30 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-cream-50">OCR (OpenAI)</span>
              <span
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  process.env.OPENAI_API_KEY
                    ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/30"
                    : "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30"
                }`}
              >
                {process.env.OPENAI_API_KEY
                  ? "key present (live calls not tested)"
                  : "disabled — no-op mode"}
              </span>
            </div>
            <p className="text-[11px] text-cream-100/65 mt-1">
              We don&apos;t spend a real call here. Upload a card from{" "}
              <code className="font-mono text-cream-100/85">
                /rounds/[id]/upload
              </code>{" "}
              and inspect the diagnostics panel on the card to verify
              end-to-end.
            </p>
            {!process.env.OPENAI_API_KEY && (
              <p className="text-[11px] text-amber-200 mt-1 leading-snug">
                Without this key, every upload silently returns empty score
                arrays. The per-card diagnostics panel will show
                <code className="font-mono text-amber-100/85 mx-1">
                  &quot;OPENAI_API_KEY is not set — OCR is a no-op&quot;
                </code>
                in the raw model output.
              </p>
            )}
          </li>
        </ul>
      </section>

      {/* Feature flags — pure config-derived, no env */}
      <section className="card p-4 space-y-3">
        <h2 className="font-serif text-lg text-cream-50">Feature status</h2>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between gap-2">
            <span className="text-cream-50">Scorecard OCR</span>
            <span className="text-[11px] text-cream-100/65">
              {process.env.OPENAI_API_KEY ? "enabled" : "no-op mode"}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="text-cream-50">Realtime (Supabase channels)</span>
            <span className="text-[11px] text-cream-100/65">
              enabled (transport managed by Supabase)
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="text-cream-50">Service-role admin ops</span>
            <span className="text-[11px] text-cream-100/65">
              {process.env.SUPABASE_SERVICE_ROLE_KEY ? "enabled" : "disabled"}
            </span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="text-cream-50">Push notifications</span>
            <span className="text-[11px] text-cream-100/65">not implemented</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span className="text-cream-50">GHIN integration</span>
            <span className="text-[11px] text-cream-100/65">
              manual handicaps only (per design)
            </span>
          </li>
        </ul>
      </section>

      {/* Build metadata */}
      <section className="card p-4 space-y-3">
        <h2 className="font-serif text-lg text-cream-50">Build / runtime</h2>
        <p className="text-xs text-cream-100/55">
          Verify env-var changes took effect by checking the commit SHA changed.
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {Object.entries(buildMeta).map(([k, v]) => (
            <div
              key={k}
              className="flex items-baseline justify-between gap-2 border-b border-cream-100/8 pb-1.5"
            >
              <dt className="font-mono text-cream-100/55">{k}</dt>
              <dd className="font-mono text-cream-100/85 truncate text-right">
                {v || "—"}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Runbook */}
      <section className="card p-4 space-y-2">
        <h2 className="font-serif text-lg text-cream-50">Fixing a red row</h2>
        <ol className="text-xs text-cream-100/75 list-decimal pl-5 space-y-1.5 leading-snug">
          <li>
            Go to{" "}
            <a
              href="https://vercel.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Vercel → your project → Settings → Environment Variables
            </a>
            .
          </li>
          <li>
            Add the missing variable. Scope it to{" "}
            <span className="font-medium">Production</span> AND{" "}
            <span className="font-medium">Preview</span> (and Development if you
            want the var available to <code className="font-mono">vercel dev</code>
            ).
          </li>
          <li>
            Trigger a redeploy. Vercel does NOT apply env-var changes to existing
            builds — you need a fresh deployment. Easiest:{" "}
            <code className="font-mono">git commit --allow-empty -m &quot;chore: redeploy&quot;</code>{" "}
            and push.
          </li>
          <li>Reload this page. The red row should go green.</li>
        </ol>
        <p className="text-[11px] text-cream-100/45 leading-snug">
          More detail in{" "}
          <code className="font-mono text-cream-100/65">
            docs/OCR_ENV_RUNBOOK.md
          </code>
          .
        </p>
      </section>
    </div>
  );
}
