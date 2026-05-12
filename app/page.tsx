import Link from "next/link";
import { BrandLockup } from "@/components/BrandLockup";

export default function Landing() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-5 sm:px-8 py-4 max-w-6xl mx-auto w-full flex items-center justify-between gap-4">
        <span className="hidden sm:inline-flex">
          <BrandLockup iconHeight={128} />
        </span>
        <span className="sm:hidden inline-flex">
          <BrandLockup iconHeight={76} />
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/login" className="btn-ghost text-sm">Sign in</Link>
          <Link href="/signup" className="btn-primary text-sm">Create account</Link>
        </div>
      </header>

      <section className="flex-1 px-5 sm:px-8 pt-8 sm:pt-12 pb-20 max-w-6xl mx-auto w-full">
        <div className="surface rounded-3xl shadow-glow p-7 sm:p-14 bg-grain">
          <p className="h-eyebrow mb-5 text-gold-400">For private golf groups · invite only</p>
          <h1 className="h-display text-5xl sm:text-7xl leading-[0.95] text-cream-50 max-w-3xl">
            Your Saturday game,<br />
            <span className="text-gold-500">finally organized.</span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-cream-100/75 max-w-2xl leading-relaxed">
            Skins. Nassau. Best Ball. Settle up before you leave the parking lot.
          </p>
          <p className="mt-3 text-sm sm:text-base text-cream-100/55 max-w-xl">
            Live scoring for private golf groups, member games, and small club events.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            {/* Audit P2 #18: hero has one primary action. The 90-second
                demo CTA lives in the "Take the tour" strip below the
                features so the eye doesn't bounce between two equal
                buttons. */}
            <Link href="/signup" className="btn-primary">Create account</Link>
          </div>
          {/* Audit P2 #16: returning users get a small text link, not a
              third button competing with the primary CTAs. */}
          <p className="mt-3 text-sm text-cream-100/55">
            Have an account?{" "}
            <Link href="/login" className="text-cream-50 underline underline-offset-2">
              Sign in
            </Link>
            .
          </p>

          <p className="mt-12 text-sm text-cream-100/55 max-w-xl">
            {/* Audit P2 #17: "wagers" → "groups" — sounds less casino,
                reads truer to a JGCC member-member group's
                self-description. */}
            Built for member games, regular groups, and small club events — the modern operating system for private golf groups.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <Feature
            eyebrow="Game types"
            title="Every game your group plays"
            body="Skins. Nassau. Best Ball. 2-Man. 6-6-6. Wolf. Quota. Gross + Net. Run multiple at once on the same round."
          />
          <Feature
            eyebrow="Live scoring"
            title="Score from your phone"
            body="Hole-by-hole entry from every player's phone. The leaderboard updates in real time for the whole group."
          />
          <Feature
            eyebrow="Handicaps"
            title="Strokes done for you"
            body="Automatic course handicap and per-hole stroke allocation. Plus handicaps and 9-hole rounds handled."
          />
          <Feature
            eyebrow="Wagers & settlements"
            title="Every press, every payout"
            body="Track every wager, side bet, press, and skin. Final tally pre-fills Venmo with the right amount."
          />
          <Feature
            eyebrow="Private groups"
            title="Invite-only access"
            body="Per-round PIN, single-use invite links. Nothing public. No discoverability. Just your group."
          />
          <Feature
            eyebrow="Scorecard upload"
            title="Photo a paper card"
            body="Snap a photo of the paper scorecard, OCR drops the scores into the grid for review before saving."
          />
        </div>

        <div className="mt-10 card p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="h-eyebrow text-gold-400">Take the tour</p>
            <h3 className="font-serif text-2xl sm:text-3xl text-cream-50 mt-1">
              See a round end-to-end in 90 seconds.
            </h3>
            <p className="text-sm text-cream-100/65 mt-1">
              Set up the round, configure the bets, watch the leaderboard move, settle up. Live demo, no signup.
            </p>
          </div>
          <Link href="/demo" className="btn-primary shrink-0">
            Walk me through it →
          </Link>
        </div>
      </section>

      <footer className="px-6 py-8 text-center text-xs text-cream-100/40">
        Cruz Golf · {new Date().getFullYear()}
      </footer>
    </main>
  );
}

function Feature({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="card p-6 sm:p-7">
      <p className="text-[10px] uppercase tracking-[0.32em] text-gold-400">{eyebrow}</p>
      <h3 className="font-serif text-2xl sm:text-3xl text-cream-50 mt-2">{title}</h3>
      <p className="mt-2 text-sm sm:text-base text-cream-100/70 leading-relaxed">{body}</p>
    </div>
  );
}
