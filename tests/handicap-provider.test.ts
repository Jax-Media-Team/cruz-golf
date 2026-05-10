import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  resolveEffectiveHandicap,
  trustLabel,
  wrapManualIndex,
  type HandicapValue
} from "@/lib/handicap-provider";

describe("wrapManualIndex", () => {
  it("wraps a bare index with manual-provider provenance", () => {
    const v = wrapManualIndex(7.9);
    expect(v.index).toBe(7.9);
    expect(v.provider).toBe("manual");
    expect(v.trust).toBe("community");
    expect(v.external_id).toBeNull();
    // fetched_at should be a valid ISO timestamp.
    expect(() => new Date(v.fetched_at).toISOString()).not.toThrow();
  });

  it("upgrades trust to 'self' when a GHIN number is on file", () => {
    const v = wrapManualIndex(12.4, "1234567");
    expect(v.trust).toBe("self");
    expect(v.external_id).toBe("1234567");
  });

  it("preserves null index for unknown handicaps", () => {
    const v = wrapManualIndex(null);
    expect(v.index).toBeNull();
  });
});

describe("resolveEffectiveHandicap", () => {
  const local: HandicapValue = {
    index: 8.4,
    provider: "manual",
    trust: "community",
    fetched_at: "2026-05-10T12:00:00Z"
  };
  const officialFresher: HandicapValue = {
    index: 7.9,
    provider: "ghin",
    trust: "official",
    fetched_at: "2026-05-11T08:00:00Z"
  };
  const officialStale: HandicapValue = {
    index: 7.9,
    provider: "ghin",
    trust: "official",
    fetched_at: "2026-05-09T08:00:00Z"
  };

  it("returns the local value when no official snapshot exists", () => {
    expect(resolveEffectiveHandicap({ local })).toBe(local);
    expect(resolveEffectiveHandicap({ local, official: null })).toBe(local);
  });

  it("returns the OFFICIAL value when it's fresher and there's no override", () => {
    expect(resolveEffectiveHandicap({ local, official: officialFresher })).toBe(
      officialFresher
    );
  });

  it("keeps the LOCAL value when the official snapshot is older", () => {
    expect(resolveEffectiveHandicap({ local, official: officialStale })).toBe(
      local
    );
  });

  it("ALWAYS returns the local value when override is set, even with fresher official data", () => {
    // This is the safety rule — a commissioner's negotiated handicap
    // is never silently overwritten by an official refresh.
    expect(
      resolveEffectiveHandicap({ local, official: officialFresher, override: true })
    ).toBe(local);
  });

  it("falls back to local when official has no index", () => {
    const officialNullIndex: HandicapValue = {
      ...officialFresher,
      index: null
    };
    expect(
      resolveEffectiveHandicap({ local, official: officialNullIndex })
    ).toBe(local);
  });
});

describe("PROVIDERS registry", () => {
  it("exposes manual + ghin + ushandicap + arccos", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([
      "arccos",
      "ghin",
      "manual",
      "ushandicap"
    ]);
  });

  it("ghin provider returns null until real integration ships", async () => {
    const v = await PROVIDERS.ghin.lookup({ externalId: "1234567" });
    expect(v).toBeNull();
  });

  it("ghin provider carries 'official' trust label so UI can pre-render", () => {
    expect(PROVIDERS.ghin.trust).toBe("official");
    expect(PROVIDERS.ghin.label).toBe("Official GHIN");
  });
});

describe("trustLabel", () => {
  it("returns understated tone-disciplined labels", () => {
    expect(trustLabel("official")).toBe("Official");
    expect(trustLabel("community")).toBe("Hand-entered");
    expect(trustLabel("self")).toBe("Self-reported");
    expect(trustLabel("unverified")).toBe("Unverified");
  });
});
