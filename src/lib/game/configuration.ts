/**
 * Configuration validation and (de)serialisation.
 *
 * Imported configuration is never trusted: every field is checked against the
 * documented ranges and enumeration values. Invalid configuration is rejected
 * with readable errors instead of being silently clamped.
 */

import { DEFAULT_GRAPHER_TYPES, GRAPHER_TYPE_ORDER, LIMITS, MAX_HEALTH, MIN_HEALTH } from './rules';
import type {
	CpuDifficulty,
	GameRules,
	GrapherType,
	GrapherTypeDefinition,
	MatchConfig,
	MatchSetup,
	PlayerConfig,
	PlacementRules,
	Vector2
} from './types';

export const CONFIG_VERSION = 1;

export type RulesValidation =
	| { ok: true; rules: GameRules; warnings: string[] }
	| { ok: false; errors: string[] };

export type ConfigValidation =
	| { ok: true; config: MatchConfig; warnings: string[] }
	| { ok: false; errors: string[] };

interface Ctx {
	errors: string[];
	warnings: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(
	ctx: Ctx,
	path: string,
	value: unknown,
	min: number,
	max: number,
	fallback: number
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		ctx.errors.push(`${path} must be a number`);
		return fallback;
	}
	if (value < min || value > max) {
		ctx.errors.push(`${path} must be between ${min} and ${max} (got ${value})`);
		return fallback;
	}
	return value;
}

function int(ctx: Ctx, path: string, value: unknown, min: number, max: number, fallback: number): number {
	const n = num(ctx, path, value, min, max, fallback);
	if (!Number.isFinite(n)) return fallback;
	if (!Number.isInteger(n)) {
		ctx.errors.push(`${path} must be a whole number`);
		return fallback;
	}
	return n;
}

function bool(ctx: Ctx, path: string, value: unknown, fallback: boolean): boolean {
	if (typeof value !== 'boolean') {
		ctx.errors.push(`${path} must be true or false`);
		return fallback;
	}
	return value;
}

function oneOf<T extends string>(
	ctx: Ctx,
	path: string,
	value: unknown,
	allowed: readonly T[],
	fallback: T
): T {
	if (typeof value !== 'string' || !allowed.includes(value as T)) {
		ctx.errors.push(`${path} must be one of: ${allowed.join(', ')}`);
		return fallback;
	}
	return value as T;
}

