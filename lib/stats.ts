export type ScoreBucket = "eagle_or_better" | "birdie" | "par" | "bogey" | "double" | "other";

export function bucketFor(gross: number, par: number): ScoreBucket {
  const diff = gross - par;
  if (diff <= -2) return "eagle_or_better";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  if (diff === 2) return "double";
  return "other";
}

export const BUCKET_LABELS: Record<ScoreBucket, string> = {
  eagle_or_better: "Eagles+",
  birdie: "Birdies",
  par: "Pars",
  bogey: "Bogeys",
  double: "Doubles",
  other: "Triples+"
};
