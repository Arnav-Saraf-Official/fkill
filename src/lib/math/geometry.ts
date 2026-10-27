import type { Vector2 } from '../game/types';

export interface Bounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

/** A set of polylines; each inner array is a continuous piece of a curve. */
export type CurveSegments = Vector2[][];

export interface ClosestPoint {
	point: Vector2;
	distance: number;
	/** Parameter along the segment, 0..1. */
	t: number;
}

export function vec(x: number, y: number): Vector2 {
	return { x, y };
}

export function add(a: Vector2, b: Vector2): Vector2 {
	return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vector2, b: Vector2): Vector2 {
	return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vector2, k: number): Vector2 {
	return { x: a.x * k, y: a.y * k };
}

export function distance(a: Vector2, b: Vector2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

export function rotate(p: Vector2, radians: number): Vector2 {
	if (radians === 0) return { x: p.x, y: p.y };
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export function dot(a: Vector2, b: Vector2): number {
	return a.x * b.x + a.y * b.y;
}

export function box(minX: number, maxX: number, minY: number, maxY: number): Bounds {
	return { minX, maxX, minY, maxY };
}

/** Full-width span centred on the origin: span 30 -> [-15, 15]. */
export function spanBounds(span: number): Bounds {
	const h = span / 2;
	return { minX: -h, maxX: h, minY: -h, maxY: h };
}

export function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
	const out = {
		minX: Math.max(a.minX, b.minX),
		maxX: Math.min(a.maxX, b.maxX),
		minY: Math.max(a.minY, b.minY),
		maxY: Math.min(a.maxY, b.maxY)
	};
	if (out.minX > out.maxX || out.minY > out.maxY) return null;
	return out;
}

export function boundsContain(b: Bounds, p: Vector2): boolean {
	return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

export function boundsOf(segments: CurveSegments): Bounds | null {
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const line of segments) {
		for (const p of line) {
			if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
	}
	if (!Number.isFinite(minX)) return null;
	return { minX, maxX, minY, maxY };
}

/** Closest point to `p` on segment a-b. */
export function closestPointOnSegment(p: Vector2, a: Vector2, b: Vector2): ClosestPoint {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) {
		const d = distance(p, a);
		return { point: { x: a.x, y: a.y }, distance: d, t: 0 };
	}
	let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	const point = { x: a.x + dx * t, y: a.y + dy * t };
	return { point, distance: distance(p, point), t };
}

/** Minimum distance from a point to any part of the curve geometry. */
export function distancePointToSegments(p: Vector2, segments: CurveSegments): number {
	let best = Infinity;
	for (const line of segments) {
		if (line.length === 1) {
			const d = distance(p, line[0]);
			if (d < best) best = d;
			continue;
		}
		for (let i = 0; i < line.length - 1; i++) {
			const d = closestPointOnSegment(p, line[i], line[i + 1]).distance;
			if (d < best) best = d;
		}
	}
	return best;
}

/** Total polyline length (used for animation timing and diagnostics). */
export function polylineLength(segments: CurveSegments): number {
	let total = 0;
	for (const line of segments) {
		for (let i = 0; i < line.length - 1; i++) total += distance(line[i], line[i + 1]);
	}
	return total;
}

/** Liang–Barsky clip of segment p->q against an axis-aligned box. */
export function clipSegmentToBounds(
	p: Vector2,
	q: Vector2,
	b: Bounds
): { p: Vector2; q: Vector2 } | null {
	let t0 = 0;
	let t1 = 1;
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	const checks: [number, number][] = [
		[-dx, p.x - b.minX],
		[dx, b.maxX - p.x],
		[-dy, p.y - b.minY],
		[dy, b.maxY - p.y]
	];
	for (const [den, num] of checks) {
		if (den === 0) {
			if (num < 0) return null;
			continue;
		}
		const t = num / den;
		if (den < 0) {
			if (t > t1) return null;
			if (t > t0) t0 = t;
		} else {
			if (t < t0) return null;
			if (t < t1) t1 = t;
		}
	}
	if (t0 > t1) return null;
	return {
		p: { x: p.x + dx * t0, y: p.y + dy * t0 },
		q: { x: p.x + dx * t1, y: p.y + dy * t1 }
	};
}

/**
 * Clip a polyline to a box, returning one or more continuous polylines.
 * Gaps are introduced where the curve leaves and re-enters the box.
 */
export function clipPolylineToBounds(points: Vector2[], b: Bounds): CurveSegments {
	const out: CurveSegments = [];
	let run: Vector2[] = [];
	const pushRun = () => {
		if (run.length >= 1) out.push(run);
		run = [];
	};
	const samePoint = (a: Vector2, c: Vector2) =>
		Math.abs(a.x - c.x) < 1e-12 && Math.abs(a.y - c.y) < 1e-12;

	for (let i = 0; i < points.length - 1; i++) {
		const p = points[i];
		const q = points[i + 1];
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
			pushRun();
			continue;
		}
		if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) {
			if (boundsContain(b, p)) {
				if (run.length === 0) run.push(p);
			}
			pushRun();
			continue;
		}
		const clipped = clipSegmentToBounds(p, q, b);
		if (!clipped) {
			pushRun();
			continue;
		}
		if (run.length === 0) run.push(clipped.p);
		else if (!samePoint(run[run.length - 1], clipped.p)) {
			// The segment re-entered the box at a new place: start a new run.
			pushRun();
			run.push(clipped.p);
		}
		run.push(clipped.q);
		if (!samePoint(clipped.q, q)) pushRun();
	}
	if (run.length === 1 && points.length > 1) {
		// A single point alone is not a drawable curve.
		const last = points[points.length - 1];
		if (!samePoint(run[0], last)) run = [];
	}
	pushRun();
	return out;
}

