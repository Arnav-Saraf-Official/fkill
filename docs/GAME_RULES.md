# f(kill) — game rules

This document describes **what the code actually does**. The single source of
truth is `src/lib/game/rules.ts` (`DEFAULT_RULES`, `DEFAULT_GRAPHER_TYPES`) and
the constraint checks in `src/lib/game/configuration.ts`.

## 1. Match model

- A match has **2–10 players**, human or CPU, combined.
- Each player owns **1–20 graphers**, chosen as a mixed loadout.
- A grapher is both a weapon (its type limits attacks) and a target (its world
  position is a hit zone).
- Positions are fixed for the duration of a match. They are selected in the
  lobby by manual placement or generated from a seed.
- A player is eliminated when no living grapher remains. The match ends when at
  most one player has a living grapher.

### Defaults

| Setting | Default | Range |
| --- | --- | --- |
| Players | 2 (1 human + 1 CPU preset) | 2–10 |
| Graphers per player | 5 | 1–20 |
| Grapher health | 1 | 1–20 |
| Target hit radius | 1.1 units | 0.2–6 |
| World plane | 50 × 50 | fixed for gameplay |
| Turn timer | 60 s | 5–3600 s (slider max 120) |
| Base cooldown | 5 s × multiplier | multiplier 0–5 |
| Obstacle durability | 3 per section | 1–99 |
| Placement precision | 1/8 unit | denominator 5–64 |

## 2. Coordinate plane

Every match uses a square world plane of **50 × 50 coordinate units**:

```text
x ∈ [-25, 25]      y ∈ [-25, 25]
```

The renderer preserves one unit to one unit in both axes. The camera may pan and
zoom, but camera state never enters validation, reach or collision maths.

### Domain/range span

`domainRangeSpan` is the **total width** of a grapher's valid local coordinate
window, centred on its local origin:

| Span | Valid x | Valid y |
| --- | --- | --- |
| 25 | −12.5 … 12.5 | −12.5 … 12.5 |
| 30 | −15 … 15 | −15 … 15 |
| 50 | −25 … 25 | −25 … 25 |

A curve is clipped to the intersection of the grapher window and the world
plane. Points outside that intersection cannot be hit even if the renderer
draws a longer preview (it does not — preview and gameplay share the clipped
geometry).

### Shared vs local planes

- **Shared:** every grapher uses the world origin. Equation coordinates are
  world coordinates.
- **Local:** the selected grapher's world position is the local origin. With
  rotation enabled, local axes are rotated counter-clockwise by the grapher's
  rotation angle (reported in the lobby in degrees):

```text
world = grapherPosition + R(rotation) · local
```

The same `frameForGrapher` / `localToWorld` functions are used by the editor
preview, sampling, collision, obstacles, scoring and CPU. Rotation changes the
mathematics, not just the drawn axes.

## 3. Expression language

### Grammar

```text
expr  := term (('+' | '-') term)*
term  := unary (('*' | '/') unary | implicit-mul unary)*
unary := ('-' | '+') unary | power
power := atom ('^' unary)?            right-associative
atom  := number | 'x' | 'pi' | 'e' | 'tau' | call | '(' expr ')'
call  := func '(' expr ')'            exactly one argument
```

- Implicit multiplication is supported: `2x`, `3sin(x)`, `(x+1)(x-1)`, `x(x+1)`.
- A leading `y =` or `f(x) =` is stripped; a stray `=` elsewhere is rejected.
- Unicode sugar is normalised: `x² → x^(2)`, `π → pi`, `√ → sqrt`, `×`/`·` → `*`,
  `÷` → `/`, typographic minus signs → `-`.
- Functions: `sin cos tan asin acos atan arcsin arccos arctan sqrt abs exp ln log`.
- Constants: `pi`, `e`, `tau`.
- **Trigonometry uses radians.**
- `log` is base 10; `ln` is natural. `log(0)` is −∞ and `log(negative)` is
  undefined (NaN), rather than throwing.
