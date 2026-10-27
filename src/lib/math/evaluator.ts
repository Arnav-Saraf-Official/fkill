import type { AstNode, ConstantName } from './parser';

const CONSTANT_VALUES: Record<ConstantName, number> = {
	pi: Math.PI,
	e: Math.E,
	tau: Math.PI * 2
};

/**
 * Evaluate an AST at `x`.
 *
 * Domain violations produce NaN, and true singularities produce ±Infinity.
 * Neither throws. This is deliberate: the root analyser and sampler use
 * infinities to recognise asymptotes, and the UI treats non-finite values as
 * "no graph here" rather than as an error.
 */
export function evaluate(ast: AstNode, x: number): number {
	switch (ast.kind) {
		case 'num':
			return ast.value;
		case 'var':
			return x;
		case 'const':
			return CONSTANT_VALUES[ast.name];
		case 'unary': {
			const v = evaluate(ast.arg, x);
			return ast.op === '-' ? -v : v;
		}
		case 'binary': {
			const a = evaluate(ast.left, x);
			const b = evaluate(ast.right, x);
			switch (ast.op) {
				case '+':
					return a + b;
				case '-':
					return a - b;
				case '*':
					return a * b;
				case '/':
					// JS division already gives ±Infinity (or NaN for 0/0), which is
					// exactly the information the analyser needs.
					return a / b;
				case '^':
					// Negative base with fractional exponent is not real-valued.
					if (a < 0 && !Number.isInteger(b)) return NaN;
					return Math.pow(a, b);
			}
			return NaN;
		}
		case 'call': {
			const v = evaluate(ast.arg, x);
			switch (ast.name) {
				case 'sin':
					return Math.sin(v);
				case 'cos':
					return Math.cos(v);
				case 'tan':
					return Math.tan(v);
				case 'asin':
					return Math.asin(v);
				case 'acos':
					return Math.acos(v);
				case 'atan':
					return Math.atan(v);
				case 'sqrt':
					return v < 0 ? NaN : Math.sqrt(v);
				case 'abs':
					return Math.abs(v);
				case 'exp':
					return Math.exp(v);
				case 'ln':
					return v <= 0 ? (v === 0 ? -Infinity : NaN) : Math.log(v);
				case 'log':
					return v <= 0 ? (v === 0 ? -Infinity : NaN) : Math.log10(v);
			}
			return NaN;
		}
	}
}

export type Evaluator = (x: number) => number;

export function makeEvaluator(ast: AstNode): Evaluator {
	return (x: number) => evaluate(ast, x);
}

export function isFiniteNumber(v: number): boolean {
	return typeof v === 'number' && Number.isFinite(v);
}

/** Clamp helper used by rendering code (never by gameplay maths). */
export function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}
