"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * User-management actions for the admin detail page. Each action posts to
 * /api/admin/users/[id]/* and refreshes the page on success.
 */
export function UserActions({
  userId,
  email,
  isAdmin,
  isBanned
}: {
  userId: string;
  email: string;
  isAdmin: boolean;
  isBanned: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function call(action: string, body?: any) {
    setBusy(action);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `${action} failed (${res.status})`);
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2 mt-2">
      <div className="flex flex-wrap gap-2">
        {isAdmin ? (
          <button
            onClick={() => {
              if (!confirm(`Revoke platform admin from ${email}?`)) return;
              call("revoke-admin");
            }}
            disabled={busy != null}
            className="btn-secondary text-xs"
          >
            {busy === "revoke-admin" ? "…" : "Revoke admin"}
          </button>
        ) : (
          <button
            onClick={() => {
              if (!confirm(`Grant platform admin to ${email}? They'll see every group, round, and user on the platform.`)) return;
              call("grant-admin");
            }}
            disabled={busy != null}
            className="btn-secondary text-xs"
          >
            {busy === "grant-admin" ? "…" : "Grant admin"}
          </button>
        )}

        {isBanned ? (
          <button
            onClick={() => call("unban")}
            disabled={busy != null}
            className="btn-secondary text-xs"
          >
            {busy === "unban" ? "…" : "Re-enable account"}
          </button>
        ) : (
          <button
            onClick={() => {
              if (!confirm(`Disable ${email}? They won't be able to sign in until re-enabled.`)) return;
              call("ban");
            }}
            disabled={busy != null}
            className="btn-secondary text-xs"
          >
            {busy === "ban" ? "…" : "Disable account"}
          </button>
        )}

        <button
          onClick={() => {
            if (
              !confirm(
                `Permanently DELETE ${email}? This removes the auth user, profile, group memberships, and all player rows. Existing rounds keep their data but show a deleted-player marker. Cannot be undone.`
              )
            )
              return;
            call("delete");
          }}
          disabled={busy != null}
          className="btn text-xs bg-red-500/15 border border-red-400/40 text-red-200"
        >
          {busy === "delete" ? "…" : "Delete user"}
        </button>
      </div>

      {err && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}
