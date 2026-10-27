/**
 * Distinct real root counting.
 *
 * A root is a distinct real x in the attack's valid domain with f(x) = 0.
 * Counting is numerical, not symbolic, and is documented as an estimate with a
 * resolution (see docs/GAME_RULES.md).
 *
 * Zero acceptance is *relative*, not based on an absolute epsilon: a candidate
 * counts only when |f(x)| is negligible compared with the function's magnitude
 * nearby. This is what separates a real root from a tiny-but-nonzero value
 * (e^x at x = -15) and from a pole (1/x at x = 0), without depending on the
 * units of the expression.
 *
 * The analyser:
 *  - samples two offset grids (reduces aliasing for oscillating curves),
 *  - bisects sign changes, rejecting vertical asymptotes,
 *  - finds tangent roots by minimising |f| around local minima of |f|,
 *  - detects roots at the boundary of a restricted domain (sqrt(x-1) at x = 1),
 *  - deduplicates roots closer than span * 1e-6,
 *  - stops as soon as more roots than the budget are found.
 */

import type { SafetyLimits } from '../game/types';
import { evaluate } from './evaluator';
import type { AstNode } from './parser';

export interface RootAnalysis {
	/** Sorted distinct roots, truncated at `maxCount + 1` when exceeded. */
	roots: number[];
	count: number;
	/** True when more than `maxCount` distinct roots were found. */
	exceeded: boolean;
	/** True for f(x) ≡ 0, where every point is a root. */
	degenerate: boolean;
	/** Largest finite |f| seen while sampling; used to trigger refinement. */
	scale: number;
}

export interface RootOptions {
	maxCount: number;
	/** Samples per grid; bounded by SafetyLimits.maxRootGrid. */
	grid?: number;
}

const EPS_SPAN = 1e-6;

function bisect(
	ast: AstNode,
	a: number,
	b: number,
	va: number,
	tolerance: number
): number | null {
	let lo = a;
	let hi = b;
	let flo = va;
	for (let i = 0; i < 120; i++) {
		const mid = (lo + hi) / 2;
		const fm = evaluate(ast, mid);
		if (!Number.isFinite(fm)) return null;
		if (fm === 0) return mid;
		if ((flo < 0) === (fm < 0)) {
			lo = mid;
			flo = fm;
		} else {
			hi = mid;
		}
		if (Math.abs(hi - lo) < tolerance) return (lo + hi) / 2;
	}
	return (lo + hi) / 2;
}

/** Golden-section minimisation of |f| on a small interval. */
function minimiseAbs(ast: AstNode, a: number, b: number): { x: number; value: number } {
	const phi = (Math.sqrt(5) - 1) / 2;
	let lo = a;
	let hi = b;
	let c = hi - phi * (hi - lo);
	let d = lo + phi * (hi - lo);
	let fc = Math.abs(evaluate(ast, c));
	let fd = Math.abs(evaluate(ast, d));
	for (let i = 0; i < 100; i++) {
		if (fc < fd) {
			hi = d;
			d = c;
			fd = fc;
			c = hi - phi * (hi - lo);
			fc = Math.abs(evaluate(ast, c));
		} else {
			lo = c;
			c = d;
			fc = fd;
			d = lo + phi * (hi - lo);
			fd = Math.abs(evaluate(ast, d));
		}
		if (hi - lo < 1e-14) break;
	}
	const x = (lo + hi) / 2;
	return { x, value: Math.abs(evaluate(ast, x)) };
}

interface Sample {
	x: number;
	y: number;
}

function gridSamples(
	ast: AstNode,
	xMin: number,
	xMax: number,
	n: number,
	offsetFraction = 0
): Sample[] {
	const span = xMax - xMin;
	const out: Sample[] = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const x = Math.min(xMax, Math.max(xMin, xMin + span * t + (span / n) * offsetFraction));
		out.push({ x, y: evaluate(ast, x) });
	}
	return out;
}

