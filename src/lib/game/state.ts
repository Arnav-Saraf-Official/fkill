/**
 * The authoritative match state machine.
 *
 * Everything that can change a match goes through `submitAttack`, `passTurn`,
 * `tick` or the connection helpers below. Actions return a structured result and
 * a new state; transient presentation effects are never stored here.
 *
 * Determinism: given the same state, action, `now` and seed, the result is
 * identical. Randomness (automatic random grapher selection, random scheduling)
 * is derived from the match seed and explicit counters.
 */

import type {
	ActionError,
	ActionResult,
	AttackComponentInput,
	AttackRecord,
	ComponentOutcome,
	GameEvent,
	GameEventType,
	GameRules,
	Grapher,
	MatchConfig,
	MatchState,
	Obstacle,
	Player,
	SubmitAttackAction,
	TargetHit,
	Vector2
} from './types';
import {
	createRng,
	randomId
} from './rng';
import { cooldownApplies, cooldownDurationMs, defaultLoadout } from './rules';
import { createObstacles, damageSection } from './obstacles';
import { generatePlacements, prepareManualPlacements } from './placement';
import { prepareAttack } from '../math/validation';
import { frameForGrapher } from '../math/transforms';
import { traceAttack, type TargetSnapshot } from './collision';
import { computePrecisionScore } from './scoring';
import {
	advanceBatch,
	createTurnState,
	currentBatchComplete,
	effectiveBatch,
	isPlayerOnTurn,
	markActed
} from './turn-scheduler';
import { evaluateOutcome } from './win-conditions';
import { validateMatchConfig } from './configuration';

const MAX_EVENTS = 1200;
const MAX_RECENT_SUBMITS = 40;

export function alivePlayerIds(state: MatchState): string[] {
	return state.players.filter((p) => p.alive).map((p) => p.id);
}

export function findPlayer(state: MatchState, playerId: string): Player | undefined {
	return state.players.find((p) => p.id === playerId);
}

export function graphersOf(state: MatchState, playerId: string): Grapher[] {
	return state.graphers.filter((g) => g.ownerId === playerId);
}

export function aliveGraphersOf(state: MatchState, playerId: string): Grapher[] {
	return state.graphers.filter((g) => g.ownerId === playerId && g.alive && g.health > 0);
}

export function cooldownRemainingMs(grapher: Grapher, now: number): number {
	if (grapher.cooldownUntil === null) return 0;
	return Math.max(0, grapher.cooldownUntil - now);
}

