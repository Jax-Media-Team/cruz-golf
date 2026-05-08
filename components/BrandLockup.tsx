import { Logo } from "./Logo";

type Props = {
  /** Visible height of the icon, in pixels. Width auto-scales from the asset. */
  iconHeight?: number;
  /** Pixel size of the optional live "CRUZ" text. Defaults to ~iconHeight × 0.46. */
  textSize?: number;
  /** Render only the icon (default true — the C-in-ball is the brand mark). */
  iconOnly?: boolean;
  /** Wrap the lockup with extra classes. */
  className?: string;
};

/**
 * Cruz brand lockup. By default it's icon-only — the asset itself is the
 * brand mark (crossed clubs + golf ball with "C" inside). Pass
 * `iconOnly={false}` to also render the live "CRUZ" wordmark beside it.
 */
export function BrandLockup({
  iconHeight = 96,
  textSize,
  iconOnly = true,
  className = ""
}: Props) {
  const t = textSize ?? Math.round(iconHeight * 0.46);
  return (
    <span className={`inline-flex items-center gap-3 sm:gap-4 ${className}`}>
      <Logo size={iconHeight} />
      {!iconOnly && (
        <span
          className="font-serif leading-none text-gold-500 select-none"
          style={{
            fontSize: t,
            letterSpacing: "0.18em",
            // Slight optical lift so CRUZ centerline matches the ball.
            transform: "translateY(-1px)"
          }}
        >
          CRUZ
        </span>
      )}
    </span>
  );
}
