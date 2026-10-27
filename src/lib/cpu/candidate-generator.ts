/**
 * CPU candidate generation.
 *
 * The CPU aims with mathematics, not with privileged data: it receives the same
 * positions a human can see (grid-snapped when exact coordinates are hidden),
 * builds curves that pass through those points in the firing grapher's own
 * coordinate frame, and lets the real validator reject anything illegal.
 *
 * Strategies: horizontal lines, sloped lines, quadratics, sine curves (Buzzer),
 * lines through two targets, stacked Spray components and circular arcs.
 */

import type {
	AttackComponentInput,
	GameRules,
	Grapher,
	GrapherType,
	Vector2
} from '../game/types';
import type { CoordinateFrame } from '../math/transforms';
import { attackWindow, worldToLocal } from '../math/transforms';
import { degToRad, distance } from '../math/geometry';
import type { Rng } from '../game/rng';
import type { DifficultyProfile } from './difficulty';

export interface PerceivedTarget {
	id: string;
	ownerId: string;
	position: Vector2;
	health: number;
	maxHealth: number;
	type: GrapherType;
	worldDistance: number;
}

export interface CandidateContext {
	rules: GameRules;
	grapher: Grapher;
	frame: CoordinateFrame;
	targets: PerceivedTarget[];
	profile: DifficultyProfile;
	rng: Rng;
	budget: number;
}

export interface AttackCandidate {
	components: AttackComponentInput[];
	targetIds: string[];
	strategy: string;
}

function fmt(n: number): string {
	if (!Number.isFinite(n)) return '0';
	const rounded = Math.abs(n) < 1e-9 ? 0 : Number(n.toFixed(4));
	return String(rounded);
}

function fn(expression: string): AttackComponentInput {
	return { kind: 'function', expression: `y = ${expression}` };
}

function inWindow(window: { minX: number; maxX: number; minY: number; maxY: number }, p: Vector2): boolean {
	return p.x >= window.minX && p.x <= window.maxX && p.y >= window.minY && p.y <= window.maxY;
}

/** Weighted, deterministic target ordering. */
export function rankTargets(
	targets: PerceivedTarget[],
	profile: DifficultyProfile,
	rng: Rng
): PerceivedTarget[] {
	const scored = targets.map((t) => {
		const healthRatio = t.maxHealth > 0 ? t.health / t.maxHealth : 1;
		const finish = (1 - healthRatio) * 2.2 * profile.finishPreference;
		const proximity = 1 / (1 + t.worldDistance / 12);
		const randomness = rng.range(0, 0.25);
		return { t, score: finish + proximity + randomness };
	});
	scored.sort((a, b) => b.score - a.score);
	return scored.map((s) => s.t);
}

