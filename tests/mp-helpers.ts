import { withRules, type DeepPartial } from '$lib/game/defaults';
import type { MatchConfig } from '$lib/game/types';
import { validateRules } from '$lib/game/configuration';

/**
 * Multiplayer defaults used by tests: shared plane, one sniper per player so any
 * target on the plane can be reached, no obstacles, short cooldown.
 */
export function createPresetConfig(patch: DeepPartial<MatchConfig['rules']> = {}): MatchConfig {
	const base = withRules({
		maxGraphersPerPlayer: 1,
		grapherHealth: 1,
		targetHitRadius: 1.1,
		selection: 'manual',
		cooldownMultiplier: 1,
		turns: { mode: 'round-robin', concurrentPlayers: 1, timePerTurnSeconds: 60 },
		placement: { mode: 'auto', distribution: 'min-separation', minSeparation: 6 },
		// Give the lobby's default Basic grapher the full plane so a horizontal
		// line through any target is legal in these tests.
		grapherTypes: { basic: { domainRangeSpan: 50 } }
	});
	const rules = withRules(patch, base);
	const validated = validateRules(rules);
	if (!validated.ok) throw new Error(validated.errors.join('; '));
	return {
		rules: validated.rules,
		setup: {
		seed: 'mp-test',
		players: [
			{
				id: 'seed-host',
				name: 'Host',
				kind: 'human',
				colorIndex: 0,
				loadout: ['basic']
			},
			{
				id: 'seed-guest',
				name: 'Guest',
				kind: 'human',
				colorIndex: 1,
				loadout: ['basic']
			}
		]
		}
	};
}
