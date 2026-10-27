/**
 * Attack collision.
 *
 * Resolution order (deterministic):
 *  1. For every component, occlusion is evaluated against the obstacle state
 *     *before* the attack. A section that this attack destroys therefore does
 *     not open a gap through which the same shot can reach a target.
 *  2. Visible sub-curves are measured against enemy hit zones in world
 *     coordinates; each component damages a given target at most once.
 *  3. Obstacle sections crossed by the visible beam accumulate damage, once per
 *     section per component.
 *
 * The attack is traced outward from the point on the curve closest to the
 * attacking grapher, in both directions. This is what makes "cover" intuitive:
 * whatever is behind an intact section, relative to the shooter, is protected.
 */

import type { GameRules, Obstacle, Vector2 } from './types';
import type { CurveSegments } from '../math/geometry';
import {
	closestPointOnSegment,
	distance,
	distancePointToArc,
	distancePointToSegments
} from '../math/geometry';
import type { PreparedArcComponent, PreparedComponent } from '../math/validation';
import type { SectionIndex, SectionRef } from './obstacles';
import { buildSectionIndex, sectionsAlongSegment } from './obstacles';

export interface TargetSnapshot {
	id: string;
	ownerId: string;
	position: Vector2;
	radius: number;
}

export interface TargetHitCandidate {
	targetId: string;
	ownerId: string;
	distance: number;
	hitRadius: number;
}

export interface ObstacleHitCandidate {
	obstacleId: string;
	sectionId: string;
	damage: number;
}

export interface ComponentTrace {
	componentIndex: number;
	targetHits: TargetHitCandidate[];
	obstacleHits: ObstacleHitCandidate[];
	blocked: boolean;
	blockedBy?: string;
	/** Visible world geometry after occlusion, for debugging and effects. */
	visible: CurveSegments;
}

export interface AttackTrace {
	components: ComponentTrace[];
}

interface HalfTrace {
	pieces: Vector2[][];
	blocked: boolean;
	blockedBy?: string;
	hits: SectionRef[];
}

function splitPoint(polyline: Vector2[], direction: 1 | -1): Vector2[] {
	// The trace starts at the point closest to the attacker; this helper builds
	// one half of the point list leading away from that point.
	if (direction === 1) return polyline;
	return polyline.slice().reverse();
}

function closestStartIndex(polyline: Vector2[], origin: Vector2): { index: number; point: Vector2 } {
	let best = { index: 0, point: polyline[0], dist: distance(polyline[0], origin) };
	if (polyline.length === 1) return { index: 0, point: polyline[0] };
	for (let i = 0; i < polyline.length - 1; i++) {
		const cp = closestPointOnSegment(origin, polyline[i], polyline[i + 1]);
		if (cp.distance < best.dist) best = { index: i, point: cp.point, dist: cp.distance };
	}
	return best;
}

