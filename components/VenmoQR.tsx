import QRCode from "qrcode";

type Props = {
  handle: string;
  amount?: number; // dollars
  note?: string;
  size?: number;
};

/**
 * Renders a Venmo deep-link QR. Encodes a venmo:// URL that opens the
 * Venmo app to a pay/request screen prefilled for `handle`.
 *
 * Server-rendered SVG; no client JS or 3rd-party hosting required.
 */
export async function VenmoQR({ handle, amount, note, size = 220 }: Props) {
  const cleaned = handle.replace(/^@/, "").trim();
  if (!cleaned) return null;
  const params = new URLSearchParams({
    txn: "pay",
    audience: "private",
    recipients: cleaned
  });
  if (amount && amount > 0) params.set("amount", amount.toFixed(2));
  if (note) params.set("note", note);
  const url = `venmo://paycharge?${params.toString()}`;

  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: size,
    color: { dark: "#0d3b2a", light: "#FFFFFF00" }
  });

  // Strip outer <?xml ?> if present and inject className for styling.
  const cleanedSvg = svg.replace(/<\?xml[^?]*\?>/, "");

  return (
    <div className="inline-flex flex-col items-center">
      <div
        className="rounded-2xl bg-cream-50 p-3 shadow-soft"
        style={{ width: size + 24, height: size + 24 }}
        // dangerouslySetInnerHTML is safe here: SVG produced by qrcode lib
        dangerouslySetInnerHTML={{ __html: cleanedSvg }}
      />
      <div className="mt-2 text-xs text-cream-100/70">
        @{cleaned}
        {amount ? ` · $${amount.toFixed(2)}` : ""}
      </div>
    </div>
  );
}
