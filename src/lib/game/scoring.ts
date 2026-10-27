/**
 * Precision scoring.
 *
 *   score = baseHitPoints + precisionBonusMax * (1 - d / R)
 *
 * `d` is the minimum distance between the target centre and the visible attack
 * geometry, `R` the target hit radius. The result is rounded once, using the
 * configured number of decimal places, so the same numbers can be displayed and
 * summed without drift.
 */

import type { GameRules } from './types';
import { roundScore } from './rules';

export interface PrecisionScore {
	score: number;
	/** 1 at the centre, 0 at the edge of the hit zone. */
	precisionRatio: number;
}

export function computePrecisionScore(
	rules: GameRules,
	distance: number,
	hitRadius: number
): PrecisionScore {
	const safeRadius = Math.max(1e-6, hitRadius);
	const clamped = Math.min(Math.max(distance, 0), safeRadius);
	const precisionRatio = 1 - clamped / safeRadius;
	const raw = rules.scoring.baseHitPoints + rules.scoring.precisionBonusMax * precisionRatio;
	return { score: roundScore(raw, rules), precisionRatio };
}
