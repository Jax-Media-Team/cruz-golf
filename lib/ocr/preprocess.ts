/**
 * Client-side image preprocessing for OCR uploads.
 *
 * Stage 1 of the OCR pipeline. Two concerns:
 *
 * 1. **EXIF orientation.** iPhone photos almost always have EXIF
 *    rotation metadata. Browsers handle this transparently when an
 *    `<img>` is rendered, but a raw data URL from FileReader keeps
 *    the natural pixel orientation — which gpt-4o then sees rotated.
 *    `createImageBitmap(blob, { imageOrientation: "from-image" })`
 *    is the standard fix: decodes with EXIF rotation already applied.
 *
 * 2. **Right-sizing.** OpenAI's `detail: "high"` mode splits images
 *    into 512x512 tiles up to 16 tiles total (~2048x2048 effective).
 *    Anything larger is downsampled SERVER-side anyway, AND eats
 *    request bandwidth + cost. Capping the long side at 2400px
 *    gives a margin for square cards and avoids the per-tile waste.
 *
 * Conservative scope: this file does NOT do deskew, brightness
 * normalization, contrast boost, or pencil-handwriting enhancement.
 * Those are reserved for the "if the simple fix isn't enough" path
 * Patrick called out — we wait to see real-world results before
 * stacking more transforms. Each extra step is a place for the
 * pipeline to silently lose information.
 */

/**
 * Compute the target canvas dimensions for OCR. Capped at
 * `maxLongSide` on the LONG side, preserving aspect ratio. Pure
 * function — no DOM access — so the math is testable in isolation.
 */
export function computeOcrTargetDimensions(
  sourceW: number,
  sourceH: number,
  maxLongSide: number = 2400
): { w: number; h: number; scaled: boolean } {
  if (sourceW <= 0 || sourceH <= 0) {
    return { w: 0, h: 0, scaled: false };
  }
  const longSide = Math.max(sourceW, sourceH);
  if (longSide <= maxLongSide) {
    return { w: sourceW, h: sourceH, scaled: false };
  }
  const ratio = maxLongSide / longSide;
  return {
    w: Math.round(sourceW * ratio),
    h: Math.round(sourceH * ratio),
    scaled: true
  };
}

/**
 * Diagnostic info returned alongside the prepared data URL — useful
 * for the upload-view's diagnostics panel ("did EXIF rotation
 * apply?" / "was the image downscaled?").
 */
export type PrepareImageResult = {
  /** The processed image as a data URL ready for upload. */
  dataUrl: string;
  /** Original file size in bytes. */
  source_bytes: number;
  /** Original pixel dimensions (after EXIF rotation if applied). */
  source_w: number;
  source_h: number;
  /** Output dimensions (may equal source if no scaling). */
  output_w: number;
  output_h: number;
  /** True iff we downscaled — useful for "why did this look soft?" */
  scaled: boolean;
  /** True iff we round-tripped through canvas (vs. raw FileReader
   *  fast-path for small images). */
  reencoded: boolean;
  /** Approximate output size in bytes. */
  output_bytes: number;
};

/**
 * Read a File as a data URL via FileReader. The cold-path fallback
 * when canvas / createImageBitmap isn't available (older browsers,
 * some Safari versions).
 */
function fileToDataUrlRaw(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/**
 * Prepare an image file for OCR upload. EXIF orientation is applied
 * and the long side is capped at `maxLongSide` (default 2400px).
 * Small files (< 1.5 MB) skip the canvas round-trip — they're
 * already small enough and re-encoding adds JPEG-of-JPEG artifacts.
 *
 * Failure modes degrade gracefully: if canvas / createImageBitmap
 * isn't available, we fall back to the raw FileReader path so the
 * upload still works (just without orientation correction or
 * downscaling).
 */
export async function prepareImageForOCR(
  file: File,
  maxLongSide: number = 2400
): Promise<PrepareImageResult> {
  const sourceBytes = file.size;

  // Fast path: small files bypass canvas entirely.
  if (file.size <= 1_500_000) {
    const dataUrl = await fileToDataUrlRaw(file);
    return {
      dataUrl,
      source_bytes: sourceBytes,
      source_w: 0,
      source_h: 0,
      output_w: 0,
      output_h: 0,
      scaled: false,
      reencoded: false,
      output_bytes: dataUrl.length
    };
  }

  // Browser-feature guard: createImageBitmap is the standard for
  // EXIF-respecting decode. If absent (older Safari, very old
  // Android Chrome), fall back to the raw path — we'd rather upload
  // an un-rotated image than fail outright.
  if (typeof createImageBitmap !== "function") {
    const dataUrl = await fileToDataUrlRaw(file);
    return {
      dataUrl,
      source_bytes: sourceBytes,
      source_w: 0,
      source_h: 0,
      output_w: 0,
      output_h: 0,
      scaled: false,
      reencoded: false,
      output_bytes: dataUrl.length
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      // "from-image" is the option that tells the browser to apply
      // EXIF orientation during decode. Without it the canvas gets
      // the raw pixel buffer and rotation metadata is lost.
      imageOrientation: "from-image"
    });
  } catch {
    // Some Safari versions reject the option object entirely. Try
    // again without it — we lose EXIF correction but keep the
    // downscale path.
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      const dataUrl = await fileToDataUrlRaw(file);
      return {
        dataUrl,
        source_bytes: sourceBytes,
        source_w: 0,
        source_h: 0,
        output_w: 0,
        output_h: 0,
        scaled: false,
        reencoded: false,
        output_bytes: dataUrl.length
      };
    }
  }

  const { w, h, scaled } = computeOcrTargetDimensions(
    bitmap.width,
    bitmap.height,
    maxLongSide
  );

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    const dataUrl = await fileToDataUrlRaw(file);
    return {
      dataUrl,
      source_bytes: sourceBytes,
      source_w: bitmap.width,
      source_h: bitmap.height,
      output_w: 0,
      output_h: 0,
      scaled: false,
      reencoded: false,
      output_bytes: dataUrl.length
    };
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  const sourceW = bitmap.width;
  const sourceH = bitmap.height;
  bitmap.close();

  // JPEG q=0.92 is the sweet spot — visually indistinguishable from
  // q=1.0 for OCR purposes, ~30% smaller payload.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    dataUrl,
    source_bytes: sourceBytes,
    source_w: sourceW,
    source_h: sourceH,
    output_w: w,
    output_h: h,
    scaled,
    reencoded: true,
    output_bytes: dataUrl.length
  };
}
