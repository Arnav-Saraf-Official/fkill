import { describe, expect, it } from 'vitest';
import { parseExpression, parseCached, normaliseExpression, clearParseCache } from '$lib/math/parser';
import { evaluate } from '$lib/math/evaluator';
import { analyseRoots } from '$lib/math/roots';
import { DEFAULT_RULES } from '$lib/game/rules';
import { distancePointToArc, clipPolylineToBounds, distancePointToSegments } from '$lib/math/geometry';
import { sampleFunctionGeometry } from '$lib/math/sampling';

const limits = DEFAULT_RULES.limits;

function ast(source: string) {
	const parsed = parseExpression(source, limits);
	if (!parsed.ok) throw new Error(parsed.error.message);
	return parsed.ast;
}

function rootsOf(source: string, min: number, max: number, maxCount = 40) {
	return analyseRoots(ast(source), min, max, limits, { maxCount, grid: 512 });
}

describe('expression parser', () => {
	it('applies operator precedence and associativity', () => {
		expect(evaluate(ast('2 + 3 * 4'), 0)).toBe(14);
		expect(evaluate(ast('(2 + 3) * 4'), 0)).toBe(20);
		expect(evaluate(ast('2 ^ 3 ^ 2'), 0)).toBe(512);
		expect(evaluate(ast('-x^2'), 3)).toBe(-9);
		expect(evaluate(ast('(-x)^2'), 3)).toBe(9);
		expect(evaluate(ast('10 - 4 - 3'), 0)).toBe(3);
	});

	it('supports implicit multiplication and typographic input', () => {
		expect(evaluate(ast('2x'), 5)).toBe(10);
		expect(evaluate(ast('3sin(0)'), 0)).toBe(0);
		expect(evaluate(ast('(x+1)(x-1)'), 3)).toBe(8);
		expect(evaluate(ast('x(x+1)'), 2)).toBe(6);
		expect(evaluate(ast('x²'), 4)).toBe(16);
		expect(evaluate(ast('x³ + 1'), 2)).toBe(9);
		expect(normaliseExpression('π×2')).toContain('pi*2');
	});

	it('strips the y = / f(x) = prefix and accepts constants', () => {
		expect(evaluate(ast('y = 2*x + 3'), 1)).toBe(5);
		expect(evaluate(ast('f(x) = x^2'), 3)).toBe(9);
		expect(evaluate(ast('pi'), 0)).toBeCloseTo(Math.PI, 10);
		expect(evaluate(ast('e'), 0)).toBeCloseTo(Math.E, 10);
	});

	it('evaluates the documented function set', () => {
		expect(evaluate(ast('sin(pi/2)'), 0)).toBeCloseTo(1, 10);
		expect(evaluate(ast('cos(0)'), 0)).toBe(1);
		expect(evaluate(ast('sqrt(16)'), 0)).toBe(4);
		expect(evaluate(ast('abs(-3)'), 0)).toBe(3);
		expect(evaluate(ast('exp(0)'), 0)).toBe(1);
		expect(evaluate(ast('log(100)'), 0)).toBeCloseTo(2, 10);
		expect(evaluate(ast('ln(e)'), 0)).toBeCloseTo(1, 10);
		expect(evaluate(ast('tan(0)'), 0)).toBe(0);
	});

	it('returns non-finite values instead of throwing on domain violations', () => {
		expect(evaluate(ast('1/0'), 0)).toBe(Infinity);
		expect(evaluate(ast('0/0'), 0)).toBeNaN();
		expect(evaluate(ast('sqrt(-1)'), 0)).toBeNaN();
		expect(evaluate(ast('ln(-1)'), 0)).toBeNaN();
		expect(evaluate(ast('ln(0)'), 0)).toBe(-Infinity);
		expect(evaluate(ast('(-8)^(1/3)'), 0)).toBeNaN();
		expect(evaluate(ast('0^0'), 0)).toBe(1);
	});

	it('rejects unsupported syntax with a useful message and position', () => {
		for (const bad of ['y = z + 1', 'sin(x, 2)', 'x +', '((x)', 'x = 2', 'alert(1)', 'x.constructor']) {
			const result = parseExpression(bad, limits);
			expect(result.ok, bad).toBe(false);
			if (!result.ok) {
				expect(result.error.message.length).toBeGreaterThan(3);
				expect(result.issue.code).toBeTruthy();
			}
		}
	});

	it('reports character positions for syntax errors', () => {
		const result = parseExpression('2 + * 3', limits);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.position).toBe(4);
	});

	it('enforces length and complexity limits', () => {
		const tooLong = 'x+'.repeat(200) + '1';
		const longResult = parseExpression(tooLong, limits);
		expect(longResult.ok).toBe(false);
		if (!longResult.ok) expect(longResult.issue.code).toBe('too-long');

		const deep = '('.repeat(40) + 'x' + ')'.repeat(40);
		const deepResult = parseExpression(deep, limits);
		expect(deepResult.ok).toBe(false);

		const manyTerms = Array.from({ length: 120 }, () => 'x').join('+');
		const manyResult = parseExpression(manyTerms, limits);
		expect(manyResult.ok).toBe(false);
		if (!manyResult.ok) expect(manyResult.issue.code).toBe('too-complex');
	});

	it('caches parse results without changing them', () => {
		clearParseCache();
		const a = parseCached('x^2 - 4', limits);
		const b = parseCached('x^2 - 4', limits);
		expect(a).toBe(b);
	});
});

