import { describe, expect, it } from 'vitest';
import { prepareAttack } from '$lib/math/validation';
import { frameForGrapher, WORLD_FRAME } from '$lib/math/transforms';
import { buildObstacle } from '$lib/game/obstacles';
import { computePrecisionScore } from '$lib/game/scoring';
import type { Grapher } from '$lib/game/types';
import { makeDuel, makeRules, fire, fn, arc, T0 } from './helpers';

function grapherAt(x: number, y: number, rotation = 0): Grapher {
	return {
		id: 'g',
		ownerId: 'p1',
		type: 'basic',
		position: { x, y },
		rotation,
		health: 1,
		maxHealth: 1,
		alive: true,
		cooldownUntil: null
	};
}

describe('attack validation', () => {
	it('accepts a legal Basic function and reports its roots', () => {
		const rules = makeRules();
		const result = prepareAttack(rules, 'basic', WORLD_FRAME, [fn('x^2 - 4')]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.rootCountTotal).toBe(2);
			expect(result.components[0].world.length).toBeGreaterThan(0);
		}
	});

	it('rejects a Basic function with too many roots', () => {
		const rules = makeRules();
		const result = prepareAttack(rules, 'basic', WORLD_FRAME, [fn('sin(x)')]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.issues[0].message).toMatch(/too many roots/i);
	});

	it('enforces each grapher root limit', () => {
		const rules = makeRules();
		// 9 roots in [-15,15] is fine for Buzzer (30), not for Basic (5) or Sniper (3)
		expect(prepareAttack(rules, 'buzzer', WORLD_FRAME, [fn('sin(x)')]).ok).toBe(true);
		expect(prepareAttack(rules, 'sniper', WORLD_FRAME, [fn('sin(x)')]).ok).toBe(false);
		expect(prepareAttack(rules, 'sniper', WORLD_FRAME, [fn('x^2 - 4')]).ok).toBe(true);
	});

	it('applies the safety root-count cap to a larger custom budget', () => {
		const rules = makeRules({ grapherTypes: { basic: { maxRoots: 200 } }, limits: { maxRootsToCount: 5 } });
		expect(
			prepareAttack(rules, 'basic', WORLD_FRAME, [fn('(x-1)*(x-2)*(x-3)*(x-4)*(x-5)')]).ok
		).toBe(true);
		const six = prepareAttack(rules, 'basic', WORLD_FRAME, [
			fn('(x-1)*(x-2)*(x-3)*(x-4)*(x-5)*(x-6)')
		]);
		expect(six.ok).toBe(false);
		if (!six.ok) expect(six.issues[0].message).toMatch(/safety count limit/i);
	});

	it('accepts exactly the root budget and rejects one over', () => {
		const rules = makeRules();
		// (x-1)(x-2)(x-3)(x-4)(x-5) has 5 roots
		const exactlyFive = prepareAttack(rules, 'basic', WORLD_FRAME, [
			fn('(x-1)*(x-2)*(x-3)*(x-4)*(x-5)')
		]);
		expect(exactlyFive.ok).toBe(true);
		const six = prepareAttack(rules, 'basic', WORLD_FRAME, [
			fn('(x-1)*(x-2)*(x-3)*(x-4)*(x-5)*(x-6)')
		]);
		expect(six.ok).toBe(false);
	});

	it('validates Spray functions independently and enforces the shared budget', () => {
		const rules = makeRules();
		const three = (a: string, b: string, c: string) =>
			prepareAttack(rules, 'spray', WORLD_FRAME, [fn(a), fn(b), fn(c)]);

		// roots 4, 3, 3 = 10 -> valid
		expect(three('x*(x-1)*(x-2)*(x-3)', 'x*(x-1)*(x-2)', 'x*(x-1)*(x-2)').ok).toBe(true);
		// roots 4, 4, 3 = 11 -> invalid
		const over = three('x*(x-1)*(x-2)*(x-3)', 'x*(x-1)*(x-2)*(x-3)', 'x*(x-1)*(x-2)');
		expect(over.ok).toBe(false);
		if (!over.ok) expect(over.issues.some((i) => /root budget/i.test(i.message))).toBe(true);
		// more than three functions -> invalid
		expect(
			prepareAttack(rules, 'spray', WORLD_FRAME, [
				fn('x'),
				fn('x-1'),
				fn('x-2'),
				fn('x-3')
			]).ok
		).toBe(false);
	});

	it('accepts a valid arc and rejects illegal radius, sweep and centre', () => {
		const rules = makeRules();
		expect(prepareAttack(rules, 'arc', WORLD_FRAME, [arc({ x: 0, y: 0 }, 5, 0, 90)]).ok).toBe(true);
		const radius = prepareAttack(rules, 'arc', WORLD_FRAME, [arc({ x: 0, y: 0 }, 26, 0, 90)]);
		expect(radius.ok).toBe(false);
		if (!radius.ok) expect(radius.issues[0].message).toMatch(/radius/i);
		const sweep = prepareAttack(rules, 'arc', WORLD_FRAME, [arc({ x: 0, y: 0 }, 5, 0, 181)]);
		expect(sweep.ok).toBe(false);
		if (!sweep.ok) expect(sweep.issues[0].message).toMatch(/sweep/i);
		const centre = prepareAttack(rules, 'arc', WORLD_FRAME, [arc({ x: 0, y: 0 }, 5, 0, 0)]);
		expect(centre.ok).toBe(false);
		expect(prepareAttack(rules, 'arc', WORLD_FRAME, [arc({ x: 40, y: 0 }, 5, 0, 90)]).ok).toBe(false);
		// wrong component kind for an arc grapher
		expect(prepareAttack(rules, 'arc', WORLD_FRAME, [fn('x')]).ok).toBe(false);
	});

	it('rejects curves that never enter the legal window', () => {
		const rules = makeRules();
		const result = prepareAttack(rules, 'basic', WORLD_FRAME, [fn('50')]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.issues[0].message).toMatch(/never enters|valid coordinate window/i);
	});

	it('clips geometry to the grapher range and plane but keeps visible parts hittable', () => {
		const rules = makeRules();
		const result = prepareAttack(rules, 'basic', WORLD_FRAME, [fn('x')]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const ys = result.components[0].world.flatMap((s) => s.map((p) => p.y));
			expect(Math.max(...ys)).toBeLessThanOrEqual(15 + 1e-9);
			expect(Math.min(...ys)).toBeGreaterThanOrEqual(-15 - 1e-9);
		}
	});

	it('reports parse errors with component indices', () => {
		const rules = makeRules();
		const result = prepareAttack(rules, 'spray', WORLD_FRAME, [fn('x'), fn('sin(')]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.issues[0].componentIndex).toBe(1);
	});

	it('honours a rotated local frame in world geometry', () => {
		const rules = makeRules({ coordinates: { mode: 'local', allowRotation: true } });
		const grapher = grapherAt(10, 0, Math.PI / 2);
		const frame = frameForGrapher(grapher, rules);
		const result = prepareAttack(rules, 'basic', frame, [fn('0.01')]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			// rotation is ignored unless allowed; here it is allowed, so y=0.01 maps to x≈10.01 (vertical)
			const xs = result.components[0].world.flatMap((s) => s.map((p) => p.x));
			expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.1);
		}
	});
});

