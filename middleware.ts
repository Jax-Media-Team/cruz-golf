import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Inject the requested pathname (and query) as a header so server components
 * can preserve `?next=` when redirecting unauthenticated users to /login.
 *
 * This is the only thing this middleware does — it's a no-op for the actual
 * response. Auth gating still happens in the layout/page.
 */
export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const fullPath = `${url.pathname}${url.search ?? ""}`;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", fullPath);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Skip Next internals + static files. Run on every other route.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/version|.*\\.).*)"]
};