export function analyseRoots(
	ast: AstNode,
	xMin: number,
	xMax: number,
	limits: SafetyLimits,
	options: RootOptions
): RootAnalysis {
	const maxCount = Math.max(0, Math.floor(options.maxCount));
	const grid = Math.max(64, Math.min(options.grid ?? 512, limits.maxRootGrid));
	const span = xMax - xMin;
	const tolerance = Math.max(1e-13, span * 1e-12);
	const probe = Math.max(1e-6, span * 1e-4);

	const primary = gridSamples(ast, xMin, xMax, grid, 0);
	const secondary = gridSamples(ast, xMin, xMax, grid, 0.5);

	let scale = 0;
	let finiteSamples = 0;
	let allZero = true;
	for (const s of primary) {
		if (!Number.isFinite(s.y)) continue;
		finiteSamples++;
		const mag = Math.abs(s.y);
		if (mag > scale) scale = mag;
		if (mag > 0) allZero = false;
	}
	if (finiteSamples === 0) {
		return { roots: [], count: 0, exceeded: false, degenerate: false, scale: 0 };
	}
	if (allZero) {
		return { roots: [0], count: maxCount + 1, exceeded: true, degenerate: true, scale: 0 };
	}
	scale = Math.min(Math.max(scale, 1), 1e12);
	const touchThreshold = 1e-2 * scale;

	const roots: number[] = [];
	let exceeded = false;

	const addRoot = (x: number): boolean => {
		if (!Number.isFinite(x)) return true;
		if (x < xMin - tolerance || x > xMax + tolerance) return true;
		const eps = span * EPS_SPAN;
		for (const r of roots) if (Math.abs(r - x) <= eps) return true;
		roots.push(x);
		if (roots.length > maxCount) {
			exceeded = true;
			return false;
		}
		return true;
	};

	/** Relative zero test: is |f(x)| negligible next to nearby values? */
	const isZeroAt = (x: number, reference: number): boolean => {
		const v = Math.abs(evaluate(ast, x));
		if (!Number.isFinite(v)) return false;
		if (v === 0) return true;
		const left = evaluate(ast, x - probe);
		const right = evaluate(ast, x + probe);
		const leftMag = Number.isFinite(left) ? Math.abs(left) : 0;
		const rightMag = Number.isFinite(right) ? Math.abs(right) : 0;
		const neighbour = Math.max(reference, leftMag, rightMag, 1e-300);
		return v <= 1e-6 * neighbour;
	};

	const scanSignChanges = (samples: Sample[]): boolean => {
		for (let i = 0; i < samples.length - 1; i++) {
			const a = samples[i];
			const b = samples[i + 1];
			if (!Number.isFinite(a.y) || !Number.isFinite(b.y)) continue;
			if (a.y === 0) {
				if (!isZeroAt(a.x, Math.max(Math.abs(a.y), Math.abs(b.y)))) continue;
				if (!addRoot(a.x)) return false;
				continue;
			}
			if ((a.y < 0) === (b.y < 0)) continue;
			const root = bisect(ast, a.x, b.x, a.y, tolerance);
			if (root === null) continue; // pole: f is non-finite inside
			// A sign change with a residual comparable to its neighbours is a pole.
			if (!isZeroAt(root, Math.max(Math.abs(a.y), Math.abs(b.y)))) continue;
			if (!addRoot(root)) return false;
		}
		return true;
	};

	/** Roots where a restricted domain begins or ends (sqrt(x-1), sqrt(1-x)). */
	const scanDomainBoundaries = (samples: Sample[]): boolean => {
		for (let i = 0; i < samples.length - 1; i++) {
			const a = samples[i];
			const b = samples[i + 1];
			const aFinite = Number.isFinite(a.y);
			const bFinite = Number.isFinite(b.y);
			if (aFinite === bFinite) continue;
			// lo is always the defined side, hi the undefined side.
			let lo = bFinite ? b.x : a.x;
			let hi = bFinite ? a.x : b.x;
			if (Math.abs(hi - lo) < 1e-15) continue;
			for (let k = 0; k < 60; k++) {
				const mid = (lo + hi) / 2;
				if (Number.isFinite(evaluate(ast, mid))) lo = mid;
				else hi = mid;
				if (Math.abs(hi - lo) < tolerance) break;
			}
			const boundary = lo;
			// Numerical bisection cannot land exactly on the boundary, so check the
			// trend: on the defined side |f| must shrink towards zero as x approaches
			// the edge. sqrt(x-1) qualifies, ln(x-1) and 1/(x-1) do not.
			const dir = Math.sign(lo - hi) || 1;
			const distances = [probe, probe * 1e-3, probe * 1e-6];
			const values = distances.map((h) => {
				const v = evaluate(ast, boundary + dir * h);
				return Number.isFinite(v) ? Math.abs(v) : NaN;
			});
			if (values.some((v) => !Number.isFinite(v))) continue;
			const shrinking = values[2] < values[1] && values[1] < values[0];
			if (!shrinking || !(values[2] <= 1e-2 * values[0])) continue;
			if (!addRoot(boundary)) return false;
		}
		return true;
	};

	if (!scanSignChanges(primary)) {
		return { roots: roots.slice(0, maxCount + 1), count: roots.length, exceeded, degenerate: false, scale };
	}
	if (!scanSignChanges(secondary)) {
		return { roots: roots.slice(0, maxCount + 1), count: roots.length, exceeded, degenerate: false, scale };
	}
	if (!scanDomainBoundaries(primary)) {
		return { roots: roots.slice(0, maxCount + 1), count: roots.length, exceeded, degenerate: false, scale };
	}

	// Tangent roots: |f| local minima that touch zero without crossing.
	for (const samples of [primary, secondary]) {
		for (let i = 1; i < samples.length - 1; i++) {
			const prev = samples[i - 1];
			const cur = samples[i];
			const next = samples[i + 1];
			if (!Number.isFinite(prev.y) || !Number.isFinite(cur.y) || !Number.isFinite(next.y)) {
				continue;
			}
			const ac = Math.abs(cur.y);
			if (ac > touchThreshold) continue;
			if (ac > Math.abs(prev.y) || ac > Math.abs(next.y)) continue; // not a local min
			const refined = minimiseAbs(ast, prev.x, next.x);
			if (isZeroAt(refined.x, Math.max(Math.abs(prev.y), Math.abs(next.y)))) {
				if (!addRoot(refined.x)) {
					return {
						roots: roots.slice(0, maxCount + 1),
						count: roots.length,
						exceeded,
						degenerate: false,
						scale
					};
				}
			}
		}
	}

	// Domain-endpoint roots (a crossing exactly at the analysis boundary).
	for (const x of [xMin, xMax]) {
		const y = evaluate(ast, x);
		if (!Number.isFinite(y)) continue;
		const inside = evaluate(ast, x + (x === xMin ? probe : -probe));
		if (!Number.isFinite(inside)) continue;
		if (isZeroAt(x, Math.abs(inside))) {
			if (!addRoot(x)) break;
		}
	}

	roots.sort((a, b) => a - b);
	return {
		roots: roots.slice(0, maxCount + 1),
		count: roots.length,
		exceeded,
		degenerate: false,
		scale
	};
}