describe('root analysis', () => {
	it('finds simple crossing roots', () => {
		const analysis = rootsOf('x^2 - 4', -15, 15);
		expect(analysis.exceeded).toBe(false);
		expect(analysis.count).toBe(2);
		expect(analysis.roots[0]).toBeCloseTo(-2, 6);
		expect(analysis.roots[1]).toBeCloseTo(2, 6);
	});

	it('finds a tangent root that never crosses the axis', () => {
		const analysis = rootsOf('(x - 2)^2', -15, 15);
		expect(analysis.count).toBe(1);
		expect(analysis.roots[0]).toBeCloseTo(2, 5);
	});

	it('finds repeated roots of higher multiplicity', () => {
		const analysis = rootsOf('(x + 1)^4', -15, 15);
		expect(analysis.count).toBe(1);
		expect(analysis.roots[0]).toBeCloseTo(-1, 5);
	});

	it('does not count a vertical asymptote as a root', () => {
		expect(rootsOf('1/x', -15, 15).count).toBe(0);
		expect(rootsOf('1/(x-3)', -15, 15).count).toBe(0);
		expect(rootsOf('tan(x)', -1.4, 1.4).count).toBe(1);
	});

	it('counts roots either side of a pole correctly', () => {
		const analysis = rootsOf('(x^2 - 1)/(x + 2)', -15, 15);
		expect(analysis.count).toBe(2);
		expect(analysis.roots.map((r) => Number(r.toFixed(6)))).toEqual([-1, 1]);
	});

	it('counts the documented sine roots', () => {
		// sin(x) = 0 at k*pi for k = -4..4 inside [-15, 15]
		expect(rootsOf('sin(x)', -15, 15).count).toBe(9);
	});

	it('handles functions with restricted domains', () => {
		const analysis = rootsOf('sqrt(x)', -15, 15);
		expect(analysis.count).toBe(1);
		expect(analysis.roots[0]).toBeCloseTo(0, 6);
		expect(rootsOf('sqrt(x - 1)', -15, 15).count).toBe(1);
		expect(rootsOf('ln(x)', -15, 15).count).toBe(1);
	});

	it('finds roots at the domain boundary', () => {
		const analysis = rootsOf('x - 15', -15, 15);
		expect(analysis.count).toBe(1);
		expect(analysis.roots[0]).toBeCloseTo(15, 6);
	});

	it('returns no roots for functions that stay away from zero', () => {
		expect(rootsOf('x^2 + 1', -15, 15).count).toBe(0);
		expect(rootsOf('2', -15, 15).count).toBe(0);
		expect(rootsOf('exp(x)', -15, 15).count).toBe(0);
	});

	it('flags identically-zero functions as degenerate', () => {
		const analysis = rootsOf('0*x', -15, 15);
		expect(analysis.degenerate).toBe(true);
		expect(analysis.exceeded).toBe(true);
	});

	it('bails out when the root budget is exceeded', () => {
		const analysis = rootsOf('sin(20*x)', -15, 15, 30);
		expect(analysis.exceeded).toBe(true);
		expect(analysis.count).toBeGreaterThan(30);
	});

	it('respects the requested maximum count', () => {
		const analysis = rootsOf('sin(x)', -15, 15, 3);
		expect(analysis.exceeded).toBe(true);
		expect(analysis.count).toBe(4);
	});

	it('does not double-count one root sampled twice', () => {
		const analysis = rootsOf('x', -15, 15);
		expect(analysis.count).toBe(1);
	});
});

