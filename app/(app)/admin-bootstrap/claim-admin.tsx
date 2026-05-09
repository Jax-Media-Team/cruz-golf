"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { friendlyAuthError } from "@/lib/auth-errors";

export function ClaimAdmin({ email }: { email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function claim() {
    setBusy(true);
    setErr(null);
    const sb = supabaseBrowser();
    const { error } = await sb.rpc("fn_grant_platform_admin", { p_email: email });
    setBusy(false);
    if (error) {
      setErr(friendlyAuthError(error));
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button onClick={claim} disabled={busy} className="btn-primary w-full">
        {busy ? "Claiming…" : "Promote me to Platform Admin"}
      </button>
      {err && <p className="text-xs text-red-300">{err}</p>}
    </div>
  );
}