- `x^y` with a negative base and non-integer exponent is not real-valued and
  evaluates to NaN.

### Safety limits (defaults)

| Limit | Default | Range |
| --- | --- | --- |
| Expression length | 240 chars | 32–1024 |
| AST nodes | 128 | 16–512 |
| AST depth | 24 | 4–64 |
| Samples per curve | 2400 | 256–20 000 |
| Root sampling grid | 512 | 128–2048 |
| Roots counted before stopping | 40 | 1–200 |

The parser is allowlisted and has no access to `eval`, `Function`, globals,
properties or identifiers other than `x` and the named constants.

## 4. Roots — the ammunition rule

A **root** is a distinct real solution of `f(x) = 0` inside the grapher's local
x-window. It is not a polynomial degree and not a visual crossing count.

`analyseRoots` (in `src/lib/math/roots.ts`) is numerical:

1. Sample two offset grids (reduces aliasing for oscillating curves).
2. Detect sign changes and bisect them, rejecting poles using a relative
   zero test (`|f(x)|` must be negligible compared with neighbouring values).
3. Find tangent roots by minimising `|f|` around local minima and accepting a
   true touch at zero.
4. Detect roots at the ends of a restricted domain (e.g. `sqrt(x-1)` at `x = 1`)
   by checking that `|f|` shrinks toward the boundary.
5. Deduplicate roots closer than `span × 1e-6`; stop as soon as the budget is
   exceeded, returning `exceeded = true`.

`f(x) ≡ 0` is reported as **degenerate** (infinitely many roots) and rejected.
Non-finite regions, division by zero, invalid square roots/logs and asymptotes
produce no roots and no geometry there; they do not crash the engine.

**Honest caveat:** this is an estimate with a documented sampling resolution, not
symbolic algebra. Very high-frequency expressions may be undercounted near the
grid limit. The safety limits bound the work; see §12. The UI reports the
counted value and rejects when it exceeds the budget; it does not claim a
symbolic proof.

### Per-grapher budgets

| Type | Mode | Root limit | Functions | Span | Damage (grapher) | Damage (cover) |
| --- | --- | --- | --- | --- | --- | --- |
| Basic | single function | 5 | 1 | 30 | 1 | 1 |
| Buzzer | single function | 30 | 1 | 25 | 2 | 1 |
| Sniper | single function | 3 | 1 | 50 | 10 | 3 |
| Spray | multi-function | 10 shared | 3 | 50 | 1 | 1 |
| Arc | circular arc | none | 1 arc | 50 | 3 | 2 |

Defaults for Buzzer/Spray/Arc damage were chosen for playability; every value is
independently configurable and is read from the registry by the UI, validator,
CPU and relay.

### Spray budget

Spray validates each function separately, then checks the **sum** of distinct
roots across submitted functions. Example: 4 + 3 + 3 = 10 is valid; 4 + 4 + 3 =
11 is rejected. Each component resolves independently, so two different
functions may damage the same target.

### Arc

`arc(centerX, centerY, radius, startAngle, sweepAngle)`:

- Centre in the grapher's **local** window; radius > 0; radius ≤ configured max
  (25 default).
- `startAngle` and `sweepAngle` are degrees. 0° points along local +x;
  positive sweep is counter-clockwise. Sweep must be non-zero and
  |sweep| ≤ configured max (180° default).
- The arc is sampled as a true circular arc and clipped to the local window and
  world plane. It is never converted into a user-visible `y = f(x)`.
- The arc does not consume roots.

## 5. Attack validation order

`prepareAttack` rejects the whole attack on the first set of issues; nothing is
silently clamped or dropped:

1. At least one component; component count respects the grapher mode.
2. Arc fields finite, radius/sweep within limits, centre inside the window.
3. Function parses under the allowlist, complexity limits and length limit.
4. Some finite value exists in the clipped window.
5. Roots counted; degenerate/infinite and over-budget expressions rejected.
6. Curve intersects the local window and the world plane.
7. Geometry transformed into world coordinates and clipped.

