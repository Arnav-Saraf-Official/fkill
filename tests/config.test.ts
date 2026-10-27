import { describe, expect, it } from 'vitest';
import {
	exportConfig,
	importConfig,
	validateMatchConfig,
	validateRules
} from '$lib/game/configuration';
import { PRESETS, createSetup, withRules, createSoloConfig } from '$lib/game/defaults';
import { DEFAULT_RULES, LIMITS } from '$lib/game/rules';
import { createRng } from '$lib/game/rng';
import { generatePlacements, prepareManualPlacements } from '$lib/game/placement';
import { createObstacles } from '$lib/game/obstacles';
import { createMatch } from '$lib/game/state';
import { makeDuel, makeRules, T0 } from './helpers';

describe('rules validation', () => {
	it('accepts the defaults', () => {
		const result = validateRules(DEFAULT_RULES);
		expect(result.ok).toBe(true);
	});

	it('accepts every preset and its setup', () => {
		for (const preset of PRESETS) {
			const result = validateMatchConfig(preset.build());
			expect(result.ok, `${preset.id}: ${!result.ok ? result.errors.join('; ') : ''}`).toBe(true);
		}
	});

	it('rejects out-of-range values with readable errors', () => {
		const bad = structuredClone(DEFAULT_RULES);
		bad.maxGraphersPerPlayer = 21;
		bad.grapherHealth = 0;
		bad.turns.timePerTurnSeconds = 3601;
		bad.precision.denominator = 65;
		bad.cooldownMultiplier = 6;
		const result = validateRules(bad);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.join('\n')).toMatch(/maxGraphersPerPlayer/);
			expect(result.errors.join('\n')).toMatch(/grapherHealth/);
			expect(result.errors.join('\n')).toMatch(/timePerTurnSeconds/);
		}
	});

	it('allows turn durations above the slider maximum and up to one hour', () => {
		const custom = withRules({ turns: { timePerTurnSeconds: 300 } });
		expect(validateRules(custom).ok).toBe(true);
		const maximum = withRules({ turns: { timePerTurnSeconds: LIMITS.turnSeconds.max } });
		expect(validateRules(maximum).ok).toBe(true);
		const tooLong = withRules({ turns: { timePerTurnSeconds: 3601 } });
		expect(validateRules(tooLong).ok).toBe(false);
	});

	it('rejects enabling obstacles with no arrangement', () => {
		const bad = withRules({ obstacles: { enabled: true, arrangement: 'none' } });
		const result = validateRules(bad);
		expect(result.ok).toBe(false);
	});

	it('rejects grapher type limits that do not make sense', () => {
		const bad = withRules({ grapherTypes: { arc: { maxArcRadius: 0 } } });
		const result = validateRules(bad);
		expect(result.ok).toBe(false);
	});

	it('rejects duplicate player colours and oversized loadouts', () => {
		const config = createSoloConfig();
		const bad = structuredClone(config);
		bad.setup.players[1].colorIndex = 0;
		expect(validateMatchConfig(bad).ok).toBe(false);

		const big = createSoloConfig();
		big.rules = withRules({ maxGraphersPerPlayer: 2 });
		big.setup.players[0].loadout = ['basic', 'basic', 'basic'];
		expect(validateMatchConfig(big).ok).toBe(false);
	});

	it('rejects unknown grapher types and missing players', () => {
		const config = createSoloConfig();
		const bad = structuredClone(config) as unknown as { setup: { players: { loadout: string[] }[] } };
		bad.setup.players[0].loadout = ['railgun'];
		expect(validateMatchConfig(bad).ok).toBe(false);

		const empty = createSoloConfig();
		empty.setup.players = empty.setup.players.slice(0, 1);
		expect(validateMatchConfig(empty).ok).toBe(false);
	});

	it('exports and re-imports a configuration losslessly', () => {
		const config = PRESETS[2].build();
		const json = exportConfig(config);
		const imported = importConfig(json);
		expect(imported.ok).toBe(true);
		if (imported.ok) {
			expect(imported.config.rules.obstacles).toEqual(config.rules.obstacles);
			expect(imported.config.setup.players).toEqual(config.setup.players);
		}
	});

	it('rejects invalid JSON and tampered values on import', () => {
		expect(importConfig('{not json').ok).toBe(false);
		const config = createSoloConfig();
		const parsed = JSON.parse(exportConfig(config));
		parsed.rules.grapherHealth = 999;
		expect(importConfig(JSON.stringify(parsed)).ok).toBe(false);
		parsed.rules.grapherHealth = 1;
		parsed.version = 99;
		expect(importConfig(JSON.stringify(parsed)).ok).toBe(false);
	});

	it('builds setups within the player and grapher caps', () => {
		const rules = makeRules({ maxGraphersPerPlayer: 3 });
		const setup = createSetup(rules, { humanCount: 3, cpuCount: 9 });
		expect(setup.players.length).toBe(10);
		expect(setup.players.every((p) => p.loadout.length <= 3)).toBe(true);
		expect(new Set(setup.players.map((p) => p.colorIndex)).size).toBe(10);
		expect(setup.players.filter((p) => p.kind === 'cpu').length).toBe(7);
	});

	it('keeps CPU difficulty identifiers distinct from labels', () => {
		const config = createSoloConfig({ cpuDifficulty: 'asian' });
		expect(config.setup.players[1].cpuDifficulty).toBe('asian');
	});
});

