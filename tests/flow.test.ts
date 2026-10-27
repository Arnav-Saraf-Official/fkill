import { describe, expect, it } from 'vitest';
import { createMatch, passTurn, removePlayer, submitAttack, tick } from '$lib/game/state';
import { evaluateOutcome } from '$lib/game/win-conditions';
import type { Grapher, Player } from '$lib/game/types';
import { createSoloConfig, createSetup } from '$lib/game/defaults';
import { makeDuel, makeRules, fire, fn, T0 } from './helpers';

describe('complete match flow', () => {
	it('plays a full 1v1 to a winner and a results-ready state', () => {
		const { state } = makeDuel({ posB: [{ x: 0, y: 2 }] });
		const result = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 500);
		expect(result.ok).toBe(true);
		expect(result.state.phase).toBe('finished');
		expect(result.state.winnerIds).toEqual(['p1']);
		expect(result.state.stats.finishedAt).toBe(T0 + 500);
		const winner = result.state.players.find((p) => p.id === 'p1')!;
		const loser = result.state.players.find((p) => p.id === 'p2')!;
		expect(winner.score).toBeGreaterThan(0);
		expect(winner.graphersDestroyed).toBe(1);
		expect(loser.alive).toBe(false);
		expect(result.state.graphers.find((g) => g.id === 'g_p2_0')?.alive).toBe(false);
		expect(result.state.events.some((e) => e.type === 'match-finished')).toBe(true);
		expect(result.state.events.some((e) => e.type === 'grapher-destroyed')).toBe(true);
		// No further attacks after the terminal state.
		const after = fire(result.state, 'p1', 'g_p1_0', [fn('2')], T0 + 1000);
		expect(after.ok).toBe(false);
		expect(after.error?.code).toBe('match-finished');
	});

	it('rejects an attack from the wrong player without consuming the turn', () => {
		const { state } = makeDuel({ rules: { grapherHealth: 20 }, posB: [{ x: 0, y: 2 }] });
		const wrong = fire(state, 'p2', 'g_p2_0', [fn('2')], T0 + 100);
		expect(wrong.ok).toBe(false);
		expect(wrong.error?.code).toBe('not-your-turn');
		const right = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 200);
		expect(right.ok).toBe(true);
		expect(right.state.turn.activePlayerIds).toEqual(['p2']);
		const again = fire(right.state, 'p1', 'g_p1_0', [fn('2')], T0 + 300);
		expect(again.ok).toBe(false);
	});

	it('does not consume a turn when the equation is invalid', () => {
		const { state } = makeDuel({ posB: [{ x: 0, y: 2 }] });
		const invalid = fire(state, 'p1', 'g_p1_0', [fn('sin(x)')], T0 + 100);
		expect(invalid.ok).toBe(false);
		expect(invalid.error?.code).toBe('invalid-attack');
		expect(invalid.error?.componentErrors?.length).toBeGreaterThan(0);
		expect(invalid.state.turn.activePlayerIds).toEqual(['p1']);
		expect(invalid.state.turn.actedPlayerIds).toEqual([]);
		expect(invalid.state.events.some((e) => e.type === 'attack-rejected')).toBe(true);
		const valid = fire(invalid.state, 'p1', 'g_p1_0', [fn('2')], T0 + 200);
		expect(valid.ok).toBe(true);
	});

	it('advances the batch when the timer expires', () => {
		const { state } = makeDuel();
		expect(state.turn.activePlayerIds).toEqual(['p1']);
		const unchanged = tick(state, T0 + 1_000);
		expect(unchanged).toBe(state);
		const advanced = tick(state, T0 + 60_000);
		expect(advanced).not.toBe(state);
		expect(advanced.turn.activePlayerIds).toEqual(['p2']);
		expect(advanced.turn.batchNumber).toBe(2);
		expect(advanced.events.some((e) => e.type === 'turn-ended')).toBe(true);
		expect(submitAttack(state, { type: 'submit-attack', playerId: 'p1', grapherId: 'g_p1_0', components: [fn('2')] }, T0 + 60_001).error?.code).toBe('turn-ended');
	});

	it('supports passing a turn', () => {
		const { state } = makeDuel();
		const passed = passTurn(state, 'p1', T0 + 100);
		expect(passed.ok).toBe(true);
		expect(passed.state.turn.activePlayerIds).toEqual(['p2']);
		expect(passed.state.turn.actedPlayerIds).toEqual([]);
		expect(passTurn(passed.state, 'p1', T0 + 200).ok).toBe(false);
		expect(passTurn(state, 'p2', T0 + 100).ok).toBe(false);
	});
});