export function generateCandidates(ctx: CandidateContext): AttackCandidate[] {
	const { rules, grapher, frame, targets, profile, rng } = ctx;
	if (targets.length === 0) return [];
	const def = rules.grapherTypes[grapher.type];
	const window = attackWindow(rules, grapher.type);
	const ranked = rankTargets(targets, profile, rng);
	const candidates: AttackCandidate[] = [];
	const seen = new Set<string>();

	const push = (components: AttackComponentInput[], targetIds: string[], strategy: string) => {
		if (components.length === 0) return;
		const key = JSON.stringify(components);
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push({ components, targetIds, strategy });
	};

	const aimPoint = (target: PerceivedTarget): { local: Vector2; target: PerceivedTarget; jittered: boolean } | null => {
		const local = worldToLocal(frame, target.position);
		const jitter = profile.aimJitter;
		const jx = jitter > 0 ? rng.range(-jitter, jitter) : 0;
		const jy = jitter > 0 ? rng.range(-jitter, jitter) : 0;
		const aim = { x: local.x + jx, y: local.y + jy };
		if (!inWindow(window, aim)) {
			// Out of range for this grapher: try the exact point once, otherwise give up.
			return inWindow(window, local) && (jx !== 0 || jy !== 0)
				? { local, target, jittered: false }
				: null;
		}
		return { local: aim, target, jittered: jx !== 0 || jy !== 0 };
	};

	const pickTargets = (count: number): PerceivedTarget[] => {
		const out: PerceivedTarget[] = [];
		const pool = ranked.slice();
		for (let i = 0; i < count && pool.length > 0; i++) {
			let index = 0;
			// Lower tiers are less consistent about picking the best target.
			if (rng.next() > profile.chooseBest) index = Math.floor(rng.next() * pool.length);
			out.push(pool.splice(index, 1)[0]);
		}
		return out;
	};

	const horizontal = (): AttackCandidate | null => {
		const target = pickTargets(1)[0];
		const aim = aimPoint(target);
		if (!aim) return null;
		return {
			components: [fn(fmt(aim.local.y))],
			targetIds: [target.id],
			strategy: 'horizontal'
		};
	};

	const sloped = (slopeChoices = [0.15, -0.15, 0.4, -0.4, 0.9, -0.9, 1.8, -1.8]): AttackCandidate | null => {
		const target = pickTargets(1)[0];
		const aim = aimPoint(target);
		if (!aim) return null;
		const m = slopeChoices[Math.floor(rng.next() * slopeChoices.length)];
		return {
			components: [
				fn(`(${fmt(m)})*(x - (${fmt(aim.local.x)})) + (${fmt(aim.local.y)})`)
			],
			targetIds: [target.id],
			strategy: 'line'
		};
	};

	const quadratic = (): AttackCandidate | null => {
		const target = pickTargets(1)[0];
		const aim = aimPoint(target);
		if (!aim) return null;
		const a = [0.05, -0.05, 0.15, -0.15, 0.4, -0.4][Math.floor(rng.next() * 6)];
		return {
			components: [
				fn(`(${fmt(a)})*(x - (${fmt(aim.local.x)}))^2 + (${fmt(aim.local.y)})`)
			],
			targetIds: [target.id],
			strategy: 'quadratic'
		};
	};

	const sine = (): AttackCandidate | null => {
		const target = pickTargets(1)[0];
		const aim = aimPoint(target);
		if (!aim) return null;
		const k = [1, 2, 3, 4, 5, 6, 8][Math.floor(rng.next() * 7)];
		const a = [0.5, 1, 2, 3][Math.floor(rng.next() * 4)];
		const phase = aim.local.x * k;
		const c = aim.local.y - a * Math.sin(phase);
		return {
			components: [fn(`(${fmt(a)})*sin(${fmt(k)}*x - (${fmt(phase)})) + (${fmt(c)})`)],
			targetIds: [target.id],
			strategy: 'sine'
		};
	};

	const twoTargets = (): AttackCandidate | null => {
		const picks = pickTargets(2);
		if (picks.length < 2) return null;
		const a = aimPoint(picks[0]);
		const b = aimPoint(picks[1]);
		if (!a || !b) return null;
		const dx = b.local.x - a.local.x;
		if (Math.abs(dx) < 0.4) return null;
		const m = (b.local.y - a.local.y) / dx;
		return {
			components: [
				fn(`(${fmt(m)})*(x - (${fmt(a.local.x)})) + (${fmt(a.local.y)})`)
			],
			targetIds: [a.target.id, b.target.id],
			strategy: 'multi-target-line'
		};
	};

	const spray = (): AttackCandidate | null => {
		const maxFunctions = def.maxFunctions ?? 3;
		const picks = pickTargets(profile.stackSpray ? 1 : maxFunctions);
		if (picks.length === 0) return null;
		const components: AttackComponentInput[] = [];
		const ids: string[] = [];
		const pool = profile.stackSpray ? [picks[0], picks[0], picks[0]] : picks;
		for (const target of pool) {
			const aim = aimPoint(target);
			if (!aim) continue;
			const m = [0.15, -0.25, 0.5][components.length % 3];
			components.push(fn(`(${fmt(m)})*(x - (${fmt(aim.local.x)})) + (${fmt(aim.local.y)})`));
			if (!ids.includes(target.id)) ids.push(target.id);
		}
		if (components.length === 0) return null;
		return { components, targetIds: ids, strategy: 'spray' };
	};

	const arc = (): AttackCandidate | null => {
		const target = pickTargets(1)[0];
		const aim = aimPoint(target);
		if (!aim) return null;
		const maxRadius = def.maxArcRadius ?? 25;
		const maxSweep = def.maxArcSweepDegrees ?? 180;
		const strategy = rng.next();
		let center: Vector2;
		let radius: number;
		if (strategy < 0.4) {
			// Arc centred on the grapher's local origin, sweeping through the target.
			radius = Math.min(maxRadius, Math.hypot(aim.local.x, aim.local.y));
			center = { x: 0, y: 0 };
			if (radius < 0.5) return null;
		} else {
			radius = [4, 6, 9, 13, 18][Math.floor(rng.next() * 5)];
			const theta = rng.range(0, Math.PI * 2);
			center = {
				x: aim.local.x + Math.cos(theta) * radius,
				y: aim.local.y + Math.sin(theta) * radius
			};
		}
		if (!inWindow(window, center)) return null;
		radius = Math.min(radius, maxRadius);
		const startDeg = (Math.atan2(aim.local.y - center.y, aim.local.x - center.x) * 180) / Math.PI;
		const sweepChoices = [45, 70, 100, 130, 160].filter((s) => s <= maxSweep);
		const sweep = sweepChoices[Math.floor(rng.next() * sweepChoices.length)] * (rng.next() < 0.5 ? 1 : -1);
		return {
			components: [
				{
					kind: 'arc',
					center,
					radius: Number(radius.toFixed(3)),
					startAngleDeg: Number(startDeg.toFixed(3)),
					sweepAngleDeg: sweep
				}
			],
			targetIds: [target.id],
			strategy: 'arc'
		};
	};

	const strategies: (() => AttackCandidate | null)[] = [];
	if (def.attackMode === 'arc') {
		strategies.push(arc, arc, arc);
	} else if (def.attackMode === 'multi-function') {
		strategies.push(spray, spray, sloped, twoTargets);
	} else {
		strategies.push(horizontal, horizontal, sloped, sloped, quadratic);
		if (grapher.type === 'buzzer') strategies.push(sine, sine, horizontal);
		if (profile.multiTarget) strategies.push(twoTargets);
	}

	const budget = Math.max(1, ctx.budget);
	for (let i = 0; i < budget * 2 && candidates.length < budget; i++) {
		const strategy = strategies[Math.floor(rng.next() * strategies.length)];
		const candidate = strategy();
		if (candidate) push(candidate.components, candidate.targetIds, candidate.strategy);
	}
	return candidates;
}