function pushEvent(
	state: MatchState,
	type: GameEventType,
	message: string,
	extra: Partial<Omit<GameEvent, 'id' | 'at' | 'type' | 'message'>> = {}
): void {
	state.events.push({ id: state.nextEventId++, at: state.now, type, message, ...extra });
	if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

/* ------------------------------------------------------------- match setup */

export interface CreateMatchResult {
	ok: boolean;
	state?: MatchState;
	errors?: string[];
	warnings?: string[];
}

export function createValidatedMatch(raw: unknown, now: number): CreateMatchResult {
	const validated = validateMatchConfig(raw);
	if (!validated.ok) return { ok: false, errors: validated.errors };
	return { ok: true, state: createMatch(validated.config, now), warnings: validated.warnings };
}

export function createMatch(config: MatchConfig, now: number): MatchState {
	const rules = config.rules;
	const setup = config.setup;
	const seed = setup.seed || 'fkill';
	const rng = createRng(`${seed}:match`);
	const obstacles = createObstacles(rules, seed, rng.fork('obstacles'));

	const warnings: string[] = [];
	let positions: Record<string, Vector2[]> = {};
	const targets = setup.players.map((p) => ({ playerId: p.id, count: p.loadout.length }));

	const manual = setup.manualPlacements;
	const allManualSupplied = setup.players.every((p) => Array.isArray(manual?.[p.id]));
	if (rules.placement.mode === 'manual' && manual && allManualSupplied) {
		const prepared = prepareManualPlacements(rules, setup, obstacles);
		if (prepared.ok) {
			positions = prepared.positions;
			warnings.push(...prepared.warnings);
		} else {
			warnings.push(...prepared.errors, 'Manual placement was rejected; generated placement used instead.');
			positions = generatePlacements(rules, targets, obstacles, rng.fork('placement')).positions;
		}
	} else {
		if (rules.placement.mode === 'manual') {
			warnings.push('Manual placement was selected but no complete layout was supplied; positions were generated.');
		}
		positions = generatePlacements(rules, targets, obstacles, rng.fork('placement')).positions;
	}

	const players: Player[] = setup.players.map((p) => ({
		id: p.id,
		name: p.name,
		kind: p.kind,
		colorIndex: p.colorIndex,
		cpuDifficulty: p.cpuDifficulty,
		score: 0,
		hits: 0,
		shots: 0,
		damageDealt: 0,
		graphersDestroyed: 0,
		obstacleSectionsDestroyed: 0,
		alive: true,
		connected: true
	}));

	const graphers: Grapher[] = [];
	for (const playerConfig of setup.players) {
		const list = positions[playerConfig.id] ?? [];
		playerConfig.loadout.forEach((type, index) => {
			const position = list[index] ?? { x: 0, y: 0 };
			const rotation = setup.rotations?.[playerConfig.id]?.[index] ?? 0;
			graphers.push({
				id: `g_${playerConfig.id}_${index}`,
				ownerId: playerConfig.id,
				type,
				position: { ...position },
				rotation,
				health: rules.grapherHealth,
				maxHealth: rules.grapherHealth,
				alive: true,
				cooldownUntil: null
			});
		});
	}

	const state: MatchState = {
		id: `m_${randomId()}`,
		seed,
		phase: 'running',
		rules,
		players,
		graphers,
		obstacles,
		turn: createTurnState(rules, players.map((p) => p.id), now, rng.fork('turn')),
		attacks: [],
		events: [],
		stats: {
			startedAt: now,
			finishedAt: null,
			batchCount: 1,
			attacks: 0
		},
		winnerIds: [],
		now,
		nextEventId: 1,
		nextAttackId: 1,
		autoSelectionCursor: Object.fromEntries(setup.players.map((p) => [p.id, 0])),
		recentSubmits: Object.fromEntries(setup.players.map((p) => [p.id, []]))
	};

	pushEvent(state, 'match-created', `Match "${seed}" created with ${players.length} players.`);
	pushEvent(state, 'match-started', `Match started. ${describeTurn(state)}`);
	pushEvent(state, 'turn-started', describeTurn(state), {
		data: { batch: state.turn.batchNumber }
	});
	for (const w of warnings) pushEvent(state, 'match-created', w);
	return state;
}

function describeTurn(state: MatchState): string {
	if (state.turn.mode === 'ffa') return 'Free-for-all: every player may fire at any time.';
	const names = state.turn.activePlayerIds
		.map((id) => state.players.find((p) => p.id === id)?.name ?? id)
		.join(', ');
	return `Batch ${state.turn.batchNumber}: ${names} to act.`;
}

/* --------------------------------------------------------- grapher selection */

export type SelectionResult =
	| { ok: true; grapher: Grapher; automatic: boolean }
	| { ok: false; error: ActionError };

export function selectGrapherForAttack(
	state: MatchState,
	player: Player,
	requestedId: string | undefined,
	_now: number
): SelectionResult {
	const own = aliveGraphersOf(state, player.id);
	if (own.length === 0) {
		return {
			ok: false,
			error: { code: 'grapher-unavailable', message: 'You have no surviving graphers.' }
		};
	}
	if (requestedId) {
		const grapher = own.find((g) => g.id === requestedId);
		if (!grapher) {
			return {
				ok: false,
				error: {
					code: 'unknown-grapher',
					message: 'That grapher is not available to you (destroyed, cooling down or not yours).'
				}
			};
		}
		return { ok: true, grapher, automatic: false };
	}
	if (state.rules.selection === 'manual') {
		return {
			ok: false,
			error: { code: 'bad-action', message: 'Select one of your graphers before firing.' }
		};
	}
	const cursor = state.autoSelectionCursor[player.id] ?? 0;
	if (state.rules.selection === 'auto-random') {
		const rng = createRng(`${state.seed}:select:${player.id}:${cursor}`);
		const index = rng.int(own.length);
		return { ok: true, grapher: own[index], automatic: true };
	}
	const grapher = own[cursor % own.length];
	return { ok: true, grapher, automatic: true };
}

/** Which grapher would fire right now, for the UI. Never mutates. */
export function previewSelectedGrapher(state: MatchState, playerId: string): Grapher | null {
	const player = findPlayer(state, playerId);
	if (!player) return null;
	const selection = selectGrapherForAttack(state, player, undefined, state.now);
	if (selection.ok) return selection.grapher;
	const own = aliveGraphersOf(state, playerId);
	return own[0] ?? null;
}

/* -------------------------------------------------------- attack submission */

function normaliseComponents(raw: unknown): AttackComponentInput[] | null {
	if (!Array.isArray(raw)) return null;
	if (raw.length === 0 || raw.length > 8) return null;
	const out: AttackComponentInput[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) return null;
		const c = entry as Record<string, unknown>;
		if (c.kind === 'arc' || (c.center && c.radius !== undefined)) {
			const center = c.center as Record<string, unknown> | undefined;
			out.push({
				kind: 'arc',
				center: {
					x: Number(center?.x),
					y: Number(center?.y)
				},
				radius: Number(c.radius),
				startAngleDeg: Number(c.startAngleDeg),
				sweepAngleDeg: Number(c.sweepAngleDeg)
			});
		} else {
			out.push({ kind: 'function', expression: typeof c.expression === 'string' ? c.expression : '' });
		}
	}
	return out;
}

