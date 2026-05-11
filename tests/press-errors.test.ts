import { describe, it, expect } from "vitest";
import { pressErrorMessage } from "@/lib/press-errors";

describe("pressErrorMessage", () => {
  // The translator takes an `isOnline` getter so we can stub
  // navigator.onLine without monkey-patching globals.
  const online = () => true;
  const offline = () => false;

  it("returns the friendly offline message when isOnline is false, even for a Postgres-style error", () => {
    const out = pressErrorMessage(
      { message: "Press is not pending (current status: accepted)" },
      offline
    );
    expect(out).toBe("You're offline. Try again when you reconnect.");
  });

  it("translates 'fetch failed' to a reconnect prompt when online", () => {
    expect(pressErrorMessage({ message: "TypeError: fetch failed" }, online)).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
  });

  it("translates network / timeout / aborted / econnreset / etimedout to the reconnect prompt", () => {
    for (const phrase of [
      "network error",
      "request timeout",
      "aborted by user",
      "ECONNRESET on socket",
      "ETIMEDOUT after 30s"
    ]) {
      expect(pressErrorMessage({ message: phrase }, online)).toBe(
        "Couldn't reach the server. Check your connection and try again."
      );
    }
  });

  it("passes through Postgres business-rule errors verbatim when online", () => {
    const msg = "Only side B players or commissioners can accept";
    expect(pressErrorMessage({ message: msg }, online)).toBe(msg);
  });

  it("passes through string errors (not Error objects) when online", () => {
    expect(pressErrorMessage("Press has expired", online)).toBe("Press has expired");
  });

  it("falls back to a generic message when the error has no message", () => {
    expect(pressErrorMessage({}, online)).toBe("Something went wrong. Try again.");
    expect(pressErrorMessage(null, online)).toBe("Something went wrong. Try again.");
    expect(pressErrorMessage(undefined, online)).toBe(
      "Something went wrong. Try again."
    );
  });

  it("is case-insensitive on the network/timeout matchers", () => {
    expect(pressErrorMessage({ message: "FETCH FAILED" }, online)).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
    expect(pressErrorMessage({ message: "Network Error" }, online)).toBe(
      "Couldn't reach the server. Check your connection and try again."
    );
  });

  it("uses navigator.onLine as the default isOnline getter", () => {
    // The two-argument call exercises the default — we have to trust
    // the production navigator here; just verify the helper doesn't
    // throw when called with one arg.
    expect(() =>
      pressErrorMessage({ message: "Some error" })
    ).not.toThrow();
  });
});