describe('collision and damage', () => {
	it('hits a target dead-centre and awards the precision bonus', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20 },
			posA: [{ x: -15, y: 0 }],
			posB: [{ x: 0, y: 2 }]
		});
		const result = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 10);
		expect(result.ok).toBe(true);
		expect(result.attack?.targetsHit).toBe(1);
		const hit = result.attack?.components[0].targetsHit[0];
		expect(hit?.distance).toBeCloseTo(0, 6);
		expect(hit?.precisionRatio).toBeCloseTo(1, 6);
		expect(hit?.score).toBe(20);
		expect(result.state.graphers.find((g) => g.id === 'g_p2_0')?.health).toBe(19);
	});

	it('grazes the edge of the hit zone with a smaller score', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20 },
			posB: [{ x: 0, y: 2.9 }]
		});
		const result = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 10);
		const hit = result.attack?.components[0].targetsHit[0];
		expect(hit).toBeTruthy();
		// 2.9 is snapped to the 1/8 placement grid => 2.875, so d = 0.875
		expect(hit!.distance).toBeCloseTo(0.875, 6);
		expect(hit!.score).toBeLessThan(20);
		expect(hit!.score).toBeGreaterThan(10);
	});

	it('misses a target outside the hit radius', () => {
		const { state } = makeDuel({ posB: [{ x: 0, y: 4 }] });
		const result = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 10);
		expect(result.ok).toBe(true);
		expect(result.attack?.targetsHit).toBe(0);
		expect(result.attack?.components[0].outcome).toBe('miss');
	});

	it('hits multiple targets with one curve, each once', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20 },
			loadoutB: ['basic', 'basic'],
			posB: [
				{ x: -4, y: 2.2 },
				{ x: 4, y: 1.9 }
			]
		});
		const result = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 10);
		expect(result.attack?.targetsHit).toBe(2);
		expect(result.attack?.totalDamage).toBe(2);
	});

	it('damages a target at most once per component even when the curve crosses it repeatedly', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20 },
			loadoutA: ['buzzer'],
			posB: [{ x: 0, y: 1 }]
		});
		const result = fire(state, 'p1', 'g_p1_0', [fn('sin(x) + 1')], T0 + 10);
		expect(result.ok).toBe(true);
		expect(result.attack?.components[0].targetsHit.length).toBe(1);
		expect(result.state.graphers.find((g) => g.id === 'g_p2_0')?.health).toBe(18);
	});

	it('blocks shots behind an intact obstacle and damages only crossed sections', () => {
		const { state } = makeDuel({			rules: {
				grapherHealth: 20,
				obstacles: {
					durability: 5,
					sectionSize: 1
				}
			},
			posB: [{ x: 10, y: 0 }]
		});
		const wall = buildObstacle(
			'wall',
			{ kind: 'roundRect', x: -1, y: -4, width: 2, height: 8, cornerRadius: 0 },
			state.rules
		);
		state.obstacles = [wall];
		const result = fire(state, 'p1', 'g_p1_0', [fn('0.01')], T0 + 10);
		expect(result.ok).toBe(true);
		expect(result.attack?.targetsHit).toBe(0);
		expect(result.attack?.components[0].outcome).toBe('blocked');
		expect(result.state.graphers.find((g) => g.id === 'g_p2_0')?.health).toBe(20);
		const damaged = result.state.obstacles[0].sections.filter(
			(s) => s.durability < s.maxDurability
		);
		expect(damaged.length).toBeGreaterThan(0);
		expect(damaged.length).toBeLessThan(result.state.obstacles[0].sections.length);
		expect(result.state.players.find((p) => p.id === 'p1')?.obstacleSectionsDestroyed).toBe(0);
	});

	it('creates a gap when a section is destroyed, letting later attacks through', () => {
		const { state } = makeDuel({			rules: {
				grapherHealth: 20,
				obstacles: {
					durability: 1,
					sectionSize: 1
				},
				cooldownMultiplier: 0,
				turns: { mode: 'ffa' }
			},
			posB: [{ x: 10, y: 0 }]
		});
		const wall = buildObstacle(
			'wall',
			{ kind: 'roundRect', x: -1, y: -4, width: 2, height: 8, cornerRadius: 0 },
			state.rules
		);
		state.obstacles = [wall];
		const first = fire(state, 'p1', 'g_p1_0', [fn('0.01')], T0 + 10);
		expect(first.attack?.targetsHit).toBe(0);
		// The first shot destroyed the section it hit; the rest of the wall still stands.
		expect(first.attack?.components[0].obstaclesHit.some((h) => h.destroyed)).toBe(true);
		// Destroy the sections on the shot path (simulating repeated shots).
		for (const section of first.state.obstacles[0].sections) {
			if (section.center.y > -1 && section.center.y < 1) {
				section.destroyed = true;
				section.durability = 0;
			}
		}
		const second = fire(first.state, 'p1', 'g_p1_0', [fn('0.01')], T0 + 1000);
		expect(second.attack?.targetsHit).toBe(1);
	});

	it('respects the punch-through obstacle setting', () => {
		const { state } = makeDuel({			rules: {
				grapherHealth: 20,
				obstacles: {
					enabled: true,
					arrangement: 'scattered',
					count: 0,
					minSize: 3,
					maxSize: 4,
					durability: 5,
					indestructible: false,
					punchThrough: true,
					sectionSize: 1
				}
			},
			posB: [{ x: 10, y: 0 }]
		});
		const wall = buildObstacle(
			'wall',
			{ kind: 'roundRect', x: -1, y: -4, width: 2, height: 8, cornerRadius: 0 },
			state.rules
		);
		state.obstacles = [wall];
		const result = fire(state, 'p1', 'g_p1_0', [fn('0.01')], T0 + 10);
		expect(result.attack?.targetsHit).toBe(1);
		expect(result.attack?.components[0].obstaclesHit.length).toBeGreaterThan(0);
	});

	it('never damages indestructible obstacles', () => {
		const { state } = makeDuel({
			rules: {
				grapherHealth: 20,
				obstacles: {
					durability: 1,
					sectionSize: 1
				}
			}
		});
		const wall = buildObstacle('wall', { kind: 'roundRect', x: -1, y: -4, width: 2, height: 8, cornerRadius: 0 }, state.rules, true);
		state.obstacles = [wall];
		const result = fire(state, 'p1', 'g_p1_0', [fn('0.01')], T0 + 10);
		expect(result.attack?.targetsHit).toBe(0);
		expect(wall.sections.every((s) => !s.destroyed && s.durability === s.maxDurability)).toBe(true);
	});

	it('translates equations in local coordinate mode', () => {
		const { state } = makeDuel({
			rules: {
				grapherHealth: 20,
				coordinates: { mode: 'local', allowRotation: false } as never
			},
			posA: [{ x: -15, y: 0 }],
			posB: [{ x: -5, y: 2 }]
		});
		const result = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 10);
		expect(result.attack?.targetsHit).toBe(1);
	});

	it('applies local-plane rotation to the actual hit test', () => {
		const { state } = makeDuel({
			rules: {
				grapherHealth: 20,
				coordinates: { mode: 'local', allowRotation: true } as never
			},
			posA: [{ x: -15, y: 0 }],
			rotationsA: [Math.PI / 2],
			posB: [{ x: -15, y: 5 }]
		});
		const result = fire(state, 'p1', 'g_p1_0', [fn('0.01')], T0 + 10);
		expect(result.attack?.targetsHit).toBe(1);
		const hit = result.attack?.components[0].targetsHit[0];
		expect(hit?.distance).toBeCloseTo(0.01, 6);
	});

	it('does not hit an enemy when local rotation is disabled', () => {
		const { state } = makeDuel({
			rules: {
				grapherHealth: 20,
				coordinates: { mode: 'local', allowRotation: false } as never
			},
			posA: [{ x: -15, y: 0 }],
			rotationsA: [Math.PI / 2],
			posB: [{ x: -15, y: 5 }]
		});
		const result = fire(state, 'p1', 'g_p1_0', [fn('0.01')], T0 + 10);
		expect(result.attack?.targetsHit).toBe(0);
	});

	it('hits with a genuine circular arc', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20 },
			loadoutA: ['arc'],
			posB: [{ x: 5, y: 0 }]
		});
		const result = fire(state, 'p1', 'g_p1_0', [arc({ x: 0, y: 0 }, 5, 0, 180)], T0 + 10);
		expect(result.ok).toBe(true);
		expect(result.attack?.targetsHit).toBe(1);
		expect(result.attack?.components[0].targetsHit[0].distance).toBeCloseTo(0, 6);
	});

	it('does not hit points outside the arc sweep', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20 },
			loadoutA: ['arc'],
			posB: [{ x: 0, y: -5 }]
		});
		const result = fire(state, 'p1', 'g_p1_0', [arc({ x: 0, y: 0 }, 5, 0, 90)], T0 + 10);
		expect(result.attack?.targetsHit).toBe(0);
	});

	it('scores zero distance higher than a near-miss inside the zone', () => {
		const rules = makeRules();
		expect(computePrecisionScore(rules, 0, 1.1).score).toBe(20);
		expect(computePrecisionScore(rules, 1.1, 1.1).score).toBe(10);
		expect(computePrecisionScore(rules, 0.55, 1.1).score).toBe(15);
	});
});