function deadlinePassed(state: MatchState, now: number): boolean {
	return state.turn.endsAt !== null && now >= state.turn.endsAt;
}

function checkRateLimit(state: MatchState, playerId: string, now: number): ActionError | null {
	if (state.turn.mode !== 'ffa') return null;
	const limits = state.rules.limits;
	const history = (state.recentSubmits[playerId] ?? []).filter(
		(t) => now - t < limits.submitWindowMs
	);
	state.recentSubmits[playerId] = history;
	const last = history[history.length - 1];
	if (last !== undefined && now - last < limits.minSubmitIntervalMs) {
		return {
			code: 'rate-limited',
			message: `Firing too quickly — wait ${Math.ceil((limits.minSubmitIntervalMs - (now - last)) / 100) / 10}s.`
		};
	}
	if (history.length >= limits.maxSubmitsPerWindow) {
		return {
			code: 'rate-limited',
			message: `Free-for-all flood protection: at most ${limits.maxSubmitsPerWindow} attacks per ${Math.round(limits.submitWindowMs / 1000)}s.`
		};
	}
	return null;
}

function findSection(
	state: MatchState,
	obstacleId: string,
	sectionId: string
): { obstacle: Obstacle; section: Obstacle['sections'][number] } | null {
	const obstacle = state.obstacles.find((o) => o.id === obstacleId);
	if (!obstacle) return null;
	const section = obstacle.sections.find((s) => s.id === sectionId);
	if (!section) return null;
	return { obstacle, section };
}

export interface SubmitOptions {
	/** CPU simulation sets this false to evaluate a candidate without side effects. */
	commit?: boolean;
}