describe('grapher cooldowns and selection', () => {
	it('puts only the fired grapher on cooldown and respects expiry', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20, turns: { mode: 'ffa' }, cooldownMultiplier: 1 },
			loadoutA: ['basic', 'basic'],
			posA: [
				{ x: -15, y: 0 },
				{ x: -15, y: 5 }
			],
			posB: [{ x: 0, y: 2 }]
		});
		const first = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 1000);
		expect(first.ok).toBe(true);
		expect(first.state.graphers.find((g) => g.id === 'g_p1_0')?.cooldownUntil).toBe(T0 + 6000);
		expect(first.state.graphers.find((g) => g.id === 'g_p1_1')?.cooldownUntil).toBeNull();

		const blocked = fire(first.state, 'p1', 'g_p1_0', [fn('2')], T0 + 2000);
		expect(blocked.ok).toBe(false);
		expect(blocked.error?.code).toBe('grapher-unavailable');
		expect(blocked.error?.message).toMatch(/cooling down/i);

		const otherGrapher = fire(first.state, 'p1', 'g_p1_1', [fn('2')], T0 + 2000);
		expect(otherGrapher.ok).toBe(true);

		const expired = fire(first.state, 'p1', 'g_p1_0', [fn('2')], T0 + 6000);
		expect(expired.ok).toBe(true);
	});

	it('disables cooldowns when the multiplier is 0', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20, turns: { mode: 'ffa' }, cooldownMultiplier: 0 },
			posB: [{ x: 0, y: 2 }]
		});
		const first = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 1000);
		expect(first.ok).toBe(true);
		expect(first.state.graphers[0].cooldownUntil).toBeNull();
		expect(fire(first.state, 'p1', 'g_p1_0', [fn('2')], T0 + 1500).ok).toBe(true);
	});

	it('auto-selects graphers round-robin and ignores cooldown settings', () => {
		const { state } = makeDuel({
			rules: {
				grapherHealth: 20,
				turns: { mode: 'ffa' },
				selection: 'auto-round-robin',
				cooldownMultiplier: 5
			},
			loadoutA: ['basic', 'basic'],
			posA: [
				{ x: -15, y: 0 },
				{ x: -15, y: 5 }
			],
			posB: [{ x: 0, y: 2 }]
		});
		const first = fire(state, 'p1', undefined, [fn('2')], T0 + 1000);
		expect(first.ok).toBe(true);
		expect(first.attack?.grapherId).toBe('g_p1_0');
		expect(first.state.graphers.every((g) => g.cooldownUntil === null)).toBe(true);
		const second = fire(first.state, 'p1', undefined, [fn('2')], T0 + 2000);
		expect(second.attack?.grapherId).toBe('g_p1_1');
		const third = fire(second.state, 'p1', undefined, [fn('2')], T0 + 3000);
		expect(third.attack?.grapherId).toBe('g_p1_0');
	});

	it('rejects another player\'s grapher id and unknown graphers', () => {
		const { state } = makeDuel({ posB: [{ x: 0, y: 2 }] });
		const wrong = fire(state, 'p1', 'g_p2_0', [fn('2')], T0 + 100);
		expect(wrong.ok).toBe(false);
		expect(wrong.error?.code).toBe('unknown-grapher');
		const missing = fire(state, 'p1', 'nope', [fn('2')], T0 + 100);
		expect(missing.ok).toBe(false);
		expect(missing.error?.code).toBe('unknown-grapher');
	});
});

describe('free-for-all', () => {
	it('lets both players act concurrently with no turn timer', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20, turns: { mode: 'ffa' }, cooldownMultiplier: 0 },
			posB: [{ x: 0, y: 2 }]
		});
		expect(state.turn.endsAt).toBeNull();
		const a = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 1000);
		expect(a.ok).toBe(true);
		const b = submitAttack(
			a.state,
			{ type: 'submit-attack', playerId: 'p2', grapherId: 'g_p2_0', components: [fn('2')] },
			T0 + 1100
		);
		expect(b.ok).toBe(true);
		expect(passTurn(a.state, 'p1', T0 + 1200).error?.code).toBe('bad-action');
	});

	it('applies flood protection to rapid submissions', () => {
		const { state } = makeDuel({
			rules: { grapherHealth: 20, turns: { mode: 'ffa' }, cooldownMultiplier: 0 },
			posB: [{ x: 0, y: 2 }]
		});
		const first = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 1000);
		expect(first.ok).toBe(true);
		const tooFast = fire(first.state, 'p1', 'g_p1_0', [fn('2')], T0 + 1100);
		expect(tooFast.ok).toBe(false);
		expect(tooFast.error?.code).toBe('rate-limited');
		const later = fire(first.state, 'p1', 'g_p1_0', [fn('2')], T0 + 1400);
		expect(later.ok).toBe(true);
	});
});

