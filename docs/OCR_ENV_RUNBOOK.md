# Runbook — fixing OCR when uploads return "no scores read"

**Symptom.** A scorecard upload returns `Parsed N players · no scores
read — see diagnostics`. The per-card diagnostics panel shows the raw
model output starts with:

```
OPENAI_API_KEY is not set — OCR is a no-op.
```

**Cause.** The OCR pipeline (`lib/ocr/index.ts`) checks
`process.env.OPENAI_API_KEY` at request time. If absent, it returns a
no-op shape with empty score arrays so the upload still completes
gracefully and the user can hand-type. In production this is almost
always one of:

1. The env var was never added to the Vercel project.
2. It was added to the **wrong scope** (e.g. Development only — not
   Production / Preview).
3. It was added recently but no redeploy has happened since (Vercel
   applies env-var changes to NEW builds only).
4. It's named wrong (e.g. `OPENAI_KEY` or `OPEN_AI_API_KEY` — the
   pipeline reads exactly `OPENAI_API_KEY`).
5. It's set in a different Vercel project that the wrong deployment
   was promoted from.

---

## Fix in 4 steps

1. **Verify what's missing.** Hit `/admin/diagnostics` on the
   broken deployment. The page reads `process.env.*` from the same
   Node runtime the OCR endpoint uses, so what you see is exactly
   what OCR sees. If `OPENAI_API_KEY` is `missing — optional`, you've
   confirmed the diagnosis.

2. **Add the env var in Vercel.**
   - Go to Vercel → your project → Settings → Environment Variables.
   - **Name:** `OPENAI_API_KEY` (exact match — case-sensitive).
   - **Value:** the API key from
     [platform.openai.com](https://platform.openai.com/api-keys)
     (starts with `sk-`).
   - **Environments:** check **Production** AND **Preview** (and
     **Development** if you want `vercel dev` to pick it up).
   - Save.

3. **Trigger a redeploy.** Env-var changes do NOT apply to existing
   builds. Easiest path:
   ```bash
   git commit --allow-empty -m "chore: redeploy to pick up OPENAI_API_KEY"
   git push origin main
   ```
   Or click "Redeploy" on the Vercel deployment row (uncheck "use
   existing build cache").

4. **Verify.** Reload `/admin/diagnostics` — the row should go green.
   Upload a scorecard from `/rounds/[id]/upload`. The per-card
   diagnostics panel should show:
   - `Model: gpt-4o` (not the no-op sentinel)
   - `Image payload: N KB` (the preprocessed JPEG)
   - `Preprocess: 4032×3024 → 2400×1800 · EXIF-rotated` (or similar)
   - A non-empty `Raw model output` containing actual JSON players +
     scores.

---

## Why this happened on 2026-05-11

The first production deploy of the OCR feature shipped without the
env var being set on Vercel. The pipeline's no-op fallback returned
structurally valid responses (empty score arrays) which got rendered
as `Parsed 4 players · no scores read`. The cause was invisible until
the per-card diagnostics panel was added and exposed the sentinel
string in `_debug.raw_text`.

Permanent safeguards added in the same commit:

- **Server-side warning log.** When OCR runs without the key, the
  Function logs a clear `[ocr] OPENAI_API_KEY is not set` warning.
  Search Vercel logs for `[ocr]` to catch this in monitoring.
- **Upload-page banner.** The upload UI detects the sentinel string
  in any card's raw output and bumps a red banner to the top
  ("Scorecard OCR is disabled on this deployment").
- **`/admin/diagnostics`.** Always-on env-var + connectivity
  dashboard. Every admin should check it after a deploy that touched
  Vercel settings.

---

## Other env vars worth verifying via diagnostics

| Variable | Required? | Symptom if missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | App can't reach the DB at all |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Client queries fail |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Admin RPCs fail; spectator routes fall back to anon |
| `OPENAI_API_KEY` | optional | OCR returns no-op (this runbook) |
| `APP_URL` | optional | Some absolute-URL paths point to localhost |
| `NEXT_PUBLIC_GA_ID` | optional | Analytics stream may be wrong (there's a prod-default fallback) |
