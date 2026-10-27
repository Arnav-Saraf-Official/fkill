import { validateRules } from '$lib/game/configuration';
import { withRules, type DeepPartial } from '$lib/game/defaults';
import { createMatch, submitAttack, passTurn, tick } from '$lib/game/state';
import type {
	AttackComponentInput,
	GameRules,
	GrapherType,
	MatchConfig,
	MatchState,
	PlayerConfig,
	Vector2
} from '$lib/game/types';

export const T0 = 1_700_000_000_000;

export function makeRules(patch: DeepPartial<GameRules> = {}): GameRules {
	const result = validateRules(withRules(patch));
	if (!result.ok) throw new Error('invalid test rules: ' + result.errors.join('; '));
	return result.rules;
}

export interface DuelOptions {
	rules?: DeepPartial<GameRules>;
	loadoutA?: GrapherType[];
	loadoutB?: GrapherType[];
	posA?: Vector2[];
	posB?: Vector2[];
	rotationsA?: number[];
	rotationsB?: number[];
	seed?: string;
	cpuB?: boolean;
}

export function makeDuel(options: DuelOptions = {}): {
	config: MatchConfig;
	state: MatchState;
	rules: GameRules;
} {
	const posA = options.posA ?? [{ x: -15, y: 0 }];
	const posB = options.posB ?? [{ x: 10, y: 0 }];
	const loadoutA = options.loadoutA ?? ['basic'];
	const loadoutB = options.loadoutB ?? ['basic'];

	const patch: DeepPartial<GameRules> = {
		...(options.rules ?? {}),
		placement: {
			mode: 'manual',
			distribution: 'min-separation',
			minSeparation: 4,
			...(options.rules?.placement ?? {})
		}
	};
	if ((options.rules?.coordinates?.mode ?? 'shared') === 'local' && options.rotationsA) {
		// rotations are only read by the engine; nothing to patch here
	}
	const rules = makeRules(patch);

	const players: PlayerConfig[] = [
		{
			id: 'p1',
			name: 'Alpha',
			kind: 'human',
			colorIndex: 0,
			loadout: loadoutA
		},
		{
			id: 'p2',
			name: 'Beta',
			kind: options.cpuB === false ? 'human' : 'cpu',
			colorIndex: 1,
			cpuDifficulty: 'steady',
			loadout: loadoutB
		}
	];

	const rotations: Record<string, number[]> = {};
	if (options.rotationsA) rotations.p1 = options.rotationsA;
	if (options.rotationsB) rotations.p2 = options.rotationsB;

	const config: MatchConfig = {
		rules,
		setup: {
			seed: options.seed ?? 'test-seed',
			players,
			manualPlacements: { p1: posA, p2: posB },
			...(Object.keys(rotations).length ? { rotations } : {})
		}
	};
	const state = createMatch(config, T0);
	return { config, state, rules };
}

export function fire(
	state: MatchState,
	playerId: string,
	grapherId: string | undefined,
	components: AttackComponentInput[],
	now: number = state.now
) {
	return submitAttack(state, { type: 'submit-attack', playerId, grapherId, components }, now);
}

export function fn(expression: string): AttackComponentInput {
	return { kind: 'function', expression };
}

export function arc(
	center: Vector2,
	radius: number,
	startAngleDeg: number,
	sweepAngleDeg: number
): AttackComponentInput {
	return { kind: 'arc', center, radius, startAngleDeg, sweepAngleDeg };
}

export { passTurn, tick };
