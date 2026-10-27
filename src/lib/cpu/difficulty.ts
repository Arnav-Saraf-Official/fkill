/**
 * CPU difficulty profiles.
 *
 * Difficulty changes *decision quality only*: how many candidates the CPU
 * considers, how accurately it estimates positions from what it can see, whether
 * it plans multi-target shots, and how often it picks its best option rather
 * than a merely decent one. It never grants extra roots, range, damage, health
 * or cooldown advantages, and every CPU shot is validated by the same engine
 * path as a human shot.
 *
 * Labels are display text and are independent of the stable tier ids, so they
 * can be reworded without touching balance or persisted data.
 */

import type { CpuDifficulty } from '../game/types';

export interface DifficultyProfile {
	id: CpuDifficulty;
	label: string;
	description: string;
	/** Maximum candidate attacks evaluated per decision. */
	candidateBudget: number;
	/** Positional error (coordinate units) applied to what it aims at. */
	aimJitter: number;
	/** Probability of taking the best evaluated option; otherwise top-N. */
	chooseBest: number;
	/** How many ranked alternatives are considered when not choosing best. */
	alternativeWindow: number;
	/** Whether the CPU attempts shots that hit several targets at once. */
	multiTarget: boolean;
	/** Preference weight for finishing weakened targets. */
	finishPreference: number;
	/** Whether spray attacks stack multiple components on one target. */
	stackSpray: boolean;
	/** Whether the CPU checks blocked shots by asking for an alternative. */
	obstacleAwareness: number;
	/** Cosmetic pacing before acting (never affects legality or outcome). */
	thinkTimeMs: number;
}

/** Edit these strings to relabel the tiers; ids stay stable. */
export const DIFFICULTY_LABELS: Record<CpuDifficulty, string> = {
	easy: 'Easy',
	casual: 'Casual',
	steady: 'Steady',
	sharp: 'Sharp',
	expert: 'Expert',
	master: 'Master',
	grandmaster: 'Grandmaster',
	asian: 'Asian'
};

export const DIFFICULTY_ORDER: CpuDifficulty[] = [
	'easy',
	'casual',
	'steady',
	'sharp',
	'expert',
	'master',
	'grandmaster',
	'asian'
];

export const DIFFICULTY_PROFILES: Record<CpuDifficulty, DifficultyProfile> = {
	easy: {
		id: 'easy',
		label: DIFFICULTY_LABELS.easy,
		description: 'Rough aim, few candidates, single target. Good for learning the controls.',
		candidateBudget: 6,
		aimJitter: 4,
		chooseBest: 0.35,
		alternativeWindow: 3,
		multiTarget: false,
		finishPreference: 0.4,
		stackSpray: false,
		obstacleAwareness: 0.2,
		thinkTimeMs: 900
	},
	casual: {
		id: 'casual',
		label: DIFFICULTY_LABELS.casual,
		description: 'Looser targeting and a small search budget.',
		candidateBudget: 10,
		aimJitter: 2.6,
		chooseBest: 0.5,
		alternativeWindow: 3,
		multiTarget: false,
		finishPreference: 0.6,
		stackSpray: false,
		obstacleAwareness: 0.35,
		thinkTimeMs: 800
	},
	steady: {
		id: 'steady',
		label: DIFFICULTY_LABELS.steady,
		description: 'Solid aim and sensible target choice.',
		candidateBudget: 16,
		aimJitter: 1.5,
		chooseBest: 0.65,
		alternativeWindow: 2,
		multiTarget: false,
		finishPreference: 0.8,
		stackSpray: true,
		obstacleAwareness: 0.5,
		thinkTimeMs: 700
	},
	sharp: {
		id: 'sharp',
		label: DIFFICULTY_LABELS.sharp,
		description: 'Accurate shots and a wider candidate search.',
		candidateBudget: 24,
		aimJitter: 0.9,
		chooseBest: 0.75,
		alternativeWindow: 2,
		multiTarget: true,
		finishPreference: 1,
		stackSpray: true,
		obstacleAwareness: 0.65,
		thinkTimeMs: 650
	},
	expert: {
		id: 'expert',
		label: DIFFICULTY_LABELS.expert,
		description: 'Prefers finishing blows and plans multi-target curves.',
		candidateBudget: 32,
		aimJitter: 0.5,
		chooseBest: 0.85,
		alternativeWindow: 2,
		multiTarget: true,
		finishPreference: 1.2,
		stackSpray: true,
		obstacleAwareness: 0.8,
		thinkTimeMs: 600
	},
	master: {
		id: 'master',
		label: DIFFICULTY_LABELS.master,
		description: 'High precision and efficient use of root budgets.',
		candidateBudget: 44,
		aimJitter: 0.25,
		chooseBest: 0.92,
		alternativeWindow: 2,
		multiTarget: true,
		finishPreference: 1.4,
		stackSpray: true,
		obstacleAwareness: 0.9,
		thinkTimeMs: 550
	},
	grandmaster: {
		id: 'grandmaster',
		label: DIFFICULTY_LABELS.grandmaster,
		description: 'Near-perfect aim with a deep candidate search.',
		candidateBudget: 60,
		aimJitter: 0.1,
		chooseBest: 0.97,
		alternativeWindow: 2,
		multiTarget: true,
		finishPreference: 1.6,
		stackSpray: true,
		obstacleAwareness: 0.97,
		thinkTimeMs: 500
	},
	asian: {
		id: 'asian',
		label: DIFFICULTY_LABELS.asian,
		description:
			'No aim error, the full search budget and every legal optimisation the grapher allows.',
		candidateBudget: 84,
		aimJitter: 0,
		chooseBest: 1,
		alternativeWindow: 1,
		multiTarget: true,
		finishPreference: 1.8,
		stackSpray: true,
		obstacleAwareness: 1,
		thinkTimeMs: 450
	}
};

export function difficultyProfile(id: CpuDifficulty | undefined): DifficultyProfile {
	return DIFFICULTY_PROFILES[id ?? 'steady'] ?? DIFFICULTY_PROFILES.steady;
}

export function difficultyOptions(): { id: CpuDifficulty; label: string; description: string }[] {
	return DIFFICULTY_ORDER.map((id) => ({
		id,
		label: DIFFICULTY_LABELS[id],
		description: DIFFICULTY_PROFILES[id].description
	}));
}
