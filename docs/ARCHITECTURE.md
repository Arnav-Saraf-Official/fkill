# f(kill) — architecture

The code is split so the mathematics, rules and combat engine run without
Svelte, the browser or a server. The same modules power solo play, the CPU and
the authoritative relay.

## 1. Layers

```text
┌──────────────────────────── UI (Svelte 5) ────────────────────────────┐
│ routes: /  /lobby  /play  /settings                                   │
│ components: graph canvas · equation editor · HUD · lobby              │
│ ui/: theme · preferences · stores (SoloGame / OnlineSession)          │
└───────────────▲───────────────────────────────▲───────────────────────┘
                │ typed state / actions         │ snapshots / intents
┌───────────────┴──────────────┐   ┌────────────┴──────────────────────┐
│ game/                        │   │ multiplayer/                      │
│ state machine, turns,        │   │ protocol, RoomAuthority, Room,    │
│ collision, scoring, cover,   │   │ transport, reconnect              │
│ placement, presets, config   │   │                                   │
└───────────────▲──────────────┘   └────────────▲──────────────────────┘
                │ validated components          │ bundled by esbuild
┌───────────────┴───────────────────────────────┴──────────────────────┐
│ math/                                                                 │
│ parser → evaluator → roots → sampling → validation → transforms       │
│ geometry primitives shared by rendering and collision                 │
└──────────────────────────────────────────────────────────────────────┘
```

- `src/lib/game/types.ts` is the shared vocabulary. It imports nothing from
  Svelte, the DOM or a host adapter.
- `src/lib/game/rules.ts` is the sole registry for balancing values and the
  ranges used by validation and UI.
- `src/lib/math/validation.ts` is the **only** place where raw input becomes
  legal geometry. Player, CPU and relay all call it.
- `src/lib/game/state.ts` is the authoritative state machine. Every mutation
  returns a structured `ActionResult`; transient effects are never stored in it.

## 2. Core flow

### Creating a match

```text
lobby draft (rules + setup)
  → validateMatchConfig
  → createMatch
      → createObstacles(seed)
      → generatePlacements / prepareManualPlacements
      → createTurnState
  → MatchState (running)
```

### Resolving an attack

```text
submitAttack(state, action, now)
  1 checks phase, deadline, player, turn ownership, rate limit
  2 selects grapher (manual/auto) and checks cooldown
  3 frameForGrapher → prepareAttack (parse, roots, sample, clip, world transform)
  4 traceAttack
      a trace visible geometry from closest point to shooter
      b stop at first live section unless punchThrough
      c distance to each enemy hit zone
      d obstacle section damage, deduped per component
  5 apply damage in deterministic order, precision score per hit
  6 mark eliminations, advance batch, evaluate outcome
  7 return { ok, state, attack } + event log entries
```

State is cloned, so callers never observe a half-applied attack. Given the same
state, action, `now` and seed, the result is identical. Randomness is always
derived from explicit seed strings and counters (`createRng`).

## 3. Mathematics

| Module | Responsibility |
| --- | --- |
| `parser.ts` | allowlisted tokenizer/parser, complexity guards, parse cache |
| `evaluator.ts` | AST evaluation; NaN/±∞ for undefined/singular values |
| `roots.ts` | numerical distinct-root analysis within a window |
| `sampling.ts` | adaptive sampling with discontinuity splitting, arc sampling |
| `geometry.ts` | bounds, clipping, distances, polyline helpers |
| `transforms.ts` | the single local↔world rigid transform |
| `validation.ts` | attack legality and prepared world geometry |
| `roots.ts` | tangent roots, boundary roots, asympote rejection |

Rendering consumes the same `PreparedComponent.world` geometry that collision
uses. Camera pan/zoom only changes canvas projection.

## 4. Game engine

| Module | Responsibility |
| --- | --- |
| `rules.ts` | registry, defaults, scoring rounding, placement grid, cooldowns |
| `configuration.ts` | validation, ranges, import/export, serialisable config |
| `state.ts` | match creation, selection, submission, tick, pass, disconnect |
| `turn-scheduler.ts` | batches, random bag without replacement, FFA |
| `collision.ts` | occlusion walk, hit distances, obstacle hits |
| `scoring.ts` | precision score |
| `obstacles.ts` | shapes, sections, local durability, spatial index |
| `placement.ts` | seeded legal layouts, manual validation, fallbacks |
| `win-conditions.ts` | last-standing and deterministic tie-break |
| `defaults.ts` | setup builder, deep rule patches, presets |
| `rng.ts` | deterministic RNG and unguessable room/player ids |

## 5. CPU

`cpu/difficulty.ts` defines eight profiles. `candidate-generator.ts` produces
legal curves/arcs from projected targets; `evaluator.ts` scores simulated
results; `planner.ts` runs:

```text
observe → ready graphers → candidates → real validator → simulated submit
       → score → choose according to profile → normal submit action
```

The planner uses `submitAttack(..., { commit: false })` for simulation. When it
commits, the authority applies the same code path as a human. Difficulty never
changes legality or hidden information.

