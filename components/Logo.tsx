type Props = {
  /** Visible HEIGHT of the icon, in pixels. Width auto-scales from the asset's
   *  natural aspect ratio so this works for square OR horizontal icon files. */
  size?: number;
  className?: string;
  /** Legacy props — accepted for backward compatibility, otherwise ignored. */
  variant?: "emblem" | "full";
  crop?: boolean;
  withWordmark?: boolean;
  tone?: "dark" | "light";
};

/**
 * Cruz Golf icon (crossed clubs + ball + "C"). The asset at /cruz-logo.png is
 * the source of truth and never redrawn. CRUZ as a wordmark lives in
 * `BrandLockup` as live text — it is NOT in the asset.
 */
export function Logo({ size = 64, className = "" }: Props) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/cruz-logo.png"
      alt="Cruz"
      style={{ height: size, width: "auto", display: "block", maxWidth: "none" }}
      className={`shrink-0 ${className}`}
      decoding="async"
    />
  );
}
