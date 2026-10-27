/**
 * Candidate evaluation.
 *
 * A candidate is simulated by the authoritative engine with `commit: false`,
 * so the CPU sees exactly the damage, score, kills and obstacle effects a human
 * shot would produce. No separate damage model exists.
 */

import type { ActionResult } from '../game/types';
import type { DifficultyProfile } from './difficulty';

export interface CandidateScore {
	value: number;
	damage: number;
	score: number;
	kills: number;
	hits: number;
	blocked: boolean;
}

export function scoreAttackResult(result: ActionResult, profile: DifficultyProfile): CandidateScore {
	if (!result.ok || !result.attack) {
		return { value: -Infinity, damage: 0, score: 0, kills: 0, hits: 0, blocked: false };
	}
	const attack = result.attack;
	const kills = attack.destroyedTargetIds.length;
	const hits = attack.targetsHit;
	const precision =
		attack.components.reduce((sum, c) => {
			return sum + c.targetsHit.reduce((s, h) => s + h.precisionRatio, 0);
		}, 0) / Math.max(1, hits);
	const sections = attack.components.reduce(
		(sum, c) => sum + c.obstaclesHit.filter((o) => o.destroyed).length,
		0
	);
	const blocked = attack.components.every((c) => c.outcome === 'blocked');
	const value =
		attack.totalScore +
		attack.totalDamage * 3 +
		kills * (40 + 20 * profile.finishPreference) +
		hits * 6 +
		precision * 5 +
		sections * 3 -
		(blocked ? 4 : 0) -
		(hits === 0 ? 2 : 0);
	return { value, damage: attack.totalDamage, score: attack.totalScore, kills, hits, blocked };
}
