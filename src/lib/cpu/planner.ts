/**
 * CPU planner.
 *
 * Observe (only public information) -> find available graphers -> generate
 * candidates -> validate and simulate them with the real engine -> choose.
 * The selected action is a normal `submit-attack` action: the authority applies
 * it exactly as it would a human's.
 */

import type { AttackRecord, GameRules, Grapher, MatchState, SubmitAttackAction } from '../game/types';
import { createRng } from '../game/rng';
import { cooldownApplies, cooldownDurationMs } from '../game/rules';
import { findPlayer, isPlayerActingNow, previewSelectedGrapher, submitAttack } from '../game/state';
import { frameForGrapher } from '../math/transforms';
import { generateCandidates, perceivedTargets } from './candidate-generator';
import { difficultyProfile } from './difficulty';
import { scoreAttackResult } from './evaluator';
import type { CandidateScore } from './evaluator';

export interface CpuDecision {
	action: SubmitAttackAction;
	attack?: AttackRecord;
	score: CandidateScore;
	strategy: string;
}

function readyGraphers(state: MatchState, playerId: string, now: number): Grapher[] {
	const rules = state.rules;
	return state.graphers.filter((g) => {
		if (g.ownerId !== playerId || !g.alive || g.health <= 0) return false;
		if (rules.selection !== 'manual') return true;
		if (!cooldownApplies(rules)) return true;
		return g.cooldownUntil === null || g.cooldownUntil <= now;
	});
}

export function planCpuAttack(
	state: MatchState,
	playerId: string,
	now: number
): CpuDecision | null {
	if (state.phase !== 'running') return null;
	const player = findPlayer(state, playerId);
	if (!player || player.kind !== 'cpu' || !player.alive) return null;
	if (!isPlayerActingNow(state, playerId)) return null;

	const profile = difficultyProfile(player.cpuDifficulty);
	const rng = createRng(
		[
			state.seed,
			'cpu',
			playerId,
			state.turn.batchNumber,
			state.attacks.length,
			now.toString()
		].join(':')
	);

	let graphers: Grapher[];
	if (state.rules.selection === 'manual') {
		graphers = readyGraphers(state, playerId, now);
	} else {
		const selected = previewSelectedGrapher(state, playerId);
		graphers = selected ? [selected] : [];
	}
	if (graphers.length === 0) return null;

	interface Option {
		action: SubmitAttackAction;
		attack?: AttackRecord;
		score: CandidateScore;
		strategy: string;
	}
	const options: Option[] = [];
	const perGrapher = Math.max(4, Math.floor(profile.candidateBudget / graphers.length));
	const totalBudget = profile.candidateBudget;

	for (const grapher of graphers) {
		if (options.length >= totalBudget) break;
		const frame = frameForGrapher(grapher, state.rules);
		const targets = perceivedTargets(state, playerId, grapher);
		if (targets.length === 0) continue;
		const candidates = generateCandidates({
			rules: state.rules,
			grapher,
			frame,
			targets,
			profile,
			rng,
			budget: Math.min(perGrapher, totalBudget - options.length)
		});
		for (const candidate of candidates) {
			const action: SubmitAttackAction = {
				type: 'submit-attack',
				playerId,
				grapherId: state.rules.selection === 'manual' ? grapher.id : undefined,
				components: candidate.components
			};
			const result = submitAttack(state, action, now, { commit: false });
			if (!result.ok) continue;
			options.push({
				action,
				attack: result.attack,
				score: scoreAttackResult(result, profile),
				strategy: candidate.strategy
			});
			if (options.length >= totalBudget) break;
		}
	}

	const valid = options.filter((o) => Number.isFinite(o.score.value));
	if (valid.length === 0) return null;
	valid.sort((a, b) => b.score.value - a.score.value);

	let chosen = valid[0];
	if (rng.next() > profile.chooseBest) {
		const window = Math.max(1, Math.min(profile.alternativeWindow, valid.length));
		chosen = valid[Math.floor(rng.next() * window)];
	}

	return {
		action: chosen.action,
		attack: chosen.attack,
		score: chosen.score,
		strategy: chosen.strategy
	};
}

/** Cosmetic think time; it never changes what is legal or the outcome. */
export function cpuThinkTimeMs(state: MatchState, playerId: string): number {
	const player = findPlayer(state, playerId);
	return difficultyProfile(player?.cpuDifficulty).thinkTimeMs;
}

/** Cooldown-aware availability used by the HUD for CPU players. */
export function cpuGraphersReady(state: MatchState, playerId: string, now: number): number {
	return readyGraphers(state, playerId, now).length;
}

export function cooldownForRules(rules: GameRules): number {
	return cooldownDurationMs(rules);
}