function validateGrapherTypes(ctx: Ctx, raw: unknown): Record<GrapherType, GrapherTypeDefinition> {
	const out = structuredClone(DEFAULT_GRAPHER_TYPES);
	if (!isRecord(raw)) {
		ctx.errors.push('rules.grapherTypes must be an object with all five grapher types');
		return out;
	}
	for (const key of Object.keys(raw)) {
		if (!GRAPHER_TYPE_ORDER.includes(key as GrapherType)) {
			ctx.warnings.push(`rules.grapherTypes.${key} is not a known grapher type and was ignored`);
		}
	}
	for (const id of GRAPHER_TYPE_ORDER) {
		const entry = raw[id];
		if (!isRecord(entry)) {
			ctx.errors.push(`rules.grapherTypes.${id} is required`);
			continue;
		}
		const path = `rules.grapherTypes.${id}`;
		const def: GrapherTypeDefinition = { ...DEFAULT_GRAPHER_TYPES[id] };
		def.label = typeof entry.label === 'string' && entry.label.trim() ? entry.label : def.label;
		def.description =
			typeof entry.description === 'string' ? entry.description : def.description;
		def.inputHint = typeof entry.inputHint === 'string' ? entry.inputHint : def.inputHint;
		def.attackMode = oneOf(ctx, `${path}.attackMode`, entry.attackMode, ['function', 'multi-function', 'arc'], def.attackMode);
		def.maxRoots = int(ctx, `${path}.maxRoots`, entry.maxRoots ?? def.maxRoots, 0, 200, def.maxRoots);
		def.domainRangeSpan = num(ctx, `${path}.domainRangeSpan`, entry.domainRangeSpan ?? def.domainRangeSpan, 2, 60, def.domainRangeSpan);
		def.damageToGraphers = num(ctx, `${path}.damageToGraphers`, entry.damageToGraphers ?? def.damageToGraphers, 0, 100, def.damageToGraphers);
		def.damageToObstacles = num(ctx, `${path}.damageToObstacles`, entry.damageToObstacles ?? def.damageToObstacles, 0, 100, def.damageToObstacles);
		if (def.attackMode === 'multi-function') {
			def.maxFunctions = int(ctx, `${path}.maxFunctions`, entry.maxFunctions ?? def.maxFunctions ?? 3, 1, 8, def.maxFunctions ?? 3);
			def.maxTotalRoots = int(ctx, `${path}.maxTotalRoots`, entry.maxTotalRoots ?? def.maxTotalRoots ?? 10, 1, 200, def.maxTotalRoots ?? 10);
		}
		if (def.attackMode === 'arc') {
			def.maxArcRadius = num(ctx, `${path}.maxArcRadius`, entry.maxArcRadius ?? def.maxArcRadius ?? 25, 0.5, 100, def.maxArcRadius ?? 25);
			def.maxArcSweepDegrees = num(ctx, `${path}.maxArcSweepDegrees`, entry.maxArcSweepDegrees ?? def.maxArcSweepDegrees ?? 180, 1, 360, def.maxArcSweepDegrees ?? 180);
		}
		out[id] = def;
	}
	// Cross-field consistency rules.
	for (const id of GRAPHER_TYPE_ORDER) {
		const def = out[id];
		if (def.attackMode === 'multi-function' && (def.maxFunctions ?? 1) < 1) {
			ctx.errors.push(`rules.grapherTypes.${id}.maxFunctions must be at least 1`);
		}
		if (def.attackMode === 'multi-function' && (def.maxTotalRoots ?? 1) < 1) {
			ctx.errors.push(`rules.grapherTypes.${id}.maxTotalRoots must be at least 1`);
		}
		if (def.attackMode === 'arc' && (def.maxArcRadius ?? 0) <= 0) {
			ctx.errors.push(`rules.grapherTypes.${id}.maxArcRadius must be positive`);
		}
	}
	return out;
}

