import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: Array<{ name: string; value: string; options: Record<string, unknown> }>) {
          try {
            for (const c of toSet) cookieStore.set(c.name, c.value, c.options);
          } catch {
            // server components can't set cookies; ignored.
          }
        }
      }
    }
  );
}
