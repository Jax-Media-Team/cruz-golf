# Handicap calculation logic

All math complies with the World Handicap System (WHS) revision in effect (2024+ formula with the Course Rating − Par term).

## Inputs

- `HandicapIndex` (HI): one decimal, e.g. 14.2.
- `Slope` (S): integer 55..155.
- `CourseRating` (CR): one decimal.
- `Par` (P): integer.
- `Allowance%`: per-format allowance (e.g. 100 for individual stroke play, 95 for stroke-play handicap allowance, 85 for four-ball best-ball, 100 for match play).

## Course Handicap

```
CourseHandicap = round( HI × (Slope / 113) + (CR − Par) )
```

Standard rounding: nearest integer; banker's rounding is NOT used (golf rule is normal rounding, .5 rounds up).

For 9-hole rounds played as half of 18: use the 9-hole rating/slope/par if the course publishes them; otherwise compute using full 18 inputs and divide HI by 2 first (USGA acceptable approach).

## Playing Handicap

```
PlayingHandicap = round( CourseHandicap × Allowance% / 100 )
```

Allowance defaults (group-configurable):

| Format | Allowance % |
|---|---|
| Individual stroke play | 95 |
| Individual match play | 100 |
| Four-ball stroke play (best ball) | 85 |
| Four-ball match play | 90 |
| Foursomes / aggregate | 100 (combined HC × 50 each, by USGA spec, but most groups use straight 100% on each) |
| Stableford | 95 |
| Skins | 100 (commissioner choice) |

Custom allowance is supported per game on a round.

## Stroke allocation (where the dots go)

Strokes are allocated against `course_holes.stroke_index` (1 = hardest, 18 = easiest):

- If `playingHandicap` is positive, the player gets one stroke on each of the `playingHandicap` lowest-SI holes.
- If `playingHandicap > 18`, wrap: the player gets a second stroke on each of the lowest `playingHandicap - 18` holes.
- If `playingHandicap > 36`, wrap again (rare but supported).
- If `playingHandicap` is **negative** (a "plus" handicap), strokes are *given back*: the player must add one stroke to each of the `|playingHandicap|` HIGHEST-SI holes (most courses publish SI 18 first to be given back).

For 9-hole rounds, half-strokes are awarded against the SI ranking restricted to that 9 (each course typically publishes odd SIs on the front and evens on the back, so the front 9 SIs are 1,3,5,7,9,11,13,15,17 — re-rank 1..9 within the side actually being played).

## Net score per hole

```
NetGross = Gross − strokesReceivedOnThisHole
```

For team formats with combined handicaps, the **per-player net** is computed first, then aggregated.

## ESC / max hole score

Optional cap (set per round) to prevent blowup holes from skewing nets:
- `none` — use raw gross.
- `triple_bogey` — gross capped at par + 3 + strokes received.
- `double_bogey_plus` — gross capped at par + 2 + strokes received (matches WHS Net Double Bogey adjustment).

Caps apply to *displayed* gross only when the round option is set; the raw gross is always preserved in `scores.gross`.

## Worked example

Player A: HI 14.2, blue tees on a course where blue is rating 71.2, slope 132, par 72.

```
CH = round( 14.2 × (132/113) + (71.2 − 72) )
   = round( 14.2 × 1.16814 + (−0.8) )
   = round( 16.587 − 0.8 )
   = round( 15.787 )
   = 16
```

Stroke-play allowance 95%:

```
PH = round( 16 × 0.95 ) = round(15.2) = 15
```

So Player A gets one stroke each on the holes with stroke index 1 through 15.

If the same player plays a 4-ball best-ball at the same course, allowance 85%:

```
PH = round( 16 × 0.85 ) = round(13.6) = 14
```

Strokes on SI 1..14.

## Implementation

See [`lib/handicap.ts`](../lib/handicap.ts). Key functions:

```ts
courseHandicap(hi: number, slope: number, rating: number, par: number, holes: 9 | 18): number
playingHandicap(courseHc: number, allowancePct: number): number
strokesPerHole(playingHc: number, strokeIndexes: number[]): number[]
netForHole(gross: number, strokes: number): number
applyCap(gross: number, par: number, strokes: number, mode: ScoreCapMode): number
```

All functions are pure, fully unit-tested in `tests/handicap.test.ts`.

## Edge cases handled

- Plus handicaps (HI < 0).
- 9-hole rounds with derived 9-hole stroke index.
- Rounding ties: standard half-up.
- `playingHandicap > 36` (wraps twice).
- Missing per-hole SI: falls back to "1 stroke per hole" cap of `playingHandicap` whole strokes against hole order, with a warning logged.
