import { describe, expect, it } from 'vitest';
import {
	advanceBatch,
	createTurnState,
	currentBatchComplete,
	effectiveBatch,
	isPlayerOnTurn,
	markActed,
	turnTimerRemainingMs
} from '$lib/game/turn-scheduler';
import { createRng } from '$lib/game/rng';
import { makeRules } from './helpers';

const NOW = 1_000_000;
const PLAYERS = ['a', 'b', 'c', 'd'];

function turnFor(mode: 'round-robin' | 'random' | 'ffa', concurrent = 1, time = 60) {
	const rules = makeRules({
		turns: { mode, concurrentPlayers: concurrent, timePerTurnSeconds: time }
	});
	const rng = createRng('scheduler-seed');
	return { turn: createTurnState(rules, PLAYERS, NOW, rng), rules, rng };
}

describe('round-robin scheduling', () => {
	it('gives one player at a time, in order', () => {
		const { turn, rules, rng } = turnFor('round-robin');
		expect(turn.activePlayerIds).toEqual(['a']);
		expect(turn.endsAt).toBe(NOW + 60_000);
		for (const id of PLAYERS) {
			expect(turn.activePlayerIds).toEqual([id]);
			markActed(turn, id);
			expect(currentBatchComplete(turn, PLAYERS, NOW)).toBe(true);
			advanceBatch(turn, rules, PLAYERS, NOW, rng);
		}
		expect(turn.activePlayerIds).toEqual(['a']);
		expect(turn.batchNumber).toBe(5);
	});

	it('supports concurrent batches of X players', () => {
		const { turn, rules, rng } = turnFor('round-robin', 2);
		expect(turn.activePlayerIds).toEqual(['a', 'b']);
		markActed(turn, 'a');
		expect(currentBatchComplete(turn, PLAYERS, NOW)).toBe(false);
		markActed(turn, 'b');
		expect(currentBatchComplete(turn, PLAYERS, NOW)).toBe(true);
		advanceBatch(turn, rules, PLAYERS, NOW, rng);
		expect(turn.activePlayerIds).toEqual(['c', 'd']);
		advanceBatch(turn, rules, PLAYERS, NOW, rng);
		expect(turn.activePlayerIds).toEqual(['a', 'b']);
	});

	it('handles a partial last batch', () => {
		const { turn, rules, rng } = turnFor('round-robin', 3);
		expect(turn.activePlayerIds).toEqual(['a', 'b', 'c']);
		advanceBatch(turn, rules, PLAYERS, NOW, rng);
		expect(turn.activePlayerIds).toEqual(['d']);
	});

	it('skips eliminated players', () => {
		const { turn, rules, rng } = turnFor('round-robin', 2);
		advanceBatch(turn, rules, ['a', 'c', 'd'], NOW, rng);
		expect(turn.activePlayerIds.length).toBeGreaterThan(0);
		expect(turn.activePlayerIds).not.toContain('b');
		turn.activePlayerIds = ['b'];
		expect(effectiveBatch(turn, ['a', 'c', 'd'])).toEqual([]);
		expect(currentBatchComplete(turn, ['a', 'c', 'd'], NOW)).toBe(true);
	});

	it('treats a timeout as batch complete', () => {
		const { turn } = turnFor('round-robin', 1, 10);
		expect(currentBatchComplete(turn, PLAYERS, NOW + 9_999)).toBe(false);
		expect(currentBatchComplete(turn, PLAYERS, NOW + 10_000)).toBe(true);
		expect(turnTimerRemainingMs(turn, NOW + 3_000)).toBe(7_000);
	});
});

describe('random scheduling', () => {
	it('does not repeat a player within a cycle', () => {
		const { turn, rules, rng } = turnFor('random');
		const seen: string[] = [];
		for (let batch = 0; batch < 8; batch++) {
			const active = [...turn.activePlayerIds];
			expect(active.length).toBe(1);
			seen.push(active[0]);
			markActed(turn, active[0]);
			advanceBatch(turn, rules, PLAYERS, NOW, rng);
		}
		// Each block of four batches must be a permutation of the players.
		for (let cycle = 0; cycle < 2; cycle++) {
			const slice = seen.slice(cycle * 4, cycle * 4 + 4);
			expect(new Set(slice).size).toBe(4);
		}
	});

	it('never draws an eliminated player from the bag', () => {
		const { turn, rules, rng } = turnFor('random', 2);
		const alive = ['a', 'b'];
		advanceBatch(turn, rules, alive, NOW, rng);
		expect(effectiveBatch(turn, alive).every((id) => alive.includes(id))).toBe(true);
		advanceBatch(turn, rules, alive, NOW, rng);
		expect(turn.activePlayerIds.every((id) => alive.includes(id))).toBe(true);
	});

	it('is deterministic for a given seed', () => {
		const first = turnFor('random', 1);
		const second = turnFor('random', 1);
		for (let i = 0; i < 6; i++) {
			expect(first.turn.activePlayerIds).toEqual(second.turn.activePlayerIds);
			markActed(first.turn, first.turn.activePlayerIds[0]);
			markActed(second.turn, second.turn.activePlayerIds[0]);
			advanceBatch(first.turn, first.rules, PLAYERS, NOW, first.rng);
			advanceBatch(second.turn, second.rules, PLAYERS, NOW, second.rng);
		}
	});
});

describe('free-for-all scheduling', () => {
	it('has no batches and no timer', () => {
		const { turn } = turnFor('ffa', 1, 30);
		expect(turn.endsAt).toBeNull();
		expect(turn.activePlayerIds).toEqual(PLAYERS);
		expect(turnTimerRemainingMs(turn, NOW + 1_000_000)).toBeNull();
		expect(currentBatchComplete(turn, PLAYERS, NOW + 1_000_000)).toBe(false);
	});

	it('lets every alive player act', () => {
		const { turn } = turnFor('ffa');
		for (const id of PLAYERS) expect(isPlayerOnTurn(turn, PLAYERS, id)).toBe(true);
		expect(isPlayerOnTurn(turn, ['a', 'b'], 'c')).toBe(false);
	});
});