describe('placement', () => {
	it('generates legal, on-grid, non-overlapping positions', () => {
		const rules = makeRules({
			placement: { mode: 'auto', distribution: 'min-separation', minSeparation: 6 },
			maxGraphersPerPlayer: 4
		});
		const targets = [
			{ playerId: 'p1', count: 4 },
			{ playerId: 'p2', count: 4 }
		];
		const result = generatePlacements(rules, targets, [], createRng('place-seed'));
		const all = Object.values(result.positions).flat();
		expect(all.length).toBe(8);
		const step = 1 / rules.precision.denominator;
		for (const p of all) {
			expect(Math.abs(p.x)).toBeLessThanOrEqual(rules.worldSize / 2);
			expect(Math.abs(p.y)).toBeLessThanOrEqual(rules.worldSize / 2);
			expect(Math.abs(p.x / step - Math.round(p.x / step))).toBeLessThan(1e-6);
			expect(Math.abs(p.y / step - Math.round(p.y / step))).toBeLessThan(1e-6);
		}
		for (let i = 0; i < all.length; i++) {
			for (let j = i + 1; j < all.length; j++) {
				expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y)).toBeGreaterThanOrEqual(6);
			}
		}
	});

	it('is deterministic for a seed and differs across seeds', () => {
		const rules = makeRules();
		const targets = [{ playerId: 'p1', count: 5 }];
		const a = generatePlacements(rules, targets, [], createRng('seed-a'));
		const b = generatePlacements(rules, targets, [], createRng('seed-a'));
		const c = generatePlacements(rules, targets, [], createRng('seed-b'));
		expect(a.positions).toEqual(b.positions);
		expect(a.positions).not.toEqual(c.positions);
	});

	it('keeps generated graphers out of obstacles', () => {
		const rules = makeRules({
			obstacles: {
				enabled: true,
				arrangement: 'fortress',
				count: 6,
				minSize: 3,
				maxSize: 6,
				durability: 3,
				indestructible: false,
				punchThrough: false,
				sectionSize: 1.25
			},
			maxGraphersPerPlayer: 5
		});
		const obstacles = createObstacles(rules, 'obs-seed', createRng('obs-seed'));
		expect(obstacles.length).toBeGreaterThan(0);
		const result = generatePlacements(
			rules,
			[
				{ playerId: 'p1', count: 5 },
				{ playerId: 'p2', count: 5 }
			],
			obstacles,
			createRng('placement-seed')
		);
		const all = Object.values(result.positions).flat();
		for (const p of all) {
			for (const obstacle of obstacles) {
				const inside = obstacle.sections.some(
					(s) =>
						!s.destroyed &&
						Math.abs(p.x - s.center.x) <= s.size / 2 &&
						Math.abs(p.y - s.center.y) <= s.size / 2
				);
				expect(inside).toBe(false);
			}
		}
	});

	it('rejects overlapping manual placements', () => {
		const rules = makeRules();
		const config = makeDuel().config;
		config.setup.manualPlacements = { p1: [{ x: 0, y: 0 }], p2: [{ x: 0, y: 0 }] };
		Object.assign(config.rules, rules);
		const result = prepareManualPlacements(config.rules, config.setup, []);
		expect(result.ok).toBe(false);
	});

	it('falls back to generated placement when manual data is inconsistent', () => {
		const config = makeDuel().config;
		config.setup.manualPlacements = { p1: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
		const state = createMatch(config, T0);
		expect(state.graphers.length).toBe(2);
		expect(state.graphers.every((g) => Number.isFinite(g.position.x))).toBe(true);
	});
});
