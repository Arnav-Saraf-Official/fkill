/**
 * The central rules registry.
 *
 * Every balancing value used by the maths engine, combat resolution, CPU,
 * scoring, UI and authoritative server lives here. Changing Sniper damage or a
 * root limit is a one-line edit in this file.
 */

import type { GameRules, GrapherType, GrapherTypeDefinition, ScoringRules } from './types';

export const MAX_PLAYERS = 10;
export const MAX_GRAPHERS_PER_PLAYER = 20;
export const MAX_HEALTH = 20;
export const MIN_HEALTH = 1;

/** Setting ranges shared by validation and the UI controls. */
export const LIMITS = {
	maxPlayers: { min: 2, max: MAX_PLAYERS },
	graphersPerPlayer: { min: 1, max: MAX_GRAPHERS_PER_PLAYER },
	health: { min: MIN_HEALTH, max: MAX_HEALTH },
	turnSecondsSliderMax: 120,
	turnSeconds: { min: 5, max: 3600 },
	cooldownMultiplier: { min: 0, max: 5 },
	concurrentPlayers: { min: 1, max: MAX_PLAYERS },
	hitRadius: { min: 0.2, max: 6 },
	precisionDenominator: { min: 5, max: 64 },
	gridSpacing: { min: 0.25, max: 10 },
	obstacleCount: { min: 0, max: 24 },
	obstacleSize: { min: 1, max: 16 },
	obstacleDurability: { min: 1, max: 99 },
	obstacleSectionSize: { min: 0.25, max: 5 },
	placementSeparation: { min: 0, max: 25 },
	baseHitPoints: { min: 0, max: 1000 },
	precisionBonusMax: { min: 0, max: 1000 },
	roundingDigits: { min: 0, max: 3 },
	maxExpressionLength: { min: 32, max: 1024 },
	maxRootsToCount: { min: 1, max: 200 }
} as const;

export const WORLD_SIZE = 50;

/**
 * Grapher registry. `domainRangeSpan` is the *total width* of the valid local
 * coordinate window, centred on the local origin (span 30 -> [-15, 15]).
 */
export const DEFAULT_GRAPHER_TYPES: Record<GrapherType, GrapherTypeDefinition> = {
	basic: {
		id: 'basic',
		label: 'Basic',
		description:
			'One function per attack, up to 5 distinct real roots, 30-unit range. Reliable and easy to aim.',
		attackMode: 'function',
		maxRoots: 5,
		domainRangeSpan: 30,
		damageToGraphers: 1,
		damageToObstacles: 1,
		inputHint: 'y = f(x), at most 5 real roots'
	},
	buzzer: {
		id: 'buzzer',
		label: 'Buzzer',
		description:
			'One function, up to 30 distinct real roots, but a short 25-unit range. Built for dense, high-frequency curves.',
		attackMode: 'function',
		maxRoots: 30,
		domainRangeSpan: 25,
		damageToGraphers: 2,
		damageToObstacles: 1,
		inputHint: 'y = f(x), at most 30 real roots, 25-unit range'
	},
	sniper: {
		id: 'sniper',
		label: 'Sniper',
		description:
			'One function, only 3 roots, 50-unit range across the whole plane. A direct hit deals heavy damage.',
		attackMode: 'function',
		maxRoots: 3,
		domainRangeSpan: 50,
		damageToGraphers: 10,
		damageToObstacles: 3,
		inputHint: 'y = f(x), at most 3 real roots, full-plane range'
	},
	spray: {
		id: 'spray',
		label: 'Spray',
		description:
			'Up to 3 functions in one attack sharing a 10-root budget and a 50-unit range. Each function hits on its own.',
		attackMode: 'multi-function',
		maxRoots: 10,
		maxTotalRoots: 10,
		maxFunctions: 3,
		domainRangeSpan: 50,
		damageToGraphers: 1,
		damageToObstacles: 1,
		inputHint: 'Up to 3 functions, 10 roots total'
	},
	arc: {
		id: 'arc',
		label: 'Arc',
		description:
			'Fires a true circular arc instead of y = f(x): radius up to 25 units, sweep up to 180°, no root limit.',
		attackMode: 'arc',
		maxRoots: 0,
		domainRangeSpan: 50,
		maxArcRadius: 25,
		maxArcSweepDegrees: 180,
		damageToGraphers: 3,
		damageToObstacles: 2,
		inputHint: 'arc(cx, cy, r, start°, sweep°)'
	}
};

