/**
 * OCR pipeline contract tests.
 *
 * We don't hit the OpenAI API from vitest — these tests cover:
 *   - the no-op shape returned when OPENAI_API_KEY is unset
 *   - the new diagnostic fields (data_url_bytes, model, called_at,
 *     no_player_hint) are always present so the upload UI's
 *     diagnostics panel never trips on missing properties
 *   - the `players` parameter is now OPTIONAL (caller can omit it,
 *     and the pipeline doesn't send it to the model regardless)
 *
 * The real-world OCR quality is exercised via Patrick uploading
 * actual scorecards — this suite just guards the contract.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { ocr } from "@/lib/ocr";

const FAKE_DATA_URL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/2wBDAA==";

describe("OCR pipeline contract", () => {
  beforeEach(() => {
    // Force the no-op branch — these tests must not depend on the
    // CI environment's secrets.
    delete process.env.OPENAI_API_KEY;
  });

  it("no-op (no API key): returns empty players + debug envelope", async () => {
    const out = await ocr.parse({
      dataUrl: FAKE_DATA_URL,
      players: ["Patrick", "Mitch"],
      holes: 18
    });
    expect(out.players).toEqual([]);
    expect(out._debug).toBeDefined();
    expect(out._debug?.raw_text).toContain("OPENAI_API_KEY");
    expect(out._debug?.model).toBe("gpt-4o");
    expect(out._debug?.no_player_hint).toBe(true);
    expect(typeof out._debug?.data_url_bytes).toBe("number");
    expect(out._debug?.data_url_bytes).toBeGreaterThan(0);
    expect(out._debug?.called_at).toMatch(/T.*Z/);
    // No-op path makes ZERO API calls — attempts=0 distinguishes it
    // from a real call that happens to fail.
    expect(out._debug?.attempts).toBe(0);
    expect(out._debug?.first_attempt_raw).toBeUndefined();
  });

  it("no-op with no player list still works (players is optional)", async () => {
    const out = await ocr.parse({
      dataUrl: FAKE_DATA_URL,
      players: [],
      holes: 18
    });
    expect(out.players).toEqual([]);
    expect(out._debug?.no_player_hint).toBe(true);
  });

  it("9-hole input is supported in the contract", async () => {
    const out = await ocr.parse({
      dataUrl: FAKE_DATA_URL,
      players: ["A"],
      holes: 9
    });
    expect(out.players).toEqual([]);
    expect(out._debug).toBeDefined();
  });

  it("custom model override is echoed in debug", async () => {
    const out = await ocr.parse({
      dataUrl: FAKE_DATA_URL,
      players: [],
      holes: 18,
      model: "gpt-4o-mini"
    });
    expect(out._debug?.model).toBe("gpt-4o-mini");
  });

  it("data_url_bytes reflects the input size — useful for verifying the image actually reached the pipeline", async () => {
    const big = "data:image/jpeg;base64," + "A".repeat(10_000);
    const out = await ocr.parse({
      dataUrl: big,
      players: [],
      holes: 18
    });
    expect(out._debug?.data_url_bytes).toBe(big.length);
  });
});