export function submitAttack(
	state: MatchState,
	action: SubmitAttackAction,
	now: number,
	options: SubmitOptions = {}
): ActionResult {
	const commit = options.commit !== false;
	if (!Number.isFinite(now)) now = state.now;
	if (state.phase !== 'running') {
		return { ok: false, state, error: { code: 'match-finished', message: 'The match is over.' } };
	}
	if (deadlinePassed(state, now)) {
		return {
			ok: false,
			state,
			error: {
				code: 'turn-ended',
				message: 'The submission deadline for this batch has passed.'
			}
		};
	}

	const next = structuredClone(state);
	next.now = now;
	const player = findPlayer(next, action.playerId);
	if (!player) {
		return {
			ok: false,
			state,
			error: { code: 'unknown-player', message: 'Unknown player.' }
		};
	}
	if (!player.alive || aliveGraphersOf(next, player.id).length === 0) {
		return {
			ok: false,
			state,
			error: { code: 'grapher-unavailable', message: 'You have been eliminated.' }
		};
	}

	const aliveIds = alivePlayerIds(next);
	if (!isPlayerOnTurn(next.turn, aliveIds, player.id)) {
		return {
			ok: false,
			state,
			error: {
				code: 'not-your-turn',
				message: next.turn.mode === 'ffa' ? 'You cannot act right now.' : 'It is not your turn.'
			}
		};
	}
	if (next.turn.mode !== 'ffa' && next.turn.actedPlayerIds.includes(player.id)) {
		return {
			ok: false,
			state,
			error: { code: 'not-your-turn', message: 'You have already acted this batch.' }
		};
	}

	const rateError = checkRateLimit(next, player.id, now);
	if (rateError) return { ok: false, state, error: rateError };

	const components = normaliseComponents(action.components);
	if (!components) {
		return {
			ok: false,
			state,
			error: { code: 'invalid-attack', message: 'The attack payload is malformed.' }
		};
	}

	const selection = selectGrapherForAttack(next, player, action.grapherId, now);
	if (!selection.ok) return { ok: false, state, error: selection.error };
	const grapher = selection.grapher;

	if (
		next.rules.selection === 'manual' &&
		cooldownApplies(next.rules) &&
		cooldownRemainingMs(grapher, now) > 0
	) {
		return {
			ok: false,
			state,
			error: {
				code: 'grapher-unavailable',
				message: `${labelOf(next.rules, grapher.type)} is cooling down for ${(cooldownRemainingMs(grapher, now) / 1000).toFixed(1)}s.`
			}
		};
	}

	const def = next.rules.grapherTypes[grapher.type];
	const frame = frameForGrapher(grapher, next.rules);
	const prepared = prepareAttack(next.rules, grapher.type, frame, components);
	if (!prepared.ok) {
		const componentErrors = prepared.issues
			.filter((i) => i.componentIndex !== undefined)
			.map((i) => ({ componentIndex: i.componentIndex ?? 0, message: i.message }));
		pushEvent(next, 'attack-rejected', `${player.name}'s ${def.label} attack was rejected: ${prepared.issues[0].message}`, {
			playerId: player.id,
			data: { reasons: prepared.issues.map((i) => i.message).join(' | ') }
		});
		if (!commit) return { ok: false, state: next, error: { code: 'invalid-attack', message: prepared.issues[0].message, componentErrors } };
		return {
			ok: false,
			state: next,
			error: {
				code: 'invalid-attack',
				message: prepared.issues[0].message,
				componentErrors
			}
		};
	}

	const targets: TargetSnapshot[] = next.graphers
		.filter((g) => g.ownerId !== player.id && g.alive && g.health > 0)
		.map((g) => ({
			id: g.id,
			ownerId: g.ownerId,
			position: { ...g.position },
			radius: next.rules.targetHitRadius
		}));

	const trace = traceAttack({
		rules: next.rules,
		components: prepared.components,
		attackerPosition: grapher.position,
		targets,
		obstacles: next.obstacles,
		obstacleDamage: def.damageToObstacles
	});

	let totalScore = 0;
	let totalDamage = 0;
	let hitCount = 0;
	const destroyedTargets: string[] = [];
	const outcomes: ComponentOutcome[] = [];

	for (const componentTrace of trace.components) {
		const preparedComponent = prepared.components[componentTrace.componentIndex];
		const componentOutcome: ComponentOutcome = {
			componentIndex: componentTrace.componentIndex,
			kind: preparedComponent.kind,
			outcome: 'miss',
			targetsHit: [],
			obstaclesHit: [],
			damage: 0,
			score: 0
		};
		if (preparedComponent.kind === 'function') {
			componentOutcome.expression = preparedComponent.expression;
		} else {
			componentOutcome.arc = preparedComponent.input;
		}

		for (const hit of componentTrace.targetHits) {
			const target = next.graphers.find((g) => g.id === hit.targetId);
			// A target destroyed by an earlier component of the same spray is no
			// longer a valid target for later components.
			if (!target || target.health <= 0) continue;
			const damage = def.damageToGraphers;
			const scored = computePrecisionScore(next.rules, hit.distance, hit.hitRadius);
			target.health = Math.max(0, target.health - damage);
			const destroyed = target.health <= 0;
			if (destroyed) {
				target.alive = false;
				destroyedTargets.push(target.id);
			}
			const record: TargetHit = {
				targetId: target.id,
				targetOwnerId: target.ownerId,
				componentIndex: componentTrace.componentIndex,
				distance: hit.distance,
				hitRadius: hit.hitRadius,
				damage,
				score: scored.score,
				precisionRatio: scored.precisionRatio,
				destroyed
			};
			componentOutcome.targetsHit.push(record);
			componentOutcome.damage += damage;
			componentOutcome.score += scored.score;
			hitCount++;
			totalDamage += damage;
			totalScore += scored.score;
		}

		for (const obstacleHit of componentTrace.obstacleHits) {
			const found = findSection(next, obstacleHit.obstacleId, obstacleHit.sectionId);
			if (!found || found.section.destroyed) continue;
			const destroyed = damageSection(
				found.section,
				obstacleHit.damage,
				found.obstacle.indestructible
			);
			componentOutcome.obstaclesHit.push({
				obstacleId: obstacleHit.obstacleId,
				sectionId: obstacleHit.sectionId,
				componentIndex: componentTrace.componentIndex,
				damage: obstacleHit.damage,
				destroyed
			});
			if (destroyed) {
				player.obstacleSectionsDestroyed++;
				pushEvent(
					next,
					'obstacle-destroyed',
					`${player.name}'s ${def.label} opened a gap in an obstacle.`,
					{ playerId: player.id, data: { obstacleId: obstacleHit.obstacleId } }
				);
			}
		}

		if (componentOutcome.targetsHit.length > 0) componentOutcome.outcome = 'hit';
		else if (componentTrace.blocked) {
			componentOutcome.outcome = 'blocked';
			componentOutcome.blockedBy = componentTrace.blockedBy;
		}
		outcomes.push(componentOutcome);
	}

	const attack: AttackRecord = {
		id: `a_${next.nextAttackId++}`,
		playerId: player.id,
		grapherId: grapher.id,
		grapherType: grapher.type,
		batchNumber: next.turn.batchNumber,
		submittedAt: now,
		components: outcomes,
		totalDamage,
		totalScore,
		targetsHit: hitCount,
		destroyedTargetIds: destroyedTargets
	};
	next.attacks.push(attack);
	next.stats.attacks++;
	player.score = Math.round((player.score + totalScore) * 1000) / 1000;
	player.hits += hitCount;
	player.shots += 1;
	player.damageDealt += totalDamage;
	player.graphersDestroyed += destroyedTargets.length;

	const summaryParts: string[] = [];
	summaryParts.push(`${hitCount} target${hitCount === 1 ? '' : 's'} hit`);
	summaryParts.push(`${totalDamage} damage`);
	summaryParts.push(`+${totalScore} pts`);
	if (outcomes.every((o) => o.outcome === 'blocked')) summaryParts.push('blocked by cover');
	pushEvent(
		next,
		'attack-accepted',
		`${player.name} fired ${def.label}: ${summaryParts.join(', ')}.`,
		{
			playerId: player.id,
			attackId: attack.id,
			data: { grapherId: grapher.id, components: outcomes.length }
		}
	);

	// Cooldowns are per grapher and only for manual selection.
	if (next.rules.selection === 'manual') {
		const duration = cooldownDurationMs(next.rules);
		grapher.cooldownUntil = duration > 0 ? now + duration : null;
	} else {
		grapher.cooldownUntil = null;
		next.autoSelectionCursor[player.id] = (next.autoSelectionCursor[player.id] ?? 0) + 1;
	}

	if (next.turn.mode === 'ffa') {
		next.recentSubmits[player.id] = [...(next.recentSubmits[player.id] ?? []), now].slice(
			-MAX_RECENT_SUBMITS
		);
	}

	for (const targetId of destroyedTargets) {
		const target = next.graphers.find((g) => g.id === targetId);
		if (!target) continue;
		const owner = findPlayer(next, target.ownerId);
		pushEvent(
			next,
			'grapher-destroyed',
			`${owner?.name ?? 'A player'}'s ${labelOf(next.rules, target.type)} was destroyed by ${player.name}.`,
			{ playerId: player.id, attackId: attack.id, data: { grapherId: targetId } }
		);
	}

	if (commit) {
		if (next.turn.mode !== 'ffa') {
			markActed(next.turn, player.id);
		}
		afterCombat(next, now);
	}

	return { ok: true, state: next, attack };
}