/** Public information: target positions as the player's own client shows them. */
export function perceivedTargets(state: {
	rules: GameRules;
	graphers: Grapher[];
	players: { id: string; alive: boolean }[];
}, playerId: string, grapher: Grapher): PerceivedTarget[] {
	const rules = state.rules;
	const out: PerceivedTarget[] = [];
	for (const other of state.graphers) {
		if (other.ownerId === playerId || !other.alive || other.health <= 0) continue;
		const owner = state.players.find((p) => p.id === other.ownerId);
		if (owner && !owner.alive) continue;
		// When exact coordinates are hidden, everyone (including CPUs) sees the
		// marker snapped to the visible grid; the CPU never peeks at the truth.
		let position = other.position;
		if (!rules.precision.showCoordinates) {
			const spacing = rules.coordinates.gridSpacing;
			position = {
				x: Math.round(position.x / spacing) * spacing,
				y: Math.round(position.y / spacing) * spacing
			};
		}
		out.push({
			id: other.id,
			ownerId: other.ownerId,
			position: { ...position },
			health: other.health,
			maxHealth: other.maxHealth,
			type: other.type,
			worldDistance: distance(grapher.position, other.position)
		});
	}
	return out;
}

/** Convert arc degrees to radians when inspecting candidates (tests/diagnostics). */
export function arcStartRadians(deg: number): number {
	return degToRad(deg);
}