describe('elimination, disconnection and results', () => {
	it('uses the sniper damage and health rules together', () => {
		const { state } = makeDuel({
			rules: {
				grapherHealth: 20,
				turns: { mode: 'ffa' },
				cooldownMultiplier: 0,
				maxGraphersPerPlayer: 1
			},
			loadoutA: ['sniper'],
			posB: [{ x: 0, y: 2 }]
		});
		const first = fire(state, 'p1', 'g_p1_0', [fn('2')], T0 + 1000);
		expect(first.ok).toBe(true);
		expect(first.attack?.totalDamage).toBe(10);
		expect(first.state.graphers.find((g) => g.id === 'g_p2_0')?.health).toBe(10);
		const second = fire(first.state, 'p1', 'g_p1_0', [fn('2')], T0 + 2000);
		expect(second.ok).toBe(true);
		expect(second.state.graphers.find((g) => g.id === 'g_p2_0')?.health).toBe(0);
		expect(second.state.phase).toBe('finished');
		expect(second.state.winnerIds).toEqual(['p1']);
	});

	it('removes a leaving player and resolves the match', () => {
		const { state } = makeDuel();
		const next = removePlayer(state, 'p2', T0 + 500);
		expect(next.players.find((p) => p.id === 'p2')?.alive).toBe(false);
		expect(next.graphers.filter((g) => g.ownerId === 'p2').every((g) => !g.alive)).toBe(true);
		expect(next.phase).toBe('finished');
		expect(next.winnerIds).toEqual(['p1']);
		expect(next.events.some((e) => e.type === 'player-left')).toBe(true);
	});

	it('skips a disconnected player\'s turn', () => {
		const { state } = makeDuel();
		const disconnected = structuredClone(state);
		disconnected.players.find((p) => p.id === 'p1')!.connected = false;
		const next = tick(disconnected, T0 + 100);
		expect(next.turn.activePlayerIds).toEqual(['p2']);
	});

	it('breaks ties deterministically by health then score', () => {
		const players: Player[] = [
			{
				id: 'a',
				name: 'A',
				kind: 'human',
				colorIndex: 0,
				score: 10,
				hits: 0,
				shots: 0,
				damageDealt: 0,
				graphersDestroyed: 0,
				obstacleSectionsDestroyed: 0,
				alive: false,
				connected: true
			},
			{
				id: 'b',
				name: 'B',
				kind: 'human',
				colorIndex: 1,
				score: 30,
				hits: 0,
				shots: 0,
				damageDealt: 0,
				graphersDestroyed: 0,
				obstacleSectionsDestroyed: 0,
				alive: false,
				connected: true
			}
		];
		const graphers: Grapher[] = [];
		const outcome = evaluateOutcome(players, graphers);
		expect(outcome.finished).toBe(true);
		expect(outcome.winnerIds).toEqual(['b']);
		expect(outcome.reason).toBe('tiebreak');
	});

	it('creates a 10-player match with mixed human and CPU players', () => {
		const rules = makeRules({ maxGraphersPerPlayer: 3 });
		const setup = createSetup(rules, { humanCount: 4, cpuCount: 6, loadout: ['basic', 'sniper', 'arc'] });
		const state = createMatch({ rules, setup }, T0);
		expect(state.players.length).toBe(10);
		expect(state.graphers.length).toBe(30);
		expect(state.turn.activePlayerIds.length).toBe(1);
	});

	it('respects the solo configuration defaults', () => {
		const config = createSoloConfig();
		const state = createMatch(config, T0);
		expect(state.players.length).toBe(2);
		expect(state.players.some((p) => p.kind === 'cpu')).toBe(true);
		expect(state.rules.grapherHealth).toBe(1);
	});
});
