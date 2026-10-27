import { describe, expect, it } from 'vitest';
import { createMatch, passTurn, submitAttack, tick } from '$lib/game/state';
import { createRng } from '$lib/game/rng';
import { perceivedTargets } from '$lib/cpu/candidate-generator';
import { planCpuAttack } from '$lib/cpu/planner';
import { DIFFICULTY_PROFILES } from '$lib/cpu/difficulty';
import type { CpuDifficulty, GameRules, MatchConfig, MatchState } from '$lib/game/types';
import { makeRules, T0 } from './helpers';
import type { DeepPartial } from '$lib/game/defaults';

function cpuDuel(
	difficulty: CpuDifficulty,
	overrides: DeepPartial<GameRules> = {},
	seed = 'cpu-seed',
	loadout: 'sniper' | 'basic' = 'sniper'
): MatchState {
	const patch: DeepPartial<GameRules> = {
		grapherHealth: 1,
		maxGraphersPerPlayer: 2,
		placement: { mode: 'manual', distribution: 'min-separation', minSeparation: 6 },
		...overrides
	};
	const rules = makeRules(patch);
	const config: MatchConfig = {
		rules,
		setup: {
			seed,
			players: [
				{
					id: 'p1',
					name: 'CPU One',
					kind: 'cpu',
					colorIndex: 0,
					cpuDifficulty: difficulty,
					loadout: [loadout]
				},
				{
					id: 'p2',
					name: 'CPU Two',
					kind: 'cpu',
					colorIndex: 1,
					cpuDifficulty: difficulty,
					loadout: [loadout]
				}
			],
			manualPlacements: {
				p1: [{ x: -12, y: 0 }],
				p2: [{ x: 8, y: 6 }]
			}
		}
	};
	return createMatch(config, T0);
}

