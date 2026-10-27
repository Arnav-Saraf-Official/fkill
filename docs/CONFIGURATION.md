# Configuration reference

All match behaviour is driven by one serialisable object:

```ts
interface MatchConfig {
  rules: GameRules;
  setup: MatchSetup; // seed, players, optional manual placements/rotations
}
```

Defaults live in `src/lib/game/rules.ts`. The UI edits the same shape used by
the engine and relay; imported JSON is checked by
`src/lib/game/configuration.ts` and never trusted.

## Editing paths

- **In the app:** `/lobby?mode=solo` exposes every rule; `/settings` edits the
  default rules and imports/exports a full validated configuration.
- **In code:** change `DEFAULT_RULES` / `DEFAULT_GRAPHER_TYPES`, or build a
  preset in `src/lib/game/defaults.ts` (`PRESETS`, `withRules`,
  `createSoloConfig`).
- **In deployment:** pass a validated config to a room (`VITE` client does this
  through the lobby); the authority re-validates it.
- **JSON export** includes `{ version: 1, rules, setup }`.

Validation rejects out-of-range values with readable errors. It does not clamp
silently. Warnings (e.g. cooldowns ignored with automatic selection) are shown
but do not block play.

## Match-wide

| Field | Default | Allowed | Effect |
| --- | --- | --- | --- |
| `maxPlayers` | 10 | 2–10 | hard roster cap, humans + CPUs |
| `maxGraphersPerPlayer` | 5 | 1–20 | loadout cap; engine and room enforce it |
| `grapherHealth` | 1 | 1–20 | shared health of every grapher |
| `targetHitRadius` | 1.1 | 0.2–6 | world-space hit-zone radius |
| `worldSize` | 50 | 20–100 (validation) | plane width/height; UI presents 50 |
| `grapherTypes` | registry below | five ids | weapon and target capabilities |
| `baseCooldownSeconds` | 5 | 0–120 | base per-grapher cooldown |
| `cooldownMultiplier` | 1 | 0–5 | multiplier; 0 disables |
| `selection` | `manual` | manual, auto-round-robin, auto-random | who picks the firing grapher |

## Grapher registry

`rules.grapherTypes.<id>` fields:

| Field | Meaning | Validation |
| --- | --- | --- |
| `label`, `description`, `inputHint` | display text | strings, editable |
| `attackMode` | `function`, `multi-function`, `arc` | enum |
| `maxRoots` | per-function/total root limit (single-function) | 0–200 |
| `maxTotalRoots` | Spray shared budget | 1–200 |
| `maxFunctions` | Spray function count | 1–8 |
| `domainRangeSpan` | total local window width | 2–60 |
| `maxArcRadius` | Arc radius limit | 0.5–100 |
| `maxArcSweepDegrees` | Arc absolute sweep limit | 1–360 |
| `damageToGraphers` | health removed per hit | 0–100 |
| `damageToObstacles` | durability removed per section | 0–100 |

Defaults:

```text
Basic   mode=function       roots=5   span=30  dmg=1  cover=1
Buzzer  mode=function       roots=30  span=25  dmg=2  cover=1
Sniper  mode=function       roots=3   span=50  dmg=10 cover=3
Spray   mode=multi-function roots=10  span=50  dmg=1  cover=1  functions=3
Arc     mode=arc            span=50   radius=25 sweep=180 dmg=3 cover=2
```

## Turn rules (`rules.turns`)

| Field | Default | Allowed | Notes |
| --- | --- | --- | --- |
| `mode` | `round-robin` | round-robin, random, ffa | FFA disables the timer |
| `concurrentPlayers` | 1 | 1–10 | batch size in turn modes |
| `timePerTurnSeconds` | 60 | 5–3600 | slider caps at 120; typed values up to 3600 are preserved |

`concurrentPlayers` is ignored in FFA (warning). Timeouts end the batch; they do
not auto-fire.

## Coordinate plane (`rules.coordinates`)

| Field | Default | Allowed | Notes |
| --- | --- | --- | --- |
| `mode` | `shared` | shared, local | local uses each grapher's position as origin |
| `allowRotation` | false | bool | only meaningful in local mode; ignored otherwise |
| `showAxes` | true | bool | rendering only |
| `showGrid` | true | bool | rendering only |
| `gridSpacing` | 1 | 0.25–10 | finest visible grid; **never** changes gameplay precision |
| `labels` | true | bool | axis number labels |

