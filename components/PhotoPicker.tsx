"use client";
import { useRef } from "react";

/**
 * Two-affordance file picker — "Take photo" (camera) AND "Choose from
 * library" (existing photos / Files / iCloud / Drive). Replaces the
 * single `<input capture="environment" />` pattern that was forcing the
 * camera and silently denying users their saved screenshots, AirDropped
 * scorecards, and texted images.
 *
 * Per Patrick (2026-05-10): "many users screenshot scorecards, save
 * photos earlier, receive photos in text threads, upload later after
 * the round." That workflow is broken by `capture="environment"` so we
 * present BOTH paths.
 *
 * The component is unstyled-by-default — the host page passes its own
 * trigger UI via `children`. Multiple invocations stay isolated thanks
 * to refs.
 *
 * iOS Safari handles `capture` differently in installed-PWA mode; we
 * use the standard HTML attribute and let the OS sheet decide. Android
 * Chrome and desktop browsers also respect this.
 */
export function PhotoPicker({
  onFiles,
  multiple = true,
  accept = "image/*",
  /** Limit how many files can be added in one tap. Used by callers
   *  that cap previews (e.g. scorecard import allows max 3). */
  remaining,
  disabled = false,
  /** Render the trigger UI. Receives two callbacks — one for camera,
   *  one for library — so callers can place them however they want. */
  children
}: {
  onFiles: (files: FileList) => void;
  multiple?: boolean;
  accept?: string;
  remaining?: number;
  disabled?: boolean;
  children: (handlers: {
    openCamera: () => void;
    openLibrary: () => void;
    disabled: boolean;
  }) => React.ReactNode;
}) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (typeof remaining === "number" && remaining > 0 && files.length > remaining) {
      // Trim to the remaining slots so callers don't have to handle the cap.
      const trimmed = new DataTransfer();
      for (let i = 0; i < remaining; i++) {
        if (files[i]) trimmed.items.add(files[i]);
      }
      onFiles(trimmed.files);
    } else {
      onFiles(files);
    }
  }

  return (
    <>
      {/* Camera-only input — capture=environment forces the rear camera. */}
      <input
        ref={cameraRef}
        type="file"
        accept={accept}
        multiple={multiple}
        capture="environment"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      {/* Library / Files input — NO capture attribute, so iOS shows the
          full sheet (Photo Library / Choose Files / etc.) and desktop
          shows the standard file picker. */}
      <input
        ref={libraryRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      {children({
        openCamera: () => cameraRef.current?.click(),
        openLibrary: () => libraryRef.current?.click(),
        disabled
      })}
    </>
  );
}