/** Elimination checks, win detection and turn advancement. */
function afterCombat(state: MatchState, now: number): void {
	for (const player of state.players) {
		if (!player.alive) continue;
		if (aliveGraphersOf(state, player.id).length === 0) {
			player.alive = false;
			pushEvent(state, 'player-eliminated', `${player.name} has been eliminated.`, {
				playerId: player.id
			});
		}
	}
	const aliveIds = alivePlayerIds(state);
	if (state.turn.mode !== 'ffa') {
		state.turn.activePlayerIds = effectiveBatch(state.turn, aliveIds);
		if (currentBatchComplete(state.turn, aliveIds, now)) {
			advanceBatch(state.turn, state.rules, aliveIds, now, createRng(`${state.seed}:turn:${state.turn.batchNumber}`));
			state.stats.batchCount = state.turn.batchNumber;
			if (aliveIds.length > 0) {
				pushEvent(state, 'turn-started', describeTurn(state), {
					data: { batch: state.turn.batchNumber }
				});
			}
		}
	} else {
		state.turn.activePlayerIds = [...aliveIds];
	}
	checkOutcome(state, now);
}

function checkOutcome(state: MatchState, now: number): void {
	if (state.phase !== 'running') return;
	const outcome = evaluateOutcome(state.players, state.graphers);
	if (!outcome.finished) return;
	state.phase = 'finished';
	state.winnerIds = outcome.winnerIds;
	state.stats.finishedAt = now;
	const winners = outcome.winnerIds
		.map((id) => state.players.find((p) => p.id === id)?.name ?? id)
		.join(' & ');
	pushEvent(
		state,
		'match-finished',
		`Match over. Winner: ${winners}${outcome.reason === 'tiebreak' ? ' (tie-break)' : ''}.`,
		{ data: { reason: outcome.reason ?? 'none' } }
	);
}