export function validateRules(raw: unknown): RulesValidation {
	const ctx: Ctx = { errors: [], warnings: [] };
	if (!isRecord(raw)) return { ok: false, errors: ['rules must be an object'] };
	const r = raw;

	const maxPlayers = int(ctx, 'rules.maxPlayers', r.maxPlayers, LIMITS.maxPlayers.min, LIMITS.maxPlayers.max, 10);
	const maxGraphers = int(ctx, 'rules.maxGraphersPerPlayer', r.maxGraphersPerPlayer, 1, LIMITS.graphersPerPlayer.max, 5);
	const health = int(ctx, 'rules.grapherHealth', r.grapherHealth, MIN_HEALTH, MAX_HEALTH, 1);
	const targetHitRadius = num(ctx, 'rules.targetHitRadius', r.targetHitRadius, LIMITS.hitRadius.min, LIMITS.hitRadius.max, 1.1);
	const worldSize = num(ctx, 'rules.worldSize', r.worldSize, 20, 100, 50);

	const turnsRaw = isRecord(r.turns) ? r.turns : {};
	if (!isRecord(r.turns)) ctx.errors.push('rules.turns is required');
	const turns = {
		mode: oneOf(ctx, 'rules.turns.mode', turnsRaw.mode, ['round-robin', 'random', 'ffa'], 'round-robin'),
		concurrentPlayers: int(ctx, 'rules.turns.concurrentPlayers', turnsRaw.concurrentPlayers, 1, maxPlayers, 1),
		timePerTurnSeconds: num(ctx, 'rules.turns.timePerTurnSeconds', turnsRaw.timePerTurnSeconds, LIMITS.turnSeconds.min, LIMITS.turnSeconds.max, 60)
	};
	if (turns.mode === 'ffa' && typeof turnsRaw.timePerTurnSeconds === 'number') {
		ctx.warnings.push('Turn timer is ignored in Free-for-All.');
	}

	const coordRaw = isRecord(r.coordinates) ? r.coordinates : {};
	if (!isRecord(r.coordinates)) ctx.errors.push('rules.coordinates is required');
	const coordinates = {
		mode: oneOf(ctx, 'rules.coordinates.mode', coordRaw.mode, ['shared', 'local'], 'shared'),
		allowRotation: bool(ctx, 'rules.coordinates.allowRotation', coordRaw.allowRotation, false),
		showAxes: bool(ctx, 'rules.coordinates.showAxes', coordRaw.showAxes, true),
		showGrid: bool(ctx, 'rules.coordinates.showGrid', coordRaw.showGrid, true),
		gridSpacing: num(ctx, 'rules.coordinates.gridSpacing', coordRaw.gridSpacing, LIMITS.gridSpacing.min, LIMITS.gridSpacing.max, 1),
		labels: bool(ctx, 'rules.coordinates.labels', coordRaw.labels, true)
	};
	if (coordinates.mode === 'shared' && coordinates.allowRotation) {
		ctx.warnings.push('Local-plane rotation is ignored while using the shared world plane.');
	}

	const precRaw = isRecord(r.precision) ? r.precision : {};
	if (!isRecord(r.precision)) ctx.errors.push('rules.precision is required');
	const precision = {
		denominator: int(ctx, 'rules.precision.denominator', precRaw.denominator, LIMITS.precisionDenominator.min, LIMITS.precisionDenominator.max, 8),
		showCoordinates: bool(ctx, 'rules.precision.showCoordinates', precRaw.showCoordinates, true)
	};

	const obsRaw = isRecord(r.obstacles) ? r.obstacles : {};
	if (!isRecord(r.obstacles)) ctx.errors.push('rules.obstacles is required');
	const obstacles = {
		enabled: bool(ctx, 'rules.obstacles.enabled', obsRaw.enabled, false),
		arrangement: oneOf(ctx, 'rules.obstacles.arrangement', obsRaw.arrangement, ['none', 'scattered', 'corridor', 'fortress', 'random'], 'none'),
		count: int(ctx, 'rules.obstacles.count', obsRaw.count, LIMITS.obstacleCount.min, LIMITS.obstacleCount.max, 3),
		minSize: num(ctx, 'rules.obstacles.minSize', obsRaw.minSize, LIMITS.obstacleSize.min, LIMITS.obstacleSize.max, 3),
		maxSize: num(ctx, 'rules.obstacles.maxSize', obsRaw.maxSize, LIMITS.obstacleSize.min, LIMITS.obstacleSize.max, 6),
		durability: int(ctx, 'rules.obstacles.durability', obsRaw.durability, LIMITS.obstacleDurability.min, LIMITS.obstacleDurability.max, 3),
		indestructible: bool(ctx, 'rules.obstacles.indestructible', obsRaw.indestructible, false),
		punchThrough: bool(ctx, 'rules.obstacles.punchThrough', obsRaw.punchThrough, false),
		sectionSize: num(ctx, 'rules.obstacles.sectionSize', obsRaw.sectionSize, LIMITS.obstacleSectionSize.min, LIMITS.obstacleSectionSize.max, 1.25)
	};
	if (obstacles.maxSize < obstacles.minSize) {
		ctx.errors.push('rules.obstacles.maxSize must be greater than or equal to minSize');
	}
	if (obstacles.enabled && obstacles.arrangement === 'none') {
		ctx.errors.push('Obstacles are enabled but the arrangement is "none"');
	}
	if (!obstacles.enabled && obstacles.arrangement !== 'none') {
		ctx.warnings.push('Obstacle arrangement is ignored because obstacles are disabled.');
	}

	const scoreRaw = isRecord(r.scoring) ? r.scoring : {};
	if (!isRecord(r.scoring)) ctx.errors.push('rules.scoring is required');
	const scoring = {
		baseHitPoints: num(ctx, 'rules.scoring.baseHitPoints', scoreRaw.baseHitPoints, LIMITS.baseHitPoints.min, LIMITS.baseHitPoints.max, 10),
		precisionBonusMax: num(ctx, 'rules.scoring.precisionBonusMax', scoreRaw.precisionBonusMax, LIMITS.precisionBonusMax.min, LIMITS.precisionBonusMax.max, 10),
		roundingDigits: int(ctx, 'rules.scoring.roundingDigits', scoreRaw.roundingDigits, 0, 3, 1)
	};

	const placeRaw = isRecord(r.placement) ? r.placement : {};
	if (!isRecord(r.placement)) ctx.errors.push('rules.placement is required');
	const placement: PlacementRules = {
		mode: oneOf(ctx, 'rules.placement.mode', placeRaw.mode, ['manual', 'auto'], 'auto'),
		distribution: oneOf(ctx, 'rules.placement.distribution', placeRaw.distribution, ['uniform', 'even', 'clustered', 'min-separation'], 'min-separation'),
		minSeparation: num(ctx, 'rules.placement.minSeparation', placeRaw.minSeparation, LIMITS.placementSeparation.min, LIMITS.placementSeparation.max, 7)
	};

	const limRaw = isRecord(r.limits) ? r.limits : {};
	if (!isRecord(r.limits)) ctx.errors.push('rules.limits is required');
	const limits = {
		maxExpressionLength: int(ctx, 'rules.limits.maxExpressionLength', limRaw.maxExpressionLength, LIMITS.maxExpressionLength.min, LIMITS.maxExpressionLength.max, 240),
		maxAstNodes: int(ctx, 'rules.limits.maxAstNodes', limRaw.maxAstNodes, 16, 512, 128),
		maxAstDepth: int(ctx, 'rules.limits.maxAstDepth', limRaw.maxAstDepth, 4, 64, 24),
		maxSamples: int(ctx, 'rules.limits.maxSamples', limRaw.maxSamples, 256, 20000, 2400),
		maxRootGrid: int(ctx, 'rules.limits.maxRootGrid', limRaw.maxRootGrid, 128, 2048, 512),
		maxRootsToCount: int(ctx, 'rules.limits.maxRootsToCount', limRaw.maxRootsToCount, LIMITS.maxRootsToCount.min, LIMITS.maxRootsToCount.max, 40),
		minSubmitIntervalMs: int(ctx, 'rules.limits.minSubmitIntervalMs', limRaw.minSubmitIntervalMs, 0, 60000, 350),
		maxSubmitsPerWindow: int(ctx, 'rules.limits.maxSubmitsPerWindow', limRaw.maxSubmitsPerWindow, 1, 200, 12),
		submitWindowMs: int(ctx, 'rules.limits.submitWindowMs', limRaw.submitWindowMs, 1000, 600000, 10000)
	};

	const grapherTypes = validateGrapherTypes(ctx, r.grapherTypes);

	const rules: GameRules = {
		maxPlayers,
		maxGraphersPerPlayer: maxGraphers,
		grapherHealth: health,
		targetHitRadius,
		worldSize,
		grapherTypes,
		baseCooldownSeconds: num(ctx, 'rules.baseCooldownSeconds', r.baseCooldownSeconds, 0, 120, 5),
		cooldownMultiplier: num(ctx, 'rules.cooldownMultiplier', r.cooldownMultiplier, LIMITS.cooldownMultiplier.min, LIMITS.cooldownMultiplier.max, 1),
		selection: oneOf(ctx, 'rules.selection', r.selection, ['manual', 'auto-round-robin', 'auto-random'], 'manual'),
		turns,
		coordinates,
		precision,
		obstacles,
		scoring,
		placement,
		limits
	};

	if (rules.selection !== 'manual' && rules.cooldownMultiplier > 0) {
		ctx.warnings.push('Cooldowns are disabled while grapher selection is automatic.');
	}
	if (turns.mode === 'ffa' && turns.concurrentPlayers !== 1) {
		ctx.warnings.push('Concurrent-player batching only applies to turn-based modes.');
	}

	if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };
	return { ok: true, rules, warnings: ctx.warnings };
}