/** Parameter along segment p->q where it first enters the box, if it does. */
export function segmentBoundsEntry(p: Vector2, q: Vector2, b: Bounds): number | null {
	const clipped = clipSegmentToBounds(p, q, b);
	if (!clipped) return null;
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return boundsContain(b, p) ? 0 : null;
	return ((clipped.p.x - p.x) * dx + (clipped.p.y - p.y) * dy) / lenSq;
}

export function segmentIntersectsBounds(p: Vector2, q: Vector2, b: Bounds): boolean {
	return clipSegmentToBounds(p, q, b) !== null;
}

export function pointInCircle(p: Vector2, center: Vector2, radius: number): boolean {
	return distance(p, center) <= radius;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(p: Vector2, polygon: Vector2[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const a = polygon[i];
		const b = polygon[j];
		const intersects =
			a.y > p.y !== b.y > p.y &&
			p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
		if (intersects) inside = !inside;
	}
	return inside;
}

export function pointInRoundRect(
	p: Vector2,
	x: number,
	y: number,
	width: number,
	height: number,
	cornerRadius: number
): boolean {
	const r = Math.max(0, Math.min(cornerRadius, Math.min(width, height) / 2));
	if (p.x < x || p.x > x + width || p.y < y || p.y > y + height) return false;
	const cx = Math.min(Math.max(p.x, x + r), x + width - r);
	const cy = Math.min(Math.max(p.y, y + r), y + height - r);
	return distance(p, { x: cx, y: cy }) <= r + 1e-9;
}

/**
 * Exact minimum distance from a point to a circular arc.
 *
 * If the closest point on the full circle lies inside the sweep the answer is
 * |distance to centre - radius|; otherwise it is the distance to the nearer
 * endpoint. This is the analytic arc geometry used for hit detection.
 */
export function distancePointToArc(
	p: Vector2,
	center: Vector2,
	radius: number,
	startAngleRad: number,
	sweepRad: number
): number {
	const d = distance(p, center);
	if (d === 0) return radius;
	const angle = Math.atan2(p.y - center.y, p.x - center.x);
	const delta = normaliseAngle(angle - startAngleRad);
	const sweep = Math.abs(sweepRad);
	const inside =
		sweepRad >= 0 ? delta <= sweep + 1e-12 : normaliseAngle(-delta) <= sweep + 1e-12;
	if (inside) return Math.abs(d - radius);
	const a0 = startAngleRad;
	const a1 = startAngleRad + sweepRad;
	const p0 = { x: center.x + radius * Math.cos(a0), y: center.y + radius * Math.sin(a0) };
	const p1 = { x: center.x + radius * Math.cos(a1), y: center.y + radius * Math.sin(a1) };
	return Math.min(distance(p, p0), distance(p, p1));
}

export function normaliseAngle(a: number): number {
	const tau = Math.PI * 2;
	const r = a % tau;
	return r < 0 ? r + tau : r;
}

export function degToRad(deg: number): number {
	return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
	return (rad * 180) / Math.PI;
}