The game engine then additionally checks: match running, submission deadline,
player alive, player on turn / not already acted, FFA rate limit, grapher
ownership and cooldown.

## 6. Hit zones, cover and damage

- Each living enemy grapher is a circle of radius `targetHitRadius` (default
  1.1) centred on its **authoritative world position**.
- The minimum distance `d` from the target centre to the **visible** attack
  geometry is computed in world coordinates; `d ≤ R` is a hit.
- One component can damage a given target at most once, regardless of how many
  sampled segments pass through the zone.
- Different components of a Spray may each hit the same target.
- Functions use the sampled/clipped polyline; arcs use exact
  point-to-circular-arc distance.

### Cover resolution (deterministic)

The trace begins at the point on the curve closest to the firing grapher and
walks outward in both directions.

1. Occlusion is evaluated against live cover **before** the attack.
2. The first intact section crossed blocks the rest of that path. A section
   destroyed by this attack therefore does **not** open a gap for the same
   attack.
3. Every crossed live section takes the attacker's `damageToObstacles`, once per
   component; durability decreases locally. Destroyed sections stop blocking
   future attacks.
4. If `punchThrough` is enabled, the path continues through cover; otherwise it
   stops at the first intact section. Cover still absorbs damage.
5. Indestructible cover absorbs no durability loss and always blocks.
6. Only visible geometry beyond cover can hit targets.

Damage is dealt by the **attacking grapher type**. Health is shared per match.
At health 20, two Sniper hits (10 each) destroy a grapher; at health 1 one
damaging hit does.

## 7. Scoring

For a hit at distance `d` within hit radius `R`:

```text
precisionRatio = clamp(1 - d/R, 0, 1)
score = round(baseHitPoints + precisionBonusMax * precisionRatio, roundingDigits)
```

Defaults: base 10, bonus 10, one decimal place. A centre hit scores 20, a graze
scores just above 10. The UI shows the score per hit and the total per attack.
The rule lives in `src/lib/game/scoring.ts`; alternative scoring can replace that
function without touching collision or UI.

## 8. Obstacles

- Shapes: circles, polygons/blobs, rounded rectangles, composite predefined
  arrangements (`corridor`, `fortress`) and seeded random sets.
- Each obstacle is filled with a uniform grid of sections. Each section has its
  own durability; damaging one never destroys the whole obstacle.
- Durability is damage points per section. `indestructible` is explicit and
  makes every section permanently blocking.
- `punchThrough` decides whether a shot continues past cover; even with
  punch-through, this shot's damage cannot open a retroactive path.
- Placement and generation keep graphers outside cover with a clearance margin,
  and generated cover stays inside the world plane.
- Enabled obstacles require an arrangement other than `none`; the configuration
  validator rejects that inconsistent state.

## 9. Turn scheduling

### Round Robin

Players act in roster order. `concurrentPlayers = 1..10` defines batch size. A
batch's players all receive a turn at once; the next batch starts when every
actor in it has acted, passed, disconnected, been eliminated or the timer
expires. The last batch of a cycle may be smaller than the batch size.

### Random

The same batch mechanics, but each cycle is a seeded shuffle drawn without
replacement. No player is selected twice in a cycle while others wait, and
eliminated players are removed from the bag. When the bag empties, a new cycle
starts.

### Free-for-All (FFA)

- Every living player may submit at any time; there are no batches and no turn
  timer (`endsAt = null`).
- Submission order is authoritative acceptance order.
- Eliminated players cannot act.
- Flood protection (independent of gameplay balance): at most **12 accepted
  attacks per 10 s** and at least **350 ms between accepted attacks** per
  player. Rejections do not consume the quota. These values are configurable in
  the safety limits.

Timers are based on authoritative milliseconds. The online client derives its
clock from the server snapshot; changing the local clock cannot extend a turn.
On timeout the batch ends without waiting for the remaining actor.