const CPU_DIFFICULTIES: CpuDifficulty[] = [
	'easy',
	'casual',
	'steady',
	'sharp',
	'expert',
	'master',
	'grandmaster',
	'asian'
];

export function validateSetup(raw: unknown, rules: GameRules): { ok: true; setup: MatchSetup; warnings: string[] } | { ok: false; errors: string[] } {
	const ctx: Ctx = { errors: [], warnings: [] };
	if (!isRecord(raw)) return { ok: false, errors: ['setup must be an object'] };
	const seed = typeof raw.seed === 'string' && raw.seed.trim() ? raw.seed : 'default-seed';
	const playersRaw = raw.players;
	if (!Array.isArray(playersRaw)) return { ok: false, errors: ['setup.players must be an array'] };
	if (playersRaw.length < 2) ctx.errors.push('A match needs at least 2 players');
	if (playersRaw.length > rules.maxPlayers) {
		ctx.errors.push(`A match supports at most ${rules.maxPlayers} players (got ${playersRaw.length})`);
	}
	const ids = new Set<string>();
	const colorIndices = new Set<number>();
	const players: PlayerConfig[] = [];
	playersRaw.forEach((pRaw, i) => {
		const path = `setup.players[${i}]`;
		if (!isRecord(pRaw)) {
			ctx.errors.push(`${path} must be an object`);
			return;
		}
		const id = typeof pRaw.id === 'string' && pRaw.id.trim() ? pRaw.id : `p${i + 1}`;
		if (ids.has(id)) ctx.errors.push(`${path}.id "${id}" is duplicated`);
		ids.add(id);
		const name = typeof pRaw.name === 'string' && pRaw.name.trim() ? pRaw.name.slice(0, 24) : `Player ${i + 1}`;
		const kind = oneOf(ctx, `${path}.kind`, pRaw.kind, ['human', 'cpu'], 'human');
		const colorIndex = int(ctx, `${path}.colorIndex`, pRaw.colorIndex ?? i, 0, 9, i % 10);
		if (colorIndices.has(colorIndex)) {
			ctx.errors.push(`${path}.colorIndex ${colorIndex} is already used; every player needs a distinct identity`);
		}
		colorIndices.add(colorIndex);
		const loadoutRaw = pRaw.loadout;
		const loadout: GrapherType[] = [];
		if (Array.isArray(loadoutRaw)) {
			for (const t of loadoutRaw) {
				if (typeof t !== 'string' || !GRAPHER_TYPE_ORDER.includes(t as GrapherType)) {
					ctx.errors.push(`${path}.loadout contains an unknown grapher type "${String(t)}"`);
					continue;
				}
				loadout.push(t as GrapherType);
			}
		}
		if (loadout.length === 0) {
			ctx.errors.push(`${path}.loadout must contain at least one grapher`);
		}
		if (loadout.length > rules.maxGraphersPerPlayer) {
			ctx.errors.push(
				`${path}.loadout has ${loadout.length} graphers but the limit is ${rules.maxGraphersPerPlayer}`
			);
		}
		let cpuDifficulty: CpuDifficulty | undefined;
		if (kind === 'cpu') {
			const rawDifficulty = pRaw.cpuDifficulty ?? 'steady';
			cpuDifficulty = oneOf(ctx, `${path}.cpuDifficulty`, rawDifficulty, CPU_DIFFICULTIES, 'steady');
		}
		players.push({ id, name, kind, colorIndex, cpuDifficulty, loadout });
	});
	if (!players.some((p) => p.kind === 'human')) {
		ctx.errors.push('A match needs at least one human player');
	}

	const manualPlacements: Record<string, Vector2[]> = {};
	if (isRecord(raw.manualPlacements)) {
		const worldHalf = rules.worldSize / 2;
		for (const player of players) {
			const list = (raw.manualPlacements as Record<string, unknown>)[player.id];
			if (list === undefined) continue;
			if (!Array.isArray(list)) {
				ctx.errors.push(`setup.manualPlacements.${player.id} must be an array`);
				continue;
			}
			if (list.length !== player.loadout.length) {
				ctx.errors.push(
					`setup.manualPlacements.${player.id} must contain exactly ${player.loadout.length} positions`
				);
				continue;
			}
			const positions: Vector2[] = [];
			list.forEach((pos, index) => {
				const path = `setup.manualPlacements.${player.id}[${index}]`;
				if (!isRecord(pos) || typeof pos.x !== 'number' || typeof pos.y !== 'number' || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
					ctx.errors.push(`${path} must be a finite {x, y} pair`);
					return;
				}
				if (Math.abs(pos.x) > worldHalf || Math.abs(pos.y) > worldHalf) {
					ctx.errors.push(`${path} lies outside the ${rules.worldSize}x${rules.worldSize} plane`);
					return;
				}
				positions.push({ x: pos.x, y: pos.y });
			});
			// Positions must not overlap each other for the same player.
			for (let a = 0; a < positions.length; a++) {
				for (let b = a + 1; b < positions.length; b++) {
					const dx = positions[a].x - positions[b].x;
					const dy = positions[a].y - positions[b].y;
					if (Math.hypot(dx, dy) < 1) {
						ctx.errors.push(
							`setup.manualPlacements.${player.id}: graphers ${a + 1} and ${b + 1} are closer than 1 coordinate unit`
						);
					}
				}
			}
			manualPlacements[player.id] = positions;
		}
	}

	if (rules.placement.mode === 'manual') {
		for (const player of players) {
			if (!manualPlacements[player.id]) {
				ctx.warnings.push(
					`No manual placement supplied for ${player.name}; a valid position will be generated automatically.`
				);
			}
		}
	}

	const setup: MatchSetup = { seed, players };
	if (Object.keys(manualPlacements).length > 0) setup.manualPlacements = manualPlacements;
	if (isRecord(raw.rotations)) {
		const rotations: Record<string, number[]> = {};
		for (const [playerId, list] of Object.entries(raw.rotations)) {
			if (!Array.isArray(list)) continue;
			rotations[playerId] = list.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
		}
		setup.rotations = rotations;
	}
	if (ctx.errors.length > 0) return { ok: false, errors: ctx.errors };
	return { ok: true, setup, warnings: ctx.warnings };
}

