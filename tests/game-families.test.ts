import { describe, expect, it } from "vitest";
import {
  GAME_FAMILIES,
  GAME_LIBRARY,
  getFamily,
  getPreset
} from "../lib/games/library";

describe("GAME_FAMILIES picker model", () => {
  it("every family has at least one variant", () => {
    for (const f of GAME_FAMILIES) {
      expect(f.variants.length).toBeGreaterThan(0);
    }
  });

  it("every family's defaultVariant exists in its variants", () => {
    for (const f of GAME_FAMILIES) {
      expect(f.variants.find((v) => v.key === f.defaultVariant)).toBeTruthy();
    }
  });

  it("variant.resolve() returns a valid GameType for both modes", () => {
    for (const f of GAME_FAMILIES) {
      for (const v of f.variants) {
        const m1 = v.resolve(f.hasMode ? "gross" : null);
        const m2 = v.resolve(f.hasMode ? "net" : null);
        expect(getPreset(m1)).toBeDefined();
        expect(getPreset(m2)).toBeDefined();
      }
    }
  });

  it("Individual family resolves to gross/net correctly", () => {
    const fam = getFamily("individual")!;
    const v = fam.variants.find((x) => x.key === "standard")!;
    expect(v.resolve("gross")).toBe("individual_gross");
    expect(v.resolve("net")).toBe("individual_net");
  });

  it("Skins family has Standard + Canadian variants", () => {
    const fam = getFamily("skins")!;
    const std = fam.variants.find((x) => x.key === "standard")!;
    const canadian = fam.variants.find((x) => x.key === "canadian")!;
    expect(std.resolve("gross")).toBe("skins_gross");
    expect(std.resolve("net")).toBe("skins_net");
    // Canadian ignores mode (rule, not gross/net)
    expect(canadian.resolve("gross")).toBe("skins_canadian");
    expect(canadian.resolve("net")).toBe("skins_canadian");
  });

  it("Nassau family has Nassau + Match Play variants without mode", () => {
    const fam = getFamily("nassau")!;
    expect(fam.hasMode).toBe(false);
    expect(fam.variants.find((v) => v.key === "standard")?.resolve(null)).toBe("nassau");
    expect(fam.variants.find((v) => v.key === "match_play")?.resolve(null)).toBe("match_play");
  });

  it("Side bets family covers ctp, long_drive, and custom", () => {
    const fam = getFamily("side_bets")!;
    expect(fam.hasMode).toBe(false);
    expect(fam.variants.find((v) => v.key === "ctp")?.resolve(null)).toBe("ctp");
    expect(fam.variants.find((v) => v.key === "long_drive")?.resolve(null)).toBe(
      "long_drive"
    );
    expect(fam.variants.find((v) => v.key === "custom")?.resolve(null)).toBe(
      "custom"
    );
  });

  it("every concrete game_type in GAME_LIBRARY is reachable from some family", () => {
    const reachable = new Set<string>();
    for (const f of GAME_FAMILIES) {
      for (const v of f.variants) {
        reachable.add(v.resolve("gross"));
        reachable.add(v.resolve("net"));
        reachable.add(v.resolve(null));
      }
    }
    for (const p of GAME_LIBRARY) {
      expect(reachable.has(p.game_type)).toBe(true);
    }
  });
});
