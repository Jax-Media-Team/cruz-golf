"use client";
/**
 * Client-side image transforms used by the upload review UI.
 *
 * Patrick's real-world test card came back with templated / wrong
 * scores. One likely cause: the photo is rotated such that the
 * model is reading rows top-to-bottom instead of left-to-right (or
 * the card surface fills only a small portion of the frame). The
 * transforms here are the user's escape hatch:
 *
 *   - rotateImage90  — rotate a data URL by N×90°.
 *   - cropImage      — crop a data URL to a normalized [0..1]
 *                      rectangle.
 *
 * Both run on the browser via canvas. They preserve the image's
 * mime type (jpeg in / jpeg out at q=0.92, matching the
 * preprocess.ts pipeline).
 *
 * Pure-ish: each helper takes a data URL + parameters and resolves
 * to a new data URL. Tested in isolation via the dimension-math
 * counterparts in `ocr-preprocess.test.ts`. Browser-API parts
 * (drawImage, toDataURL) are not unit-testable from vitest, but the
 * coordinate math is.
 */

/**
 * Compute output canvas dimensions after a 90°-multiple rotation.
 * Pure function so we can test the math without canvas.
 *
 *   turns =  0 → same
 *   turns =  1 (90° CW) → swap w/h
 *   turns =  2 (180°)   → same
 *   turns =  3 (270° CW = 90° CCW) → swap w/h
 *
 * Negative or >3 wrap around modulo 4.
 */
export function rotatedDimensions(
  w: number,
  h: number,
  turns: number
): { w: number; h: number } {
  const t = ((turns % 4) + 4) % 4;
  if (t === 1 || t === 3) return { w: h, h: w };
  return { w, h };
}

/**
 * Compute output canvas dimensions + source crop rectangle for a
 * normalized crop. Pure helper for testing.
 *
 *   crop = { x, y, w, h } each in [0, 1] (fractions of the source)
 *   source = { w, h } in pixels
 *
 * Clamps to source bounds. If the crop is degenerate (0 area), the
 * helper returns the whole source.
 */
export function cropPixelBounds(
  source: { w: number; h: number },
  crop: { x: number; y: number; w: number; h: number }
): { sx: number; sy: number; sw: number; sh: number } {
  const cx = Math.max(0, Math.min(1, crop.x));
  const cy = Math.max(0, Math.min(1, crop.y));
  const cw = Math.max(0, Math.min(1 - cx, crop.w));
  const ch = Math.max(0, Math.min(1 - cy, crop.h));
  if (cw <= 0 || ch <= 0) {
    return { sx: 0, sy: 0, sw: source.w, sh: source.h };
  }
  return {
    sx: Math.round(source.w * cx),
    sy: Math.round(source.h * cy),
    sw: Math.round(source.w * cw),
    sh: Math.round(source.h * ch)
  };
}

async function loadBitmap(dataUrl: string): Promise<{
  bitmap: ImageBitmap | null;
  fallback: HTMLImageElement | null;
}> {
  // Try createImageBitmap first (faster, no DOM dependency). Fall
  // back to an Image element when unsupported.
  if (typeof createImageBitmap === "function") {
    try {
      const r = await fetch(dataUrl);
      const blob = await r.blob();
      const bm = await createImageBitmap(blob);
      return { bitmap: bm, fallback: null };
    } catch {
      /* fall through */
    }
  }
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ bitmap: null, fallback: img });
    img.onerror = () => rej(new Error("Failed to decode image for transform"));
    img.src = dataUrl;
  });
}

/**
 * Rotate a data URL by N × 90° (clockwise). Negative wraps. The
 * result is a JPEG q=0.92 data URL with rotated content. No EXIF
 * (EXIF is irrelevant for a canvas re-encode — the pixels are
 * physically rotated).
 */
export async function rotateImage90(
  dataUrl: string,
  turns: number = 1
): Promise<string> {
  const { bitmap, fallback } = await loadBitmap(dataUrl);
  const sourceW = bitmap?.width ?? fallback!.naturalWidth;
  const sourceH = bitmap?.height ?? fallback!.naturalHeight;
  const out = rotatedDimensions(sourceW, sourceH, turns);
  const canvas = document.createElement("canvas");
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap?.close();
    throw new Error("Canvas 2D context unavailable");
  }
  const t = ((turns % 4) + 4) % 4;
  ctx.save();
  // Translate + rotate so the source draws into the rotated canvas.
  if (t === 1) {
    ctx.translate(out.w, 0);
    ctx.rotate(Math.PI / 2);
  } else if (t === 2) {
    ctx.translate(out.w, out.h);
    ctx.rotate(Math.PI);
  } else if (t === 3) {
    ctx.translate(0, out.h);
    ctx.rotate(-Math.PI / 2);
  }
  if (bitmap) {
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    ctx.drawImage(fallback!, 0, 0);
  }
  ctx.restore();
  return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * Crop a data URL to a normalized rectangle. All four params are
 * fractions in [0, 1]. The output preserves source resolution
 * (i.e. no downscaling — the cropped pixels are returned at their
 * native size, which is what we want for OCR).
 */
export async function cropImage(
  dataUrl: string,
  crop: { x: number; y: number; w: number; h: number }
): Promise<string> {
  const { bitmap, fallback } = await loadBitmap(dataUrl);
  const sourceW = bitmap?.width ?? fallback!.naturalWidth;
  const sourceH = bitmap?.height ?? fallback!.naturalHeight;
  const { sx, sy, sw, sh } = cropPixelBounds({ w: sourceW, h: sourceH }, crop);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap?.close();
    throw new Error("Canvas 2D context unavailable");
  }
  if (bitmap) {
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    bitmap.close();
  } else {
    ctx.drawImage(fallback!, sx, sy, sw, sh, 0, 0, sw, sh);
  }
  return canvas.toDataURL("image/jpeg", 0.92);
}