export const GRAPHER_TYPE_ORDER: GrapherType[] = ['basic', 'buzzer', 'sniper', 'spray', 'arc'];

export const DEFAULT_SCORING: ScoringRules = {
	baseHitPoints: 10,
	precisionBonusMax: 10,
	roundingDigits: 1
};

export const DEFAULT_RULES: GameRules = {
	maxPlayers: MAX_PLAYERS,
	maxGraphersPerPlayer: 5,
	grapherHealth: MIN_HEALTH,
	targetHitRadius: 1.1,
	worldSize: WORLD_SIZE,
	grapherTypes: DEFAULT_GRAPHER_TYPES,
	baseCooldownSeconds: 5,
	cooldownMultiplier: 1,
	selection: 'manual',
	turns: {
		mode: 'round-robin',
		concurrentPlayers: 1,
		timePerTurnSeconds: 60
	},
	coordinates: {
		mode: 'shared',
		allowRotation: false,
		showAxes: true,
		showGrid: true,
		gridSpacing: 1,
		labels: true
	},
	precision: {
		denominator: 8,
		showCoordinates: true
	},
	obstacles: {
		enabled: false,
		arrangement: 'none',
		count: 3,
		minSize: 3,
		maxSize: 6,
		durability: 3,
		indestructible: false,
		punchThrough: false,
		sectionSize: 1.25
	},
	scoring: DEFAULT_SCORING,
	placement: {
		mode: 'auto',
		distribution: 'min-separation',
		minSeparation: 7
	},
	limits: {
		maxExpressionLength: 240,
		maxAstNodes: 128,
		maxAstDepth: 24,
		maxSamples: 2400,
		maxRootGrid: 512,
		maxRootsToCount: 40,
		minSubmitIntervalMs: 350,
		maxSubmitsPerWindow: 12,
		submitWindowMs: 10000
	}
};

/** Cooldown length in ms, honouring the multiplier and selection mode. */
export function cooldownDurationMs(rules: GameRules): number {
	if (rules.selection !== 'manual') return 0;
	if (rules.cooldownMultiplier <= 0) return 0;
	return Math.round(rules.baseCooldownSeconds * 1000 * rules.cooldownMultiplier);
}

export function cooldownApplies(rules: GameRules): boolean {
	return rules.selection === 'manual' && rules.cooldownMultiplier > 0;
}

export function isFfa(rules: GameRules): boolean {
	return rules.turns.mode === 'ffa';
}

export function turnTimerApplies(rules: GameRules): boolean {
	return !isFfa(rules);
}

export function grapherDefinition(rules: GameRules, type: GrapherType): GrapherTypeDefinition {
	return rules.grapherTypes[type];
}

export function attackModeLabel(rules: GameRules, type: GrapherType): string {
	const mode = rules.grapherTypes[type].attackMode;
	if (mode === 'arc') return 'Circular arc';
	if (mode === 'multi-function') return 'Multi-function';
	return 'Single function';
}

/** Precision rounding used for every score value in the engine. */
export function roundScore(value: number, rules: GameRules): number {
	const digits = Math.max(0, Math.min(3, rules.scoring.roundingDigits));
	const f = Math.pow(10, digits);
	return Math.round(value * f) / f;
}

/** Placement grid step: denominator N means multiples of 1/N. */
export function placementStep(rules: GameRules): number {
	return 1 / Math.max(1, rules.precision.denominator);
}

export function snapToPlacementGrid(rules: GameRules, value: number): number {
	const step = placementStep(rules);
	return Math.round(value / step) * step;
}

/** Number of graphers a player actually gets for a loadout. */
export function allowedLoadoutSize(rules: GameRules, requested: number): number {
	return Math.max(1, Math.min(rules.maxGraphersPerPlayer, Math.floor(requested)));
}

/** Deep-ish clone that is safe for serialisable rules (no functions). */
export function cloneRules(rules: GameRules): GameRules {
	return JSON.parse(JSON.stringify(rules)) as GameRules;
}

export function defaultLoadout(rules: GameRules, count = Math.min(5, rules.maxGraphersPerPlayer)): GrapherType[] {
	const pattern: GrapherType[] = ['basic', 'sniper', 'buzzer', 'spray', 'arc'];
	const out: GrapherType[] = [];
	for (let i = 0; i < count; i++) out.push(pattern[i % pattern.length]);
	return out.slice(0, rules.maxGraphersPerPlayer);
}
