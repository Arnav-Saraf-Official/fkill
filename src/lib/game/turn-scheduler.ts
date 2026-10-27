/**
 * Turn scheduling.
 *
 * Round-robin and random scheduling both run as *batches*: `concurrentPlayers`
 * players receive turns at the same time. Batch order is generated without
 * replacement within a cycle, so random scheduling cannot starve a player while
 * repeatedly favouring another. The last batch is correctly partial when the
 * player count is not divisible by the batch size.
 *
 * FFA has no batches, no timer and no turn ownership: every alive player may act
 * at any time.
 */

import type { GameRules, TurnState } from './types';
import type { Rng } from './rng';

export function createTurnState(rules: GameRules, aliveIds: string[], now: number, rng: Rng): TurnState {
	if (rules.turns.mode === 'ffa') {
		return {
			mode: 'ffa',
			activePlayerIds: [...aliveIds],
			batchNumber: 1,
			batchStartedAt: now,
			endsAt: null,
			actedPlayerIds: [],
			bag: [],
			randomState: 0
		};
	}
	const ordered = rules.turns.mode === 'random' ? rng.shuffle(aliveIds) : [...aliveIds];
	const batch = ordered.slice(0, Math.max(1, rules.turns.concurrentPlayers));
	return {
		mode: rules.turns.mode,
		activePlayerIds: batch,
		batchNumber: 1,
		batchStartedAt: now,
		endsAt: now + rules.turns.timePerTurnSeconds * 1000,
		actedPlayerIds: [],
		bag: ordered.slice(batch.length),
		randomState: 0
	};
}

function drawBatch(
	turn: TurnState,
	rules: GameRules,
	aliveIds: string[],
	rng: Rng
): void {
	const alive = new Set(aliveIds);
	const size = Math.max(1, Math.min(rules.turns.concurrentPlayers, Math.max(1, aliveIds.length)));
	if (turn.bag.length === 0) {
		const cycle = rules.turns.mode === 'random' ? rng.shuffle(aliveIds) : aliveIds.slice();
		turn.bag = cycle;
		turn.randomState++;
	}
	// Drop entries for players who were eliminated after the cycle was drawn.
	turn.bag = turn.bag.filter((id) => alive.has(id));
	// A cycle is drawn without replacement and is *not* refilled mid-batch: the
	// last batch of a cycle is therefore legitimately smaller than `size`, and
	// the next cycle starts fresh on the following batch.
	const drawn: string[] = [];
	while (drawn.length < size && turn.bag.length > 0) {
		const id = turn.bag.shift();
		if (id && alive.has(id) && !drawn.includes(id)) drawn.push(id);
	}
	if (drawn.length === 0) {
		// Everyone drawn from the bag was eliminated; refill once and retry.
		const cycle = rules.turns.mode === 'random' ? rng.shuffle(aliveIds) : aliveIds.slice();
		turn.bag = cycle;
		turn.randomState++;
		while (drawn.length < size && turn.bag.length > 0) {
			const id = turn.bag.shift();
			if (id && alive.has(id) && !drawn.includes(id)) drawn.push(id);
		}
	}
	turn.activePlayerIds = drawn;
}

export function advanceBatch(
	turn: TurnState,
	rules: GameRules,
	aliveIds: string[],
	now: number,
	rng: Rng
): void {
	if (rules.turns.mode === 'ffa') {
		turn.activePlayerIds = [...aliveIds];
		turn.endsAt = null;
		turn.actedPlayerIds = [];
		return;
	}
	turn.batchNumber++;
	turn.batchStartedAt = now;
	turn.endsAt = now + rules.turns.timePerTurnSeconds * 1000;
	turn.actedPlayerIds = [];
	drawBatch(turn, rules, aliveIds, rng);
}

/** Active players who are still alive (activePlayerIds is kept pruned too). */
export function effectiveBatch(turn: TurnState, aliveIds: string[]): string[] {
	const alive = new Set(aliveIds);
	return turn.activePlayerIds.filter((id) => alive.has(id));
}

export function currentBatchComplete(turn: TurnState, aliveIds: string[], now: number): boolean {
	if (turn.mode === 'ffa') return false;
	const alive = new Set(aliveIds);
	if (alive.size === 0) return true;
	const active = effectiveBatch(turn, aliveIds);
	if (active.length === 0) return true;
	if (active.every((id) => turn.actedPlayerIds.includes(id))) return true;
	if (turn.endsAt !== null && now >= turn.endsAt) return true;
	return false;
}

export function isPlayerOnTurn(turn: TurnState, aliveIds: string[], playerId: string): boolean {
	if (turn.mode === 'ffa') return aliveIds.includes(playerId);
	if (!aliveIds.includes(playerId)) return false;
	return effectiveBatch(turn, aliveIds).includes(playerId);
}

export function markActed(turn: TurnState, playerId: string): void {
	if (!turn.actedPlayerIds.includes(playerId)) turn.actedPlayerIds.push(playerId);
}

export function turnTimerRemainingMs(turn: TurnState, now: number): number | null {
	if (turn.endsAt === null) return null;
	return Math.max(0, turn.endsAt - now);
}
