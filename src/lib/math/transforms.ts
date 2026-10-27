/**
 * Coordinate frames.
 *
 * f(kill) has exactly one world coordinate system. A grapher may have a local
 * frame (mode B) whose origin is the grapher's position and, when rotation is
 * enabled, whose axes are rotated by the grapher's rotation. Every subsystem —
 * preview, sampling, collision, obstacles, CPU and authority — uses the
 * functions below; there is no second implementation anywhere.
 *
 *   worldPoint = origin + R(rotation) * localPoint
 */

import type { Grapher, GameRules, GrapherType, Vector2 } from '../game/types';
import type { Bounds, CurveSegments } from './geometry';
import { rotate, spanBounds } from './geometry';

export interface CoordinateFrame {
	origin: Vector2;
	rotation: number;
	/** True when the frame is the shared world plane. */
	shared: boolean;
}

export const WORLD_FRAME: CoordinateFrame = {
	origin: { x: 0, y: 0 },
	rotation: 0,
	shared: true
};

export function frameForGrapher(grapher: Grapher, rules: GameRules): CoordinateFrame {
	if (rules.coordinates.mode === 'shared') return WORLD_FRAME;
	return {
		origin: grapher.position,
		rotation: rules.coordinates.allowRotation ? grapher.rotation : 0,
		shared: false
	};
}

export function localToWorld(frame: CoordinateFrame, p: Vector2): Vector2 {
	const r = rotate(p, frame.rotation);
	return { x: r.x + frame.origin.x, y: r.y + frame.origin.y };
}

export function worldToLocal(frame: CoordinateFrame, p: Vector2): Vector2 {
	const dx = p.x - frame.origin.x;
	const dy = p.y - frame.origin.y;
	return rotate({ x: dx, y: dy }, -frame.rotation);
}

/** Rotate a local direction (e.g. an arc angle) into world orientation. */
export function localAngleToWorld(frame: CoordinateFrame, angleRad: number): number {
	return angleRad + frame.rotation;
}

export function transformSegments(segments: CurveSegments, frame: CoordinateFrame): CurveSegments {
	if (frame === WORLD_FRAME) return segments;
	return segments.map((line) => line.map((p) => localToWorld(frame, p)));
}

export function transformPoints(points: Vector2[], frame: CoordinateFrame): Vector2[] {
	if (frame === WORLD_FRAME) return points;
	return points.map((p) => localToWorld(frame, p));
}

/** The 50x50 world plane. */
export function worldBounds(rules: GameRules): Bounds {
	return spanBounds(rules.worldSize);
}

/** A grapher's valid local coordinate window (centred on its local origin). */
export function attackWindow(rules: GameRules, type: GrapherType): Bounds {
	return spanBounds(rules.grapherTypes[type].domainRangeSpan);
}

/** The attack window expressed in world coordinates. */
export function worldAttackWindow(
	rules: GameRules,
	type: GrapherType,
	frame: CoordinateFrame
): Bounds {
	const local = attackWindow(rules, type);
	const corners = [
		localToWorld(frame, { x: local.minX, y: local.minY }),
		localToWorld(frame, { x: local.maxX, y: local.minY }),
		localToWorld(frame, { x: local.minX, y: local.maxY }),
		localToWorld(frame, { x: local.maxX, y: local.maxY })
	];
	const xs = corners.map((c) => c.x);
	const ys = corners.map((c) => c.y);
	return {
		minX: Math.min(...xs),
		maxX: Math.max(...xs),
		minY: Math.min(...ys),
		maxY: Math.max(...ys)
	};
}
