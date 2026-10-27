# f(kill)

**Equation combat on a 50 × 50 coordinate plane.** You do not pick a weapon and
click a target — you write the curve that reaches it.

f(kill) is a complete browser game: a safe mathematical expression engine, a
deterministic combat engine, eight CPU difficulty tiers, five grapher types, a
canvas graphing arena, configurable match rules, and an authoritative WebSocket
relay for online rooms. Solo play runs entirely in the browser.

```text
y = 2*x + 3        one root, one clean line
y = x^2 - 4        two roots, a curve that can hit twice
arc(0, 0, 12, 0, 90)   a real circular arc, no root limit
```

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

Pick **Solo / setup**, choose a preset, review the roster and rules, then
**Start match**. Online play additionally needs the relay:

```bash
npm run relay        # builds and starts http://localhost:8787 (WebSocket /ws)
```

## What is implemented

- **Five grapher types**, all defined by one data registry: Basic (5 roots, span
  30), Buzzer (30 roots, span 25), Sniper (3 roots, span 50, 10 damage), Spray
  (up to 3 functions sharing a 10-root budget) and Arc (true circular arcs,
  radius ≤ 25, sweep ≤ 180°).
- **A real expression language** — allowlisted grammar, implicit
  multiplication, `x²`, `pi`, `e`, `tau`, trig, inverse trig, `sqrt`, `abs`,
  `exp`, `ln`, `log`. No `eval` and no arbitrary JavaScript.
- **Numerical root analysis** with sign-change bisection, tangent-root
  refinement, domain-boundary detection, asymptote rejection and strict work
  limits.
- **Adaptive geometry sampling** shared by preview, collision, rendering and
  CPU simulation. Discontinuities are not connected across asymptotes.
- **Deterministic attack resolution**: cover occludes the shot, locally
  destructible sections absorb damage, precision sets the score, and a
  destroyed section never opens a retroactive gap in the same resolution.
- **All requested match settings**: 1–20 graphers per player, 1–20 health,
  turn duration slider (max 120 s) plus typed durations up to one hour,
  Round Robin / Random / Free-for-All, concurrent turn batches, per-grapher
  cooldowns, manual and automatic selection, shared/local coordinate planes
  with rotation, manual/automatic placement, placement precision 1/5–1/64,
  hidden exact coordinates, grid spacing, obstacle controls and CPU difficulty.
- **Eight CPU tiers** (Easy → Asian) that change candidate budgets, aim error,
  target selection and obstacle awareness — never legality or information.
- **Online rooms** with room codes, ready states, host-locked rules, a separate
  authoritative relay, reconnect tokens and projected coordinates. The client
  never reports hits, damage or scores.
- **A polished graph-first UI** with an equation console, canvas arena and match
  panel, keyboard support, reduced-motion mode, responsive layout and
  colour-blind-conscious player identities (hue + glyph + line style).
- **Tests and quality gates**: 130 Vitest tests across maths, engine, settings,
  scheduling, CPU, flows and multiplayer; strict `svelte-check`; ESLint;
  production builds for static, Vercel and Cloudflare adapters.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` | production build with the default adapter |
| `npm run preview` | preview the build |
| `npm test` | run the full engine/unit/integration suite |
| `npm run check` | Svelte + TypeScript diagnostics (strict) |
| `npm run lint` | ESLint for TypeScript, Svelte and scripts |
| `npm run relay` | build and run the authoritative WebSocket relay |
| `npm run relay:smoke` | two real socket clients: create/join/ready/start/fire/reconnect |
| `npm run build:relay` | bundle the engine for the relay only |
| `npm run build:static` | SPA build in `build/` (Vercel/Cloudflare Pages static) |
| `npm run build:vercel` | Vercel adapter build |
| `npm run build:cloudflare` | Cloudflare adapter build |
| `npm run build:node` | Node adapter build |

## How to play

1. **Setup.** Choose a preset or edit rules, roster and loadouts. In manual
   placement mode, click the arena to place each grapher; it snaps to the
   configured 1/N grid. If local coordinates are enabled, set each grapher's
   plane rotation in degrees.
2. **Read the arena.** Each grapher is both a weapon and a target. Solid cover
   blocks a shot; sections are destroyed individually, creating gaps.
3. **Write an attack.** The console shows live syntax errors, root usage, the
   valid span and the damage of the selected type. `Ctrl`/`Cmd` + `Enter` fires.
   Spray lets you add up to three functions and tracks the shared budget.
4. **Resolve.** The engine traces the visible curve, finds the closest approach
   to each enemy hit zone, applies damage and precision score, damages cover,
   marks eliminations and advances the schedule.
5. **Win.** The last player with a surviving grapher wins. If everyone is
   destroyed in the same resolution, health then score then original player
   order break the tie.

Online: create a room, share the code or invite link, ready up, and the host
starts. Rules lock at start. A dropped connection can resume the same seat.

## Project layout

```text
src/
  routes/                 landing, /lobby, /play, /settings
  lib/
    components/
      graph/                canvas arena (grid, curves, cover, effects)
      equation-editor/      function and arc editor with live validation
      game/                 GameView composition
      lobby/                roster, loadout, placement, rotation, online lobby
      hud/                  turn panel, players, event feed, results
    game/                   types, rules registry, state machine, turns,
                            collision, scoring, obstacles, placement, presets
    math/                   parser, evaluator, roots, sampling, geometry,
                            validation, coordinate transforms
    cpu/                    8 difficulty profiles, candidates, evaluator, planner
    multiplayer/            protocol, rooms/authority, transport, reconnect
    ui/                     theme, stores, preferences
server/relay.mjs            Node WebSocket shell around the authoritative rooms
scripts/                    relay bundle, build helper, socket smoke test
tests/                      Vitest suites (130 tests)
docs/                       rules, architecture, deployment, configuration
```

## Documentation

- [Game rules](docs/GAME_RULES.md) — the actual mathematics and resolution order.
- [Architecture](docs/ARCHITECTURE.md) — module boundaries and extension points.
- [Configuration](docs/CONFIGURATION.md) — every rule value and its default.
- [Deployment](docs/DEPLOYMENT.md) — static/dynamic hosting, relay, adapters.

## Honest limitations

- Root counting is numerical. It is accurate for the supported expression
  language within documented resolution limits, but it is not symbolic
  algebra; extremely high-frequency curves near the sampling limit can be
  missed. The supported subset is documented in `docs/GAME_RULES.md`.
- Online play requires the separate relay process. A static frontend alone is
  explicitly **not** presented as multiplayer infrastructure. There is no
  account system: rooms use short codes, random ids and per-room resume tokens.
- The Vercel **adapter** build needs symlink support. On Windows without
  Developer Mode it fails with `EPERM`; use `npm run build:static` locally or
  build with the Vercel adapter on Linux/CI. This is a platform limitation, not
  a runtime requirement.
- CPUs evaluate only projected public information and submit through the same
  authoritative action path as humans. They cannot see hidden coordinates or
  bypass validation.
- Local hot-seat play supports several humans sharing one screen; the console
  follows the human whose turn it is. In FFA it follows the first surviving
  human, so simultaneous local humans should use online rooms instead.