function labelOf(rules: GameRules, type: Grapher['type']): string {
	return rules.grapherTypes[type].label;
}

/* --------------------------------------------------------------- turn control */

export function passTurn(state: MatchState, playerId: string, now: number): ActionResult {
	if (state.phase !== 'running') {
		return { ok: false, state, error: { code: 'match-finished', message: 'The match is over.' } };
	}
	const next = structuredClone(state);
	next.now = now;
	const player = findPlayer(next, playerId);
	if (!player) {
		return { ok: false, state, error: { code: 'unknown-player', message: 'Unknown player.' } };
	}
	if (next.turn.mode === 'ffa') {
		return {
			ok: false,
			state,
			error: { code: 'bad-action', message: 'There are no turns to pass in Free-for-All.' }
		};
	}
	if (!isPlayerOnTurn(next.turn, alivePlayerIds(next), playerId)) {
		return { ok: false, state, error: { code: 'not-your-turn', message: 'It is not your turn.' } };
	}
	if (next.turn.actedPlayerIds.includes(playerId)) {
		return { ok: false, state, error: { code: 'not-your-turn', message: 'You have already acted.' } };
	}
	markActed(next.turn, playerId);
	pushEvent(next, 'turn-ended', `${player.name} passed.`, { playerId });
	afterCombat(next, now);
	return { ok: true, state: next };
}

/**
 * Advance authoritative timers. Safe to call repeatedly; only mutates when a
 * deadline, disconnection or completion actually changes the match.
 */