describe('geometry and sampling', () => {
	it('clips a polyline to a box and splits at exits', () => {
		const segments = clipPolylineToBounds(
			[
				{ x: -10, y: 0 },
				{ x: 10, y: 0 }
			],
			{ minX: -5, maxX: 5, minY: -1, maxY: 1 }
		);
		expect(segments.length).toBe(1);
		expect(segments[0][0].x).toBeCloseTo(-5);
		expect(segments[0][1].x).toBeCloseTo(5);
	});

	it('splits a curve that leaves and re-enters the box', () => {
		const points = Array.from({ length: 41 }, (_, i) => ({ x: -10 + i * 0.5, y: Math.sin((i / 40) * Math.PI * 2) * 5 }));
		const segments = clipPolylineToBounds(points, { minX: -10, maxX: 10, minY: -1, maxY: 1 });
		expect(segments.length).toBeGreaterThan(1);
	});

	it('never connects across an asymptote', () => {
		const geometry = sampleFunctionGeometry(ast('1/x'), { minX: -10, maxX: 10, minY: -20, maxY: 20 }, limits);
		// No segment may jump from one side of the asymptote to the other through it.
		for (const segment of geometry) {
			for (let i = 0; i < segment.length - 1; i++) {
				const a = segment[i];
				const b = segment[i + 1];
				expect(Math.sign(a.x) === Math.sign(b.x) || Math.abs(a.x) < 0.2 || Math.abs(b.x) < 0.2).toBe(
					true
				);
			}
		}
	});

	it('measures analytic arc distance, including endpoints', () => {
		const center = { x: 0, y: 0 };
		// Quarter arc from 0 to 90 degrees, radius 5
		expect(distancePointToArc({ x: 5, y: 0 }, center, 5, 0, Math.PI / 2)).toBeCloseTo(0, 9);
		expect(distancePointToArc({ x: 0, y: 5 }, center, 5, 0, Math.PI / 2)).toBeCloseTo(0, 9);
		expect(distancePointToArc({ x: 5, y: 5 }, center, 5, 0, Math.PI / 2)).toBeGreaterThan(1);
		// Distance to the nearer endpoint when the closest circle point is outside the sweep
		const d = distancePointToArc({ x: -10, y: 0 }, center, 5, 0, Math.PI / 2);
		expect(d).toBeCloseTo(Math.hypot(-10, -5), 9);
	});

	it('computes distance to a polyline', () => {
		const segments = [
			[
				{ x: -5, y: 0 },
				{ x: 5, y: 0 }
			],
			[
				{ x: 0, y: 0 },
				{ x: 0, y: 5 }
			]
		];
		expect(distancePointToSegments({ x: 3, y: 4 }, segments)).toBeCloseTo(3, 9);
		expect(distancePointToSegments({ x: 0, y: 0 }, segments)).toBe(0);
	});
});