export function validateMatchConfig(raw: unknown): ConfigValidation {
	if (!isRecord(raw)) return { ok: false, errors: ['Configuration must be a JSON object'] };
	const rulesResult = validateRules(raw.rules);
	if (!rulesResult.ok) return { ok: false, errors: rulesResult.errors };
	const setupResult = validateSetup(raw.setup, rulesResult.rules);
	if (!setupResult.ok) return { ok: false, errors: setupResult.errors };
	return {
		ok: true,
		config: { rules: rulesResult.rules, setup: setupResult.setup },
		warnings: [...rulesResult.warnings, ...setupResult.warnings]
	};
}

export function exportConfig(config: MatchConfig): string {
	return JSON.stringify({ version: CONFIG_VERSION, rules: config.rules, setup: config.setup }, null, 2);
}

export function importConfig(json: string): ConfigValidation {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return { ok: false, errors: ['The file is not valid JSON'] };
	}
	if (!isRecord(parsed)) return { ok: false, errors: ['The file does not contain a configuration object'] };
	if (parsed.version !== undefined && parsed.version !== CONFIG_VERSION) {
		return { ok: false, errors: [`Unsupported configuration version ${String(parsed.version)}`] };
	}
	return validateMatchConfig({ rules: parsed.rules, setup: parsed.setup });
}