export function tick(state: MatchState, now: number): MatchState {
	if (state.phase !== 'running') return state;
	if (!Number.isFinite(now)) now = state.now;
	const aliveIds = alivePlayerIds(state);
	const timedOut =
		state.turn.mode !== 'ffa' && state.turn.endsAt !== null && now >= state.turn.endsAt;
	const disconnectedActive =
		state.turn.mode !== 'ffa' &&
		effectiveBatch(state.turn, aliveIds).some((id) => {
			const p = findPlayer(state, id);
			return p !== undefined && !p.connected && !state.turn.actedPlayerIds.includes(id);
		});
	const outcome = evaluateOutcome(state.players, state.graphers);
	if (!timedOut && !disconnectedActive && !outcome.finished) return state;

	const next = structuredClone(state);
	next.now = now;
	if (next.turn.mode !== 'ffa') {
		for (const id of effectiveBatch(next.turn, aliveIds)) {
			const p = findPlayer(next, id);
			if (p && !p.connected) {
				markActed(next.turn, id);
				pushEvent(next, 'player-disconnected', `${p.name} is disconnected; their turn was skipped.`, {
					playerId: id
				});
			}
		}
		if (currentBatchComplete(next.turn, aliveIds, now)) {
			if (timedOut) {
				pushEvent(next, 'turn-ended', `Batch ${next.turn.batchNumber} timed out.`);
			}
			advanceBatch(
				next.turn,
				next.rules,
				aliveIds,
				now,
				createRng(`${next.seed}:turn:${next.turn.batchNumber}`)
			);
			next.stats.batchCount = next.turn.batchNumber;
			if (aliveIds.length > 0) {
				pushEvent(next, 'turn-started', describeTurn(next), {
					data: { batch: next.turn.batchNumber }
				});
			}
		}
	}
	checkOutcome(next, now);
	return next;
}

export function setPlayerConnected(
	state: MatchState,
	playerId: string,
	connected: boolean
): MatchState {
	const next = structuredClone(state);
	const player = findPlayer(next, playerId);
	if (!player) return state;
	if (player.connected === connected) return state;
	player.connected = connected;
	pushEvent(
		next,
		connected ? 'player-reconnected' : 'player-disconnected',
		`${player.name} ${connected ? 'reconnected' : 'disconnected'}.`,
		{ playerId }
	);
	return next;
}

/** Remove a player mid-match (lobby or match). Their graphers are destroyed. */
export function removePlayer(state: MatchState, playerId: string, now: number): MatchState {
	const next = structuredClone(state);
	const player = findPlayer(next, playerId);
	if (!player) return state;
	next.now = now;
	for (const g of next.graphers) {
		if (g.ownerId === playerId && g.alive) {
			g.alive = false;
			g.health = 0;
		}
	}
	player.alive = false;
	player.connected = false;
	pushEvent(next, 'player-left', `${player.name} left the match.`, { playerId });
	next.turn.activePlayerIds = next.turn.activePlayerIds.filter((id) => id !== playerId);
	next.turn.actedPlayerIds = next.turn.actedPlayerIds.filter((id) => id !== playerId);
	next.turn.bag = next.turn.bag.filter((id) => id !== playerId);
	afterCombat(next, now);
	return next;
}

/* ----------------------------------------------------------------- utilities */

/** Grapher counts used by the HUD and by CPU target assessment. */
export function grapherSummary(state: MatchState, playerId: string): { alive: number; total: number; health: number } {
	const list = graphersOf(state, playerId);
	return {
		alive: list.filter((g) => g.alive && g.health > 0).length,
		total: list.length,
		health: list.reduce((sum, g) => sum + Math.max(0, g.health), 0)
	};
}

export function isPlayerActingNow(state: MatchState, playerId: string): boolean {
	if (state.phase !== 'running') return false;
	const player = findPlayer(state, playerId);
	if (!player || !player.alive) return false;
	return isPlayerOnTurn(state.turn, alivePlayerIds(state), playerId);
}

export function defaultPlayerLoadout(rules: GameRules, count = 5): Grapher['type'][] {
	return defaultLoadout(rules, Math.min(count, rules.maxGraphersPerPlayer));
}
