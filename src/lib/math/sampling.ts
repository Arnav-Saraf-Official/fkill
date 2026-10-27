/**
 * Curve sampling shared by rendering and collision.
 *
 * Design decisions (documented in docs/GAME_RULES.md):
 *  - Geometry is sampled once at *game precision*. The renderer draws exactly
 *    the segment list that hit detection uses, so "what you see" is "what can
 *    be hit". No cosmetic resampling changes gameplay.
 *  - Sampling is adaptive: intervals are bisected while the midpoint deviates
 *    from the chord or values are non-finite, bounded by `maxSamples`.
 *  - Runs are split at discontinuities and clipped to the legal window, so a
 *    curve never connects across an asymptote or leaves its domain.
 */

import type { SafetyLimits, Vector2 } from '../game/types';
import type { Bounds, CurveSegments } from './geometry';
import { clipPolylineToBounds } from './geometry';
import { evaluate } from './evaluator';
import type { AstNode } from './parser';

export interface SamplingOptions {
	/** Initial number of intervals across the domain. */
	baseIntervals?: number;
	/** Maximum bisection depth per interval. */
	maxDepth?: number;
	/** Chord deviation (in coordinate units) that triggers subdivision. */
	flatness?: number;
	/** |dy| above `jumpFactor * window height` is treated as a discontinuity. */
	jumpFactor?: number;
	/** Hard cap on generated samples. */
	maxPoints?: number;
	/** Visible y-window; values far outside on one side skip refinement. */
	window?: Bounds;
}

const DEFAULTS = {
	baseIntervals: 320,
	maxDepth: 5,
	flatness: 0.012,
	jumpFactor: 0.8
} as const;

/** Raw sample sequence in local coordinates, unclipped. */
export function sampleFunctionRaw(
	ast: AstNode,
	xMin: number,
	xMax: number,
	limits: SafetyLimits,
	options: SamplingOptions = {}
): Vector2[] {
	const window = options.window;
	const baseIntervals = Math.max(8, options.baseIntervals ?? DEFAULTS.baseIntervals);
	const maxDepth = Math.max(0, options.maxDepth ?? DEFAULTS.maxDepth);
	const flatness = options.flatness ?? DEFAULTS.flatness;
	const maxPoints = Math.max(64, options.maxPoints ?? limits.maxSamples);

	const points: Vector2[] = [];
	let budget = maxPoints;

	const push = (x: number, y: number) => {
		if (points.length >= maxPoints) return;
		points.push({ x, y });
	};

	const span = xMax - xMin;
	const step = span / baseIntervals;

	const subdivide = (x0: number, y0: number, x1: number, y1: number, depth: number): void => {
		if (points.length >= maxPoints) return;
		const xm = (x0 + x1) / 2;
		const ym = evaluate(ast, xm);
		const nonFinite = !Number.isFinite(y0) || !Number.isFinite(y1) || !Number.isFinite(ym);
		// Chord deviation drives refinement. `nonFinite` localises poles, and the
		// discontinuity splitter handles the break: no slope heuristic is needed.
		const deviates =
			Number.isFinite(y0) && Number.isFinite(y1) && Number.isFinite(ym)
				? Math.abs(ym - (y0 + y1) / 2) > flatness
				: nonFinite;
		// Refining a stretch that is wholly above or below the visible window
		// cannot produce visible geometry; keeping a single sample there leaves
		// the budget for the parts that matter.
		const couldBeVisible =
			window === undefined ||
			nonFinite ||
			(Math.max(y0, ym, y1) >= window.minY && Math.min(y0, ym, y1) <= window.maxY);
		if (!couldBeVisible) {
			push(x1, y1);
			return;
		}
		if (depth < maxDepth && budget > 0 && (nonFinite || deviates)) {
			budget -= 1;
			subdivide(x0, y0, xm, ym, depth + 1);
			subdivide(xm, ym, x1, y1, depth + 1);
			return;
		}
		push(x1, y1);
	};

	for (let i = 0; i <= baseIntervals; i++) {
		const x = i === baseIntervals ? xMax : xMin + step * i;
		const y = evaluate(ast, x);
		if (i === 0) push(x, y);
		else {
			const prev = points[points.length - 1];
			subdivide(prev.x, prev.y, x, y, 0);
		}
	}
	return points;
}

/** Split a raw sample run where the curve jumps across an asymptote. */
export function splitDiscontinuities(
	points: Vector2[],
	window: Bounds,
	limits: SafetyLimits,
	options: SamplingOptions = {}
): Vector2[][] {
	const jumpFactor = options.jumpFactor ?? DEFAULTS.jumpFactor;
	const threshold = Math.max(1, (window.maxY - window.minY) * jumpFactor);
	const runs: Vector2[][] = [];
	let run: Vector2[] = [];
	const flush = () => {
		if (run.length > 0) runs.push(run);
		run = [];
	};
	for (let i = 0; i < points.length; i++) {
		const p = points[i];
		if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
			flush();
			continue;
		}
		if (run.length > 0) {
			const prev = run[run.length - 1];
			const dy = Math.abs(p.y - prev.y);
			// A very large jump between adjacent, adaptively refined samples is a
			// pole, not a slope: break the curve instead of drawing a vertical line.
			if (dy > threshold) {
				flush();
			}
		}
		run.push(p);
	}
	flush();
	// Keep limits referenced for future extension without changing behaviour.
	void limits;
	return runs;
}

/** Sample a function and return clipped, continuous geometry in local coords. */
export function sampleFunctionGeometry(
	ast: AstNode,
	window: Bounds,
	limits: SafetyLimits,
	options: SamplingOptions = {}
): CurveSegments {
	const raw = sampleFunctionRaw(ast, window.minX, window.maxX, limits, {
		...options,
		window
	});
	const runs = splitDiscontinuities(raw, window, limits, options);
	const out: CurveSegments = [];
	for (const run of runs) {
		for (const piece of clipPolylineToBounds(run, window)) {
			if (piece.length >= 2) out.push(piece);
		}
	}
	return out;
}

/**
 * Sample a circular arc. Angles are radians, 0 = +x axis, positive CCW.
 * The polyline is used for rendering and obstacle traversal; hit detection
 * against targets uses analytic arc distance.
 */
export function sampleArcPoints(center: Vector2, radius: number, startRad: number, sweepRad: number): Vector2[] {
	const steps = Math.min(720, Math.max(24, Math.ceil(Math.abs(sweepRad) / (Math.PI / 360))));
	const points: Vector2[] = [];
	for (let i = 0; i <= steps; i++) {
		const a = startRad + (sweepRad * i) / steps;
		points.push({
			x: center.x + radius * Math.cos(a),
			y: center.y + radius * Math.sin(a)
		});
	}
	return points;
}

/** Sample an arc and clip it to the given window. */
export function sampleArcGeometry(
	center: Vector2,
	radius: number,
	startRad: number,
	sweepRad: number,
	window: Bounds
): CurveSegments {
	const points = sampleArcPoints(center, radius, startRad, sweepRad);
	return clipPolylineToBounds(points, window).filter((p) => p.length >= 2);
}
