/**
 * Win conditions.
 *
 * Default: the last player with at least one surviving grapher wins. If every
 * remaining grapher is destroyed in the same resolution, ties are broken
 * deterministically by (1) remaining health, (2) score, (3) original player
 * order. The outcome is a small replaceable module so a future time-limited
 * mode can supply a different rule without touching the engine.
 */

import type { Grapher, Player } from './types';

export interface MatchOutcome {
	finished: boolean;
	winnerIds: string[];
	reason: 'last-standing' | 'tiebreak' | null;
}

export function remainingHealth(graphers: Grapher[], playerId: string): number {
	let health = 0;
	for (const g of graphers) {
		if (g.ownerId === playerId && g.alive && g.health > 0) health += g.health;
	}
	return health;
}

export function aliveGraphers(graphers: Grapher[], playerId: string): Grapher[] {
	return graphers.filter((g) => g.ownerId === playerId && g.alive && g.health > 0);
}

export function evaluateOutcome(players: Player[], graphers: Grapher[]): MatchOutcome {
	const alive = players.filter((p) => p.alive && aliveGraphers(graphers, p.id).length > 0);
	if (alive.length > 1) return { finished: false, winnerIds: [], reason: null };
	if (alive.length === 1) {
		return { finished: true, winnerIds: [alive[0].id], reason: 'last-standing' };
	}
	// Nobody has a surviving grapher: deterministic tie-break.
	const ranked = players.slice().sort((a, b) => {
		const ha = remainingHealth(graphers, a.id);
		const hb = remainingHealth(graphers, b.id);
		if (hb !== ha) return hb - ha;
		if (b.score !== a.score) return b.score - a.score;
		return players.indexOf(a) - players.indexOf(b);
	});
	if (ranked.length === 0) return { finished: true, winnerIds: [], reason: 'tiebreak' };
	return { finished: true, winnerIds: [ranked[0].id], reason: 'tiebreak' };
}