## 6. Multiplayer

```text
browser RoomClient ──WebSocket /ws──► server/relay.mjs
       ▲                                  │
       │ snapshots (projected per viewer)  │ intents
       └──────────── RoomAuthority ◄──────┘
                       Room
                        └─ MatchState + MatchConfig + LobbyPlayers
```

- `protocol.ts` is shared by both sides. `parseServerMessage` validates
  server→client frames; `parseMessage` validates client→server frames.
- `room.ts` owns lobby state, locked rules, seats, readiness, CPU participants,
  timers, reconnection tokens and the authoritative match. `projectStateForViewer`
  hides exact coordinates when configured.
- `transport.ts` handles create/join/resume, reconnect backoff, ping/latency and
  server snapshots; `reconnect.ts` stores a per-room token in localStorage.
- Clients send only intents: ready, set-loadout, set-rules, set-cpu, start,
  submit-attack, pass, leave, rematch. They never send damage, hits, scores,
  cooldown completion or turn ownership. Forged fields are ignored by the
  authority.
- The relay (`server/relay.mjs`) is a small Node shell with health endpoint,
  origin allow-list, payload/message rate limits and graceful shutdown. It
  imports the esbuild bundle produced by `scripts/build-relay.mjs`, so there is
  no duplicated engine.

## 7. UI

- `SoloGame` and `OnlineSession` adapt engine/network state to Svelte stores.
  They own timers and connections, not rules.
- `GameView` composes three regions: equation console, canvas arena, match info.
  It derives the acting human (supporting local hot-seat), the editable grapher,
  cooldown state and disabled reason.
- `GraphCanvas` is a single canvas renderer: grid/axes, cover sections, grapher
  markers and hit zones, attack history, preview, effects, pan/zoom, keyboard
  and placement clicks. `ResizeObserver` keeps one world unit square; DPR is
  handled without changing world coordinates.
- `EquationEditor` debounces validation, shows positional issues, root counts,
  shared Spray budget, arc fields and templates, and calls the same
  `prepareAttack` as the engine.
- `MatchSettings`, `LoadoutEditor`, `PlacementBoard`, `PlaneRotation` and
  `OnlineLobby` make every rule reachable; settings are always a structured
  `GameRules` object, never loose component variables.
- Preferences (motion, hit zones, history depth, grid, name, default config) are
  browser-local; match rules are never silently changed by preferences.

## 8. Extending

### Add a grapher type

1. Add its id to `GrapherType` and a `GrapherTypeDefinition` entry in
   `DEFAULT_GRAPHER_TYPES` (mode, roots, span, damage, input hint, any arc
   limits).
2. Add it to `GRAPHER_TYPE_ORDER` and the colour/glyph maps in `ui/theme.ts`.
3. If it uses a new attack mode, extend `AttackComponentInput`, `prepareAttack`
   and `traceAttack`. Existing modes need no per-grapher conditionals.
4. The editor, loadout, CPU candidate generator, validator, authoritative room
   and HUD read the registry automatically. No per-type branches should be
   needed.

### Add a game mode

- Add a `SchedulingMode` branch in `turn-scheduler.ts` and `createTurnState`;
  the rest of the match flow consumes `activePlayerIds`, `actedPlayerIds`,
  `endsAt` and `batchNumber`.
- Replace or parameterise `win-conditions.ts` for timed/score-limited modes.
- Reuse `MatchRules`, `submitAttack`, maths, rendering and the protocol.

### Change balance

Edit `DEFAULT_RULES` / `DEFAULT_GRAPHER_TYPES`, or expose the value in
`MatchSettings`; validation ranges live in `LIMITS`. One value propagates to
validator, CPU, renderer and relay.

## 9. Performance

- Geometry is cached by attack/expression identity in the canvas; camera changes
  do not resample maths.
- Sampling is bounded by `maxSamples`; parse results use a 256-entry cache.
- Cover uses a uniform grid broadphase; target distance tests only inspect live
  enemy graphers.
- Snapshots are sent on revision change (plus a 2 s keepalive) and do not include
  sampled world geometry; clients reconstruct curves from validated expressions
  and authoritative positions.
- Canvas draws at device pixel ratio; no per-point DOM nodes exist.
- Event log is capped at 1200 entries; FFA recent submissions are capped at 40
  per player.

Maximum supported size is 10 players × 20 graphers = 200 graphers; tests cover
large setups.

## 10. Security

- No `eval`/`new Function`; allowlisted grammar and bounded complexity.
- Input length, AST, sampling and root budgets; malformed input yields issues.
- Server-side validation of every action, cooldowns, timers, scores and damage.
- 96 KiB message cap, 60 messages/10 s per socket, FFA submission limits.
- Imported config is fully validated; unknown grapher ids and invalid ranges are
  rejected rather than trusted.
- Names are sanitised to 20 printable characters. Resume tokens are random and
  namespaced per room; no secrets are shipped to the browser.
- The relay is a separate process; the static frontend does not claim to provide
  authority.
