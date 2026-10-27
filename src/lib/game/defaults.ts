/**
 * Defaults, setup builders and presets.
 *
 * Presets are complete MatchConfigs: they set every rule that makes them
 * distinct and leave the rest at the documented defaults, so they can be
 * exported, imported and validated like any hand-made configuration.
 */

import type {
	CpuDifficulty,
	GameRules,
	GrapherType,
	MatchConfig,
	MatchSetup,
	PlayerConfig
} from './types';
import { DEFAULT_RULES, GRAPHER_TYPE_ORDER } from './rules';

export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface SetupOptions {
	seed?: string;
	humanCount?: number;
	cpuCount?: number;
	cpuDifficulty?: CpuDifficulty;
	/** Loadout used for human players; CPUs get the same unless specified. */
	loadout?: GrapherType[];
	cpuLoadout?: GrapherType[];
	humanName?: string;
	names?: string[];
}

function loadoutOf(requested: GrapherType[] | undefined, rules: GameRules): GrapherType[] {
	const fallback = GRAPHER_TYPE_ORDER.slice(0, Math.min(5, rules.maxGraphersPerPlayer));
	const chosen = (requested ?? fallback).filter((t) => GRAPHER_TYPE_ORDER.includes(t));
	const capped = chosen.slice(0, rules.maxGraphersPerPlayer);
	if (capped.length > 0) return capped;
	return [GRAPHER_TYPE_ORDER[0]];
}

export function createSetup(rules: GameRules, options: SetupOptions = {}): MatchSetup {
	const humanCount = Math.max(1, options.humanCount ?? 1);
	const cpuCount = Math.max(0, options.cpuCount ?? 1);
	const total = Math.min(rules.maxPlayers, humanCount + cpuCount);
	const players: PlayerConfig[] = [];
	let color = 0;
	for (let i = 0; i < total; i++) {
		const isHuman = i < humanCount;
		const name =
			options.names?.[i] ??
			(isHuman ? (i === 0 ? (options.humanName ?? 'You') : `Player ${i + 1}`) : `CPU ${i - humanCount + 1}`);
		players.push({
			id: `p${i + 1}`,
			name,
			kind: isHuman ? 'human' : 'cpu',
			colorIndex: color++ % 10,
			cpuDifficulty: isHuman ? undefined : (options.cpuDifficulty ?? 'steady'),
			loadout: loadoutOf(isHuman ? options.loadout : (options.cpuLoadout ?? options.loadout), rules)
		});
	}
	return { seed: options.seed ?? 'fkill-default-seed', players };
}

function mergeRules(base: GameRules, patch: DeepPartial<GameRules>): GameRules {
	const mergedTypes = structuredClone(base.grapherTypes);
	if (patch.grapherTypes) {
		for (const id of GRAPHER_TYPE_ORDER) {
			const partial = patch.grapherTypes[id];
			if (partial) mergedTypes[id] = { ...mergedTypes[id], ...partial };
		}
	}
	const out: GameRules = {
		...base,
		...patch,
		grapherTypes: mergedTypes,
		turns: { ...base.turns, ...patch.turns },
		coordinates: { ...base.coordinates, ...patch.coordinates },
		precision: { ...base.precision, ...patch.precision },
		obstacles: { ...base.obstacles, ...patch.obstacles },
		scoring: { ...base.scoring, ...patch.scoring },
		placement: { ...base.placement, ...patch.placement },
		limits: { ...base.limits, ...patch.limits }
	};
	return out;
}

export function withRules(patch: DeepPartial<GameRules> = {}, base: GameRules = DEFAULT_RULES): GameRules {
	return mergeRules(structuredClone(base), patch);
}

export function createSoloConfig(options: SetupOptions & { rules?: DeepPartial<GameRules> } = {}): MatchConfig {
	const rules = withRules(options.rules ?? {});
	const setup = createSetup(rules, { humanCount: 1, cpuCount: 1, ...options });
	return { rules, setup };
}