## 10. Grapher selection and cooldowns

- **Manual:** the player chooses a ready grapher. Cooldowns apply per grapher:
  `duration = baseCooldownSeconds × cooldownMultiplier × 1000 ms`.
  A multiplier of 0 disables cooldowns.
- **Auto round robin:** the engine selects the next living grapher in order.
- **Auto random:** the engine selects a living grapher from a seeded draw.
- Automatic modes ignore the cooldown multiplier; the UI disables that setting.
  Cooldowns are tracked per grapher and never block a different ready grapher.

## 11. Precision, coordinates and placement

- **Placement precision:** legal positions lie on multiples of `1/denominator`
  (denominator 5–64). The canvas snaps clicks to this grid; generated positions
  use it too. This is separate from rendering accuracy.
- **Coordinate visibility:** when disabled, exact enemy coordinates are not
  shown in labels, tooltips or network snapshots; online projections snap
  opponent positions to the visible grid spacing. Players must estimate from
  the graph.
- **Grid spacing** is visual only and never changes gameplay accuracy.
- **Placement modes:** manual (canvas clicks, per grapher) or automatic.
  Automatic distributions: `uniform`, `even`, `clustered`, `min-separation`.
  Generated positions obey world bounds, obstacle clearance and separation.
  Bounded attempts relax separation and finally use a deterministic fallback;
  generation never loops forever.
- Manual placement must be complete and legal to be used; otherwise the match
  reports a warning and generates positions.

## 12. Computational bounds

All numeric work is bounded:

- expressions: length, node count, depth;
- roots: grid ≤ 2048, stops after budget + 1;
- sampling: total points ≤ configured `maxSamples`, adaptive depth 5;
- arc: ≤ 1440 points;
- collision: section index broadphase; sections along a segment are capped by
  the cell walk.

Malformed input is rejected with a readable issue; a bad expression never
crashes a room. The authoritative relay additionally caps message size (96 KiB),
60 messages per 10 s per socket, and validates every intent.

## 13. Victory and results

- Last player with at least one surviving grapher wins.
- If all remaining graphers are destroyed in one resolution, the deterministic
  tie-break is: (1) remaining total health, (2) score, (3) original player order.
- A finished match accepts no further attacks.
- Results show winner/tie, final scores, destroyed graphers, hits, accuracy,
  damage and obstacle sections destroyed, plus rematch/lobby/exit actions.
- There is no optional time limit in this build; the win condition module is
  replaceable if one is added later.

## 14. CPU behaviour

CPUs follow the same pipeline as humans:

1. observe projected public state;
2. list ready graphers (cooldowns respected);
3. generate legal candidate functions/arcs under the registry limits;
4. validate and simulate each through the real engine;
5. score hits, damage, finishing value and obstacle awareness;
6. choose best or a nearby alternative according to difficulty;
7. submit a normal `submit-attack` action through the authority.

Difficulty changes candidate budget, aim error, chance of choosing the best
option, multi-target/stacking preferences and obstacle awareness. It never
changes roots, range, damage, health, cooldown or visibility. Think time is
cosmetic.

## 15. Assumptions made where the brief was ambiguous

- Domain/range span means total interval width, centred on the local origin.
- Shared-plane mode ignores local rotation (the option is disabled/ignored and
  the validator warns).
- Arc centre is interpreted in the firing grapher's local window even in shared
  mode; for a shared plane the local origin is the world origin.
- Score is rounded once per hit using the configured decimal places.
- Buzzer damage defaults to 2, Arc to 3 and Spray to 1; Sniper stays at the
  specified 10.
- The world plane is fixed at 50 × 50; `worldSize` is configurable in the rules
  for future variants but the UI presents the standard plane.
- A turn that times out ends the batch; it does not auto-fire for the player.
- Online room names are display-only; there is no account authentication. Room
  membership is proved by a per-room resume token, not a user identity.