describe('CPU planner', () => {
	it('only acts on its own turn and only for CPU players', () => {
		const state = cpuDuel('asian');
		expect(planCpuAttack(state, 'p2', T0 + 100)).toBeNull();
		expect(planCpuAttack(state, 'p1', T0 + 100)).not.toBeNull();
		expect(planCpuAttack(state, 'nope', T0 + 100)).toBeNull();
	});

	it('returns legal actions that the engine accepts', () => {
		const state = cpuDuel('asian');
		const plan = planCpuAttack(state, 'p1', T0 + 100);
		expect(plan).toBeTruthy();
		const result = submitAttack(state, plan!.action, T0 + 100);
		expect(result.ok).toBe(true);
		expect(result.attack).toBeTruthy();
	});

	it('is deterministic for identical state and time', () => {
		const state = cpuDuel('sharp');
		const a = planCpuAttack(state, 'p1', T0 + 100);
		const b = planCpuAttack(state, 'p1', T0 + 100);
		expect(a?.action.components).toEqual(b?.action.components);
		expect(a?.score.value).toBe(b?.score.value);
	});

	it('the top tier lands a hit on a visible, unobstructed target', () => {
		const state = cpuDuel('asian');
		const plan = planCpuAttack(state, 'p1', T0 + 100);
		expect(plan).toBeTruthy();
		const result = submitAttack(state, plan!.action, T0 + 100);
		expect(result.attack?.targetsHit).toBeGreaterThan(0);
		expect(result.state.graphers.find((g) => g.id === 'g_p2_0')?.health).toBe(0);
	});

	it('higher tiers spend a larger search budget', () => {
		expect(DIFFICULTY_PROFILES.easy.candidateBudget).toBeLessThan(
			DIFFICULTY_PROFILES.sharp.candidateBudget
		);
		expect(DIFFICULTY_PROFILES.sharp.candidateBudget).toBeLessThan(
			DIFFICULTY_PROFILES.asian.candidateBudget
		);
		expect(DIFFICULTY_PROFILES.asian.aimJitter).toBe(0);
		expect(DIFFICULTY_PROFILES.easy.aimJitter).toBeGreaterThan(1);
	});

	it('difficulty changes real accuracy across seeds', () => {
		let easyHits = 0;
		let asianHits = 0;
		const runs = 16;
		for (let i = 0; i < runs; i++) {
			const easyState = cpuDuel('easy', {}, `seed-${i}`);
			const easyPlan = planCpuAttack(easyState, 'p1', T0 + 100);
			if (easyPlan) {
				const easyResult = submitAttack(easyState, easyPlan.action, T0 + 100);
				if ((easyResult.attack?.targetsHit ?? 0) > 0) easyHits++;
			}
			const asianState = cpuDuel('asian', {}, `seed-${i}`);
			const asianPlan = planCpuAttack(asianState, 'p1', T0 + 100);
			if (asianPlan) {
				const asianResult = submitAttack(asianState, asianPlan.action, T0 + 100);
				if ((asianResult.attack?.targetsHit ?? 0) > 0) asianHits++;
			}
		}
		expect(asianHits).toBe(runs);
		expect(easyHits).toBeLessThan(asianHits);
	});

	it('respects cooldowns in manual selection mode', () => {
		const state = cpuDuel('asian', { turns: { mode: 'ffa' }, cooldownMultiplier: 1, grapherHealth: 20 });
		const plan = planCpuAttack(state, 'p1', T0 + 100);
		expect(plan).toBeTruthy();
		const fired = submitAttack(state, plan!.action, T0 + 100);
		expect(fired.ok).toBe(true);
		expect(planCpuAttack(fired.state, 'p1', T0 + 1000)).toBeNull();
		const later = planCpuAttack(fired.state, 'p1', T0 + 100 + 6000);
		expect(later).not.toBeNull();
	});

	it('sees only public positions when coordinates are hidden', () => {
		const state = cpuDuel('asian', {
			precision: { denominator: 8, showCoordinates: false },
			coordinates: {
				mode: 'shared',
				allowRotation: false,
				showAxes: true,
				showGrid: true,
				gridSpacing: 2,
				labels: true
			}
		});
		const grapher = state.graphers.find((g) => g.id === 'g_p1_0')!;
		const perceived = perceivedTargets(state, 'p1', grapher);
		const target = perceived.find((t) => t.id === 'g_p2_0')!;
		// Manual placements are snapped to 1/8; the visible grid is 2 units, so
		// the perceived marker must sit on a multiple of 2, not at the true point.
		expect(Math.abs(target.position.x % 2)).toBeLessThan(1e-9);
		expect(Math.abs(target.position.y % 2)).toBeLessThan(1e-9);
		expect(target.position.x).toBe(8);
		expect(target.position.y).toBe(6);
	});

	it('returns null when there are no legal targets in range', () => {
		const rules = makeRules({
			placement: { mode: 'manual', distribution: 'min-separation', minSeparation: 6 },
			maxGraphersPerPlayer: 1,
			coordinates: {
				mode: 'local',
				allowRotation: false,
				showAxes: true,
				showGrid: true,
				gridSpacing: 1,
				labels: true
			}
		});
		const config: MatchConfig = {
			rules,
			setup: {
				seed: 'out-of-range',
				players: [
					{ id: 'p1', name: 'A', kind: 'cpu', colorIndex: 0, cpuDifficulty: 'asian', loadout: ['basic'] },
					{ id: 'p2', name: 'B', kind: 'cpu', colorIndex: 1, cpuDifficulty: 'asian', loadout: ['basic'] }
				],
				manualPlacements: { p1: [{ x: -20, y: 0 }], p2: [{ x: 20, y: 0 }] }
			}
		};
		const state = createMatch(config, T0);
		expect(planCpuAttack(state, 'p1', T0 + 100)).toBeNull();
	});

	it('plays a complete CPU-vs-CPU match to a winner', () => {
		let state = cpuDuel('sharp', {}, 'full-match');
		let actions = 0;
		let now = T0;
		while (state.phase === 'running' && actions < 80) {
			now += 500;
			state = tick(state, now);
			if (state.phase !== 'running') break;
			const active = state.turn.activePlayerIds;
			for (const playerId of active) {
				if (state.phase !== 'running') break;
				const plan = planCpuAttack(state, playerId, now);
				if (plan) {
					const result = submitAttack(state, plan.action, now);
					if (result.ok) {
						state = result.state;
						actions++;
					} else {
						const passed = passTurn(state, playerId, now);
						if (passed.ok) state = passed.state;
					}
				} else {
					const passed = passTurn(state, playerId, now);
					if (passed.ok) state = passed.state;
				}
			}
		}
		expect(state.phase).toBe('finished');
		expect(state.winnerIds.length).toBeGreaterThan(0);
		expect(state.stats.attacks).toBeGreaterThan(0);
	});

	it('never produces an illegal action across all difficulty tiers', () => {
		for (const id of Object.keys(DIFFICULTY_PROFILES) as CpuDifficulty[]) {
			const state = cpuDuel(id, {}, `tier-${id}`, 'basic');
			const plan = planCpuAttack(state, 'p1', T0 + 100);
			if (!plan) continue;
			const result = submitAttack(state, plan.action, T0 + 100);
			expect(result.ok, `${id} produced an illegal action: ${result.error?.message}`).toBe(true);
		}
	});

	it('uses the seeded rng deterministically in perceived target ranking', () => {
		const state = cpuDuel('asian');
		const grapher = state.graphers[0];
		const targets = perceivedTargets(state, 'p1', grapher);
		const a = createRng('rank').shuffle(targets.map((t) => t.id));
		const b = createRng('rank').shuffle(targets.map((t) => t.id));
		expect(a).toEqual(b);
	});
});