Rotation is set per grapher in the lobby when local mode + rotation are enabled.
It is interpreted counter-clockwise in degrees, stored in radians.

## Precision (`rules.precision`)

| Field | Default | Allowed | Notes |
| --- | --- | --- | --- |
| `denominator` | 8 | 5–64 | legal positions are multiples of 1/N |
| `showCoordinates` | true | bool | false hides exact coordinates in UI and online projections |

Placement precision, visible grid spacing and mathematical sampling accuracy are
three independent settings.

## Obstacles (`rules.obstacles`)

| Field | Default | Allowed | Notes |
| --- | --- | --- | --- |
| `enabled` | false | bool | off means no obstacle geometry |
| `arrangement` | none | none, scattered, corridor, fortress, random | enabled requires non-none |
| `count` | 3 | 0–24 | used by scattered/random |
| `minSize` | 3 | 1–16 | size measure in coordinate units |
| `maxSize` | 6 | 1–16 | must be ≥ minSize |
| `durability` | 3 | 1–99 | damage per section |
| `indestructible` | false | bool | sections never lose durability |
| `punchThrough` | false | bool | shots continue through cover (still damage it) |
| `sectionSize` | 1.25 | 0.25–5 | section grid resolution |

## Scoring (`rules.scoring`)

| Field | Default | Allowed |
| --- | --- | --- |
| `baseHitPoints` | 10 | 0–1000 |
| `precisionBonusMax` | 10 | 0–1000 |
| `roundingDigits` | 1 | 0–3 |

Formula: `base + bonus × (1 − d/R)`, clamped and rounded once per hit.

## Placement (`rules.placement`)

| Field | Default | Allowed | Notes |
| --- | --- | --- | --- |
| `mode` | auto | auto, manual | manual uses canvas placement (online rooms use auto) |
| `distribution` | min-separation | uniform, even, clustered, min-separation | generated layouts |
| `minSeparation` | 7 | 0–25 | desired centre-to-centre distance |

Generation always respects world bounds, obstacle clearance and the placement
grid; separation is relaxed in bounded stages if necessary.

## Safety limits (`rules.limits`)

| Field | Default | Allowed | Purpose |
| --- | --- | --- | --- |
| `maxExpressionLength` | 240 | 32–1024 | input length |
| `maxAstNodes` | 128 | 16–512 | complexity |
| `maxAstDepth` | 24 | 4–64 | nesting |
| `maxSamples` | 2400 | 256–20 000 | curve sampling budget |
| `maxRootGrid` | 512 | 128–2048 | root sampling resolution |
| `maxRootsToCount` | 40 | 1–200 | stop-after threshold |
| `minSubmitIntervalMs` | 350 | 0–60 000 | FFA anti-flood between accepted shots |
| `maxSubmitsPerWindow` | 12 | 1–200 | FFA anti-flood count |
| `submitWindowMs` | 10 000 | 1000–600 000 | FFA rolling window |

These are protection limits, not balance levers; lowering them can reject
legitimate complex curves.

## Setup (`setup`)

```ts
interface MatchSetup {
  seed: string;                 // deterministic obstacles/placement/CPU
  players: PlayerConfig[];      // id, name, kind, colour, loadout, difficulty
  manualPlacements?: Record<playerId, {x,y}[]>;
  rotations?: Record<playerId, number[]>; // radians per grapher
}
```

`PlayerConfig.kind` is `human` or `cpu`; CPU difficulty ids are
`easy casual steady sharp expert master grandmaster asian`. Display labels live
in `cpu/difficulty.ts` and can be reworded without changing stored ids.

Colour indices 0–9 must be unique. Loadouts must contain 1..maxGraphersPerPlayer
known types. At least one human and two players are required.

## Presets

`PRESETS` in `src/lib/game/defaults.ts` builds complete configs:

- **Quick match** — 5 graphers, 1 health, 60 s round robin, cooldowns on.
- **Precision duel** — local planes + rotation, 1/32 placement, hidden
  coordinates, 2 health, sniper-heavy loadout.
- **Obstacle arena** — fortress cover, durability 4, 3 health, spray/arc mix.
- **Free-for-all** — 4 players, no turns/timer, 1.5× cooldown.

Presets populate real rules and remain editable; they are validated like any
other configuration.
