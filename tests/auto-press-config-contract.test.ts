/**
 * Contract test: every place that produces a Nassau / 6-6-6 / team_match
 * config object must produce a shape that the settlement engine + live-
 * state engine actually act on.
 *
 * Patrick 2026-05-13: 2-down auto-presses silently did nothing because
 * the Suggested-Nassau preset + library default + games-editor checkbox
 * all wrote `presses_enabled: true` (boolean), while the engines read
 * `cfg.presses === "auto_2_down"` (string enum). Every engine-level
 * test passed because they constructed configs directly, bypassing the
 * UI. This test closes that gap: it walks the actual config-producers
 * and asserts they yield an enum value the engine understands.
 *
 * If a future change accidentally re-introduces a `presses_enabled`
 * boolean OR removes the legacy-coercion fallback, this test fails
 * immediately.
 */

import { describe, expect, it } from "vitest";
import { GAME_PACKAGES } from "../lib/presets/game-packages";
import { GAME_LIBRARY, getPreset } from "../lib/games/library";
import { isAutoPress2Down } from "../lib/games/config-normalize";

describe("auto-press config contract", () => {
  it("Suggested Nassau package writes presses='auto_2_down'", () => {
    const nassau = GAME_PACKAGES.find((p) => p.id === "nassau");
    expect(nassau, "Nassau package must exist").toBeDefined();
    const nassauGame = nassau!.games[0];
    expect(
      isAutoPress2Down(nassauGame.config as any),
      "Suggested Nassau must enable auto-press at 2-down"
    ).toBe(true);
    expect((nassauGame.config as any).presses).toBe("auto_2_down");
  });

  it("Nassau library preset (game_type='nassau') default writes presses='auto_2_down'", () => {
    const nassau = getPreset("nassau" as any);
    expect(nassau, "Nassau preset must exist in GAME_LIBRARY").toBeDefined();
    expect(
      isAutoPress2Down(nassau!.defaults.config as any),
      "Nassau library default must enable auto-press at 2-down"
    ).toBe(true);
    expect((nassau!.defaults.config as any).presses).toBe("auto_2_down");
  });

  it("no preset in GAME_LIBRARY writes the legacy `presses_enabled` field", () => {
    // Static lint: catches the exact regression Patrick hit. If a
    // future PR adds `presses_enabled` back to any preset, this fails.
    for (const p of GAME_LIBRARY) {
      const cfg = p.defaults.config as any;
      expect(
        "presses_enabled" in cfg,
        `${p.game_type} preset must not write legacy presses_enabled — use presses="auto_2_down"|"manual"|"none"`
      ).toBe(false);
    }
  });

  it("legacy presses_enabled=true is coerced to enabled by isAutoPress2Down", () => {
    // In-flight rounds saved before 0047 still carry the legacy boolean.
    // The coercion rescues them without a re-save.
    expect(isAutoPress2Down({ presses_enabled: true } as any)).toBe(true);
  });

  it("legacy presses_enabled=false coerces to disabled", () => {
    expect(isAutoPress2Down({ presses_enabled: false } as any)).toBe(false);
  });

  it("undefined / null / empty config returns false (safe default)", () => {
    expect(isAutoPress2Down(null)).toBe(false);
    expect(isAutoPress2Down(undefined)).toBe(false);
    expect(isAutoPress2Down({})).toBe(false);
  });

  it("explicit presses='none' returns false", () => {
    expect(isAutoPress2Down({ presses: "none" } as any)).toBe(false);
  });

  it("explicit presses='manual' returns false (manual is NOT auto)", () => {
    expect(isAutoPress2Down({ presses: "manual" } as any)).toBe(false);
  });

  it("explicit presses='auto_2_down' returns true", () => {
    expect(isAutoPress2Down({ presses: "auto_2_down" } as any)).toBe(true);
  });

  it("new shape WINS over legacy boolean when both are present", () => {
    // If a config has both `presses: "none"` AND `presses_enabled: true`,
    // the new enum takes precedence — otherwise migrating a round by
    // explicitly turning presses OFF wouldn't stick.
    expect(
      isAutoPress2Down({ presses: "none", presses_enabled: true } as any)
    ).toBe(false);
    expect(
      isAutoPress2Down({ presses: "auto_2_down", presses_enabled: false } as any)
    ).toBe(true);
  });
});