function lerp(a: Vector2, b: Vector2, t: number): Vector2 {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Walk a half-polyline (starting at `points[0]`) and collect visible pieces,
 * stopping at the first intact blocking section.
 */
function walkHalf(
	points: Vector2[],
	index: SectionIndex,
	punchThrough: boolean,
	damageBySection: Map<string, SectionRef>
): HalfTrace {
	const pieces: Vector2[][] = [];
	let current: Vector2[] = [points[0]];
	let blocked = false;
	let blockedBy: string | undefined;
	const hits: SectionRef[] = [];

	for (let i = 0; i < points.length - 1; i++) {
		const p = points[i];
		const q = points[i + 1];
		const crossings = sectionsAlongSegment(index, p, q);
		for (const crossing of crossings) {
			if (blocked) break;
			const entry = lerp(p, q, Math.min(1, Math.max(0, crossing.t)));
			current.push(entry);
			damageBySection.set(crossing.ref.section.id, crossing.ref);
			hits.push(crossing.ref);
			if (!punchThrough) {
				blocked = true;
				blockedBy = crossing.ref.obstacle.id;
				if (current.length >= 2) pieces.push(current);
				current = [];
				break;
			}
		}
		if (blocked) break;
		current.push(q);
	}
	if (!blocked) {
		if (current.length >= 2) pieces.push(current);
	}
	return { pieces, blocked, blockedBy, hits };
}

/** Trace every segment of one component and return all visible geometry. */
function traceVisible(
	world: CurveSegments,
	origin: Vector2,
	index: SectionIndex,
	punchThrough: boolean
): { pieces: CurveSegments; blocked: boolean; blockedBy?: string; hits: SectionRef[] } {
	const pieces: CurveSegments = [];
	const hits: SectionRef[] = [];
	let blocked = false;
	let blockedBy: string | undefined;
	for (const polyline of world) {
		if (polyline.length < 2) continue;
		const start = closestStartIndex(polyline, origin);
		const forward = splitPoint(polyline, 1).slice(start.index);
		forward[0] = start.point;
		const backward = polyline.slice(0, start.index + 1).reverse();
		backward[0] = start.point;
		const fwd = walkHalf(forward, index, punchThrough, new Map());
		const bwd = walkHalf(backward, index, punchThrough, new Map());
		pieces.push(...fwd.pieces, ...bwd.pieces);
		hits.push(...fwd.hits, ...bwd.hits);
		if (fwd.blocked || bwd.blocked) {
			blocked = true;
			blockedBy = blockedBy ?? fwd.blockedBy ?? bwd.blockedBy;
		}
	}
	return { pieces, blocked, blockedBy, hits };
}

function pieceDistanceForArc(target: Vector2, arc: PreparedArcComponent, piece: Vector2[]): number {
	const a0 = Math.atan2(piece[0].y - arc.centerWorld.y, piece[0].x - arc.centerWorld.x);
	const end = piece[piece.length - 1];
	const a1 = Math.atan2(end.y - arc.centerWorld.y, end.x - arc.centerWorld.x);
	const tau = Math.PI * 2;
	let delta: number;
	if (arc.sweepRad >= 0) {
		delta = ((a1 - a0) % tau + tau) % tau;
	} else {
		delta = -(((a0 - a1) % tau + tau) % tau);
	}
	if (Math.abs(delta) > Math.abs(arc.sweepRad) + 1e-6) {
		delta = Math.sign(arc.sweepRad) * Math.abs(arc.sweepRad);
	}
	return distancePointToArc(target, arc.centerWorld, arc.radius, a0, delta);
}

function targetDistance(target: Vector2, component: PreparedComponent, visible: CurveSegments): number {
	if (visible.length === 0) return Infinity;
	if (component.kind === 'arc') {
		let best = Infinity;
		for (const piece of visible) {
			if (piece.length < 2) continue;
			const d = pieceDistanceForArc(target, component, piece);
			if (d < best) best = d;
		}
		return best;
	}
	return distancePointToSegments(target, visible);
}

export interface TraceAttackInput {
	rules: GameRules;
	components: PreparedComponent[];
	/** World position of the firing grapher; the beam origin. */
	attackerPosition: Vector2;
	targets: TargetSnapshot[];
	obstacles: Obstacle[];
	obstacleDamage: number;
}

export function traceAttack(input: TraceAttackInput): AttackTrace {
	const { rules, components, attackerPosition, targets, obstacles, obstacleDamage } = input;
	const index = buildSectionIndex(obstacles, Math.max(1.25, rules.obstacles.sectionSize * 2));
	const punchThrough = rules.obstacles.enabled && rules.obstacles.punchThrough;

	const traces: ComponentTrace[] = components.map((component, componentIndex) => {
		const visibleTrace = traceVisible(component.world, attackerPosition, index, punchThrough);

		// Deduplicate obstacle damage within this component.
		const seen = new Map<string, ObstacleHitCandidate>();
		for (const ref of visibleTrace.hits) {
			if (seen.has(ref.section.id)) continue;
			seen.set(ref.section.id, {
				obstacleId: ref.obstacle.id,
				sectionId: ref.section.id,
				damage: obstacleDamage
			});
		}

		const hits: TargetHitCandidate[] = [];
		for (const target of targets) {
			const d = targetDistance(target.position, component, visibleTrace.pieces);
			if (d <= target.radius + 1e-9) {
				hits.push({
					targetId: target.id,
					ownerId: target.ownerId,
					distance: Math.max(0, d),
					hitRadius: target.radius
				});
			}
		}

		return {
			componentIndex,
			targetHits: hits,
			obstacleHits: [...seen.values()],
			blocked: visibleTrace.blocked,
			blockedBy: visibleTrace.blockedBy,
			visible: visibleTrace.pieces
		};
	});

	return { components: traces };
}

/** Nearest point on a curve, used for effects and debugging overlays. */
export function nearestCurvePoint(segments: CurveSegments, p: Vector2): Vector2 | null {
	let best: { point: Vector2; dist: number } | null = null;
	for (const line of segments) {
		if (line.length === 1) {
			const d = distance(line[0], p);
			if (!best || d < best.dist) best = { point: line[0], dist: d };
			continue;
		}
		for (let i = 0; i < line.length - 1; i++) {
			const cp = closestPointOnSegment(p, line[i], line[i + 1]);
			if (!best || cp.distance < best.dist) best = { point: cp.point, dist: cp.distance };
		}
	}
	return best?.point ?? null;
}