export interface Preset {
	id: string;
	label: string;
	description: string;
	build(): MatchConfig;
}

export const PRESETS: Preset[] = [
	{
		id: 'quick',
		label: 'Quick match',
		description: 'One human vs one CPU. Shared plane, 60-second turns, five mixed graphers.',
		build: () =>
			createSoloConfig({
				seed: 'quick-match',
				rules: {
					maxGraphersPerPlayer: 5,
					grapherHealth: 1,
					turns: { mode: 'round-robin', concurrentPlayers: 1, timePerTurnSeconds: 60 },
					selection: 'manual',
					cooldownMultiplier: 1,
					placement: { mode: 'auto', distribution: 'min-separation', minSeparation: 8 }
				}
			})
	},
	{
		id: 'precision',
		label: 'Precision duel',
		description:
			'Local coordinate planes, rotation allowed, fine placement precision (1/32) and hidden exact coordinates.',
		build: () =>
			createSoloConfig({
				seed: 'precision-duel',
				loadout: ['sniper', 'basic', 'arc', 'spray', 'sniper'],
				names: ['Marksman', 'Apprentice'],
				rules: {
					maxGraphersPerPlayer: 5,
					grapherHealth: 2,
					targetHitRadius: 0.8,
					coordinates: {
						mode: 'local',
						allowRotation: true,
						showAxes: true,
						showGrid: true,
						gridSpacing: 0.5,
						labels: true
					},
					precision: { denominator: 32, showCoordinates: false },
					turns: { mode: 'round-robin', concurrentPlayers: 1, timePerTurnSeconds: 90 },
					selection: 'manual',
					cooldownMultiplier: 0.5,
					scoring: { baseHitPoints: 12, precisionBonusMax: 18, roundingDigits: 1 },
					obstacles: {
						enabled: false,
						arrangement: 'none',
						count: 0,
						minSize: 3,
						maxSize: 6,
						durability: 3,
						indestructible: false,
						punchThrough: false,
						sectionSize: 1.25
					},
					placement: { mode: 'auto', distribution: 'min-separation', minSeparation: 10 }
				}
			})
	},
	{
		id: 'obstacle',
		label: 'Obstacle arena',
		description: 'A fortified map with destructible cover, tougher graphers and spray/arc loadouts.',
		build: () =>
			createSoloConfig({
				seed: 'obstacle-arena',
				loadout: ['spray', 'arc', 'basic', 'buzzer', 'sniper'],
				rules: {
					maxGraphersPerPlayer: 5,
					grapherHealth: 3,
					turns: { mode: 'round-robin', concurrentPlayers: 1, timePerTurnSeconds: 75 },
					obstacles: {
						enabled: true,
						arrangement: 'fortress',
						count: 6,
						minSize: 3,
						maxSize: 6,
						durability: 4,
						indestructible: false,
						punchThrough: false,
						sectionSize: 1.25
					},
					placement: { mode: 'auto', distribution: 'min-separation', minSeparation: 8 }
				}
			})
	},
	{
		id: 'ffa',
		label: 'Free-for-all',
		description: 'Four players, no turns and no turn timer. Cooldowns are the only limiter.',
		build: () =>
			createSoloConfig({
				seed: 'ffa-brawl',
				humanCount: 1,
				cpuCount: 3,
				names: ['You', 'Vector', 'Tangent', 'Asymptote'],
				cpuDifficulty: 'sharp',
				rules: {
					maxGraphersPerPlayer: 4,
					grapherHealth: 1,
					turns: { mode: 'ffa', concurrentPlayers: 1, timePerTurnSeconds: 60 },
					selection: 'manual',
					cooldownMultiplier: 1.5,
					placement: { mode: 'auto', distribution: 'even', minSeparation: 7 }
				}
			})
	}
];

export function buildPreset(id: string): MatchConfig {
	const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0];
	return preset.build();
}

export const DEFAULT_CONFIG: MatchConfig = PRESETS[0].build();
