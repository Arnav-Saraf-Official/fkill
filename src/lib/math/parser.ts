/**
 * A small, safe expression language for f(kill).
 *
 * Grammar (allowlisted, no code execution):
 *   expr    := term (('+'|'-') term)*
 *   term    := unary (('*'|'/') unary | implicit-mul unary)*
 *   unary   := ('-'|'+') unary | power
 *   power   := atom ('^' unary)?          // right associative
 *   atom    := number | 'x' | constant | call | '(' expr ')'
 *   call    := func '(' expr ')'
 *
 * There is no `eval` / `new Function` and no access to globals. Input length,
 * AST node count and AST depth are all bounded by `SafetyLimits`.
 */

import type { SafetyLimits, ValidationIssue } from '../game/types';

export type FunctionName =
	| 'sin'
	| 'cos'
	| 'tan'
	| 'asin'
	| 'acos'
	| 'atan'
	| 'sqrt'
	| 'abs'
	| 'exp'
	| 'ln'
	| 'log';

export const ALLOWED_FUNCTIONS: readonly FunctionName[] = [
	'sin',
	'cos',
	'tan',
	'asin',
	'acos',
	'atan',
	'sqrt',
	'abs',
	'exp',
	'ln',
	'log'
];

export const ALLOWED_CONSTANTS = ['pi', 'e', 'tau'] as const;
export type ConstantName = (typeof ALLOWED_CONSTANTS)[number];

export type AstNode =
	| { kind: 'num'; value: number }
	| { kind: 'var' }
	| { kind: 'const'; name: ConstantName }
	| { kind: 'unary'; op: '-' | '+'; arg: AstNode }
	| { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: AstNode; right: AstNode }
	| { kind: 'call'; name: FunctionName; arg: AstNode };

export class ExpressionError extends Error {
	readonly position: number;
	readonly code: string;

	constructor(message: string, position = 0, code = 'syntax') {
		super(message);
		this.name = 'ExpressionError';
		this.position = position;
		this.code = code;
	}
}

interface Token {
	type: 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma';
	value: string;
	pos: number;
}

const SUPERS: Record<string, string> = {
	'⁰': '0',
	'¹': '1',
	'²': '2',
	'³': '3',
	'⁴': '4',
	'⁵': '5',
	'⁶': '6',
	'⁷': '7',
	'⁸': '8',
	'⁹': '9'
};

/** Normalise typographic sugar into plain ASCII the tokenizer understands. */
export function normaliseExpression(input: string): string {
	let out = '';
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch in SUPERS) {
			// Collect a run of superscript digits into one exponent group.
			let digits = '';
			while (i < input.length && input[i] in SUPERS) {
				digits += SUPERS[input[i]];
				i++;
			}
			i--;
			out += '^(' + digits + ')';
			continue;
		}
		switch (ch) {
			case '−':
			case '–':
			case '—':
				out += '-';
				break;
			case '×':
			case '·':
				out += '*';
				break;
			case '÷':
				out += '/';
				break;
			case 'π':
				out += 'pi';
				break;
			case '√':
				out += 'sqrt';
				break;
			case ' ':
			case '\t':
			case '\u00a0':
				out += ' ';
				break;
			default:
				out += ch;
		}
	}
	return out;
}

const FUNC_ALIASES: Record<string, FunctionName> = {
	sin: 'sin',
	cos: 'cos',
	tan: 'tan',
	asin: 'asin',
	acos: 'acos',
	atan: 'atan',
	arcsin: 'asin',
	arccos: 'acos',
	arctan: 'atan',
	sqrt: 'sqrt',
	abs: 'abs',
	exp: 'exp',
	ln: 'ln',
	log: 'log'
};

function tokenize(src: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (ch === ' ' || ch === '\t') {
			i++;
			continue;
		}
		if (/[0-9.]/.test(ch)) {
			const start = i;
			let seenDot = false;
			while (i < src.length && /[0-9.]/.test(src[i])) {
				if (src[i] === '.') {
					if (seenDot) throw new ExpressionError('Malformed number', i, 'number');
					seenDot = true;
				}
				i++;
			}
			// Scientific notation: 1e-3, 2.5E4
			if (i < src.length && /[eE]/.test(src[i])) {
				const expStart = i;
				let j = i + 1;
				if (j < src.length && (src[j] === '+' || src[j] === '-')) j++;
				if (j < src.length && /[0-9]/.test(src[j])) {
					while (j < src.length && /[0-9]/.test(src[j])) j++;
					i = j;
				} else {
					i = expStart;
				}
			}
			const raw = src.slice(start, i);
			if (raw === '.' || Number.isNaN(Number(raw))) {
				throw new ExpressionError(`Malformed number "${raw}"`, start, 'number');
			}
			tokens.push({ type: 'num', value: raw, pos: start });
			continue;
		}
		if (/[a-zA-Z_]/.test(ch)) {
			const start = i;
			while (i < src.length && /[a-zA-Z_0-9]/.test(src[i])) i++;
			tokens.push({ type: 'ident', value: src.slice(start, i), pos: start });
			continue;
		}
		if ('+-*/^'.includes(ch)) {
			tokens.push({ type: 'op', value: ch, pos: i });
			i++;
			continue;
		}
		if (ch === '(') {
			tokens.push({ type: 'lparen', value: ch, pos: i });
			i++;
			continue;
		}
		if (ch === ')') {
			tokens.push({ type: 'rparen', value: ch, pos: i });
			i++;
			continue;
		}
		if (ch === ',') {
			tokens.push({ type: 'comma', value: ch, pos: i });
			i++;
			continue;
		}
		if (ch === '=') {
			throw new ExpressionError(
				'Only the right-hand side of y = f(x) is expected',
				i,
				'assignment'
			);
		}
		throw new ExpressionError(`Unsupported character "${ch}"`, i, 'character');
	}
	return tokens;
}

/** Strip an optional `y =` / `f(x) =` prefix. */
export function stripAssignment(raw: string): string {
	return raw.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '');
}

interface ParseContext {
	tokens: Token[];
	index: number;
	limits: SafetyLimits;
	nodes: number;
}

function countNode(ctx: ParseContext, pos: number): void {
	ctx.nodes++;
	if (ctx.nodes > ctx.limits.maxAstNodes) {
		throw new ExpressionError(
			`Expression is too complex (more than ${ctx.limits.maxAstNodes} terms)`,
			pos,
			'too-complex'
		);
	}
}

function depthGuard(depth: number, limits: SafetyLimits, pos: number): void {
	if (depth > limits.maxAstDepth) {
		throw new ExpressionError(
			`Expression nesting is too deep (limit ${limits.maxAstDepth})`,
			pos,
			'too-deep'
		);
	}
}

function peek(ctx: ParseContext): Token | undefined {
	return ctx.tokens[ctx.index];
}

function parseExpr(ctx: ParseContext, depth: number): AstNode {
	depthGuard(depth, ctx.limits, peek(ctx)?.pos ?? 0);
	let left = parseTerm(ctx, depth + 1);
	for (;;) {
		const tok = peek(ctx);
		if (tok && tok.type === 'op' && (tok.value === '+' || tok.value === '-')) {
			ctx.index++;
			const right = parseTerm(ctx, depth + 1);
			countNode(ctx, tok.pos);
			left = { kind: 'binary', op: tok.value as '+' | '-', left, right };
		} else break;
	}
	return left;
}

function parseTerm(ctx: ParseContext, depth: number): AstNode {
	let left = parseUnary(ctx, depth + 1);
	for (;;) {
		const tok = peek(ctx);
		if (tok && tok.type === 'op' && (tok.value === '*' || tok.value === '/')) {
			ctx.index++;
			const right = parseUnary(ctx, depth + 1);
			countNode(ctx, tok.pos);
			left = { kind: 'binary', op: tok.value as '*' | '/', left, right };
			continue;
		}
		// Implicit multiplication: 2x, 3sin(x), (x+1)(x-1), x(x+1)
		if (tok && (tok.type === 'num' || tok.type === 'ident' || tok.type === 'lparen')) {
			const right = parseUnary(ctx, depth + 1);
			countNode(ctx, tok.pos);
			left = { kind: 'binary', op: '*', left, right };
			continue;
		}
		break;
	}
	return left;
}

function parseUnary(ctx: ParseContext, depth: number): AstNode {
	depthGuard(depth, ctx.limits, peek(ctx)?.pos ?? 0);
	const tok = peek(ctx);
	if (tok && tok.type === 'op' && (tok.value === '-' || tok.value === '+')) {
		ctx.index++;
		const arg = parseUnary(ctx, depth + 1);
		countNode(ctx, tok.pos);
		return { kind: 'unary', op: tok.value as '-' | '+', arg };
	}
	return parsePower(ctx, depth + 1);
}

function parsePower(ctx: ParseContext, depth: number): AstNode {
	const base = parseAtom(ctx, depth + 1);
	const tok = peek(ctx);
	if (tok && tok.type === 'op' && tok.value === '^') {
		ctx.index++;
		const exponent = parseUnary(ctx, depth + 1);
		countNode(ctx, tok.pos);
		return { kind: 'binary', op: '^', left: base, right: exponent };
	}
	return base;
}

function parseAtom(ctx: ParseContext, depth: number): AstNode {
	depthGuard(depth, ctx.limits, peek(ctx)?.pos ?? 0);
	const tok = peek(ctx);
	if (!tok) throw new ExpressionError('Unexpected end of expression', 0, 'unexpected-end');
	ctx.index++;

	if (tok.type === 'num') {
		countNode(ctx, tok.pos);
		return { kind: 'num', value: Number(tok.value) };
	}
	if (tok.type === 'lparen') {
		const inner = parseExpr(ctx, depth + 1);
		const close = peek(ctx);
		if (!close || close.type !== 'rparen') {
			throw new ExpressionError('Expected ")"', tok.pos, 'expected-paren');
		}
		ctx.index++;
		return inner;
	}
	if (tok.type === 'ident') {
		const name = tok.value.toLowerCase();
		const next = peek(ctx);
		const fn = FUNC_ALIASES[name];
		const isVariableOrConstant =
			name === 'x' || (ALLOWED_CONSTANTS as readonly string[]).includes(name);
		if (next && next.type === 'lparen' && !fn && !isVariableOrConstant) {
			throw new ExpressionError(
				`Unknown function "${tok.value}". Supported: ${ALLOWED_FUNCTIONS.join(', ')}`,
				tok.pos,
				'unknown-function'
			);
		}
		// `x(x+1)` and `2(x+1)` are implicit multiplication, not calls.
		if (next && next.type === 'lparen' && fn) {
			ctx.index++;
			const arg = parseExpr(ctx, depth + 1);
			const comma = peek(ctx);
			if (comma && comma.type === 'comma') {
				throw new ExpressionError(
					`${fn}() takes exactly one argument`,
					comma.pos,
					'arity'
				);
			}
			const close = peek(ctx);
			if (!close || close.type !== 'rparen') {
				throw new ExpressionError('Expected ")"', tok.pos, 'expected-paren');
			}
			ctx.index++;
			countNode(ctx, tok.pos);
			return { kind: 'call', name: fn, arg };
		}
		if (name === 'x') {
			countNode(ctx, tok.pos);
			return { kind: 'var' };
		}
		if ((ALLOWED_CONSTANTS as readonly string[]).includes(name)) {
			countNode(ctx, tok.pos);
			return { kind: 'const', name: name as ConstantName };
		}
		throw new ExpressionError(
			`Unknown symbol "${tok.value}". The only variable is x; constants are pi and e.`,
			tok.pos,
			'unknown-symbol'
		);
	}
	if (tok.type === 'rparen') {
		throw new ExpressionError('Unexpected ")"', tok.pos, 'unexpected-paren');
	}
	if (tok.type === 'comma') {
		throw new ExpressionError('Unexpected ","', tok.pos, 'unexpected-comma');
	}
	throw new ExpressionError(`Unexpected token "${tok.value}"`, tok.pos, 'unexpected-token');
}

export interface ParseSuccess {
	ok: true;
	ast: AstNode;
}

export interface ParseFailure {
	ok: false;
	error: ExpressionError;
	issue: ValidationIssue;
}

export type ParseResult = ParseSuccess | ParseFailure;

export function parseExpression(raw: string, limits: SafetyLimits): ParseResult {
	const source = stripAssignment(raw ?? '');
	if (!source.trim()) {
		const error = new ExpressionError('Enter an expression', 0, 'empty');
		return { ok: false, error, issue: { code: error.code, message: error.message } };
	}
	if (source.length > limits.maxExpressionLength) {
		const error = new ExpressionError(
			`Expression is too long (limit ${limits.maxExpressionLength} characters)`,
			0,
			'too-long'
		);
		return { ok: false, error, issue: { code: error.code, message: error.message, position: 0 } };
	}
	try {
		const normalised = normaliseExpression(source);
		const ctx: ParseContext = { tokens: tokenize(normalised), index: 0, limits, nodes: 0 };
		if (ctx.tokens.length === 0) {
			throw new ExpressionError('Enter an expression', 0, 'empty');
		}
		const ast = parseExpr(ctx, 0);
		if (ctx.index < ctx.tokens.length) {
			const extra = ctx.tokens[ctx.index];
			throw new ExpressionError(
				`Unexpected "${extra.value}" after the expression`,
				extra.pos,
				'trailing'
			);
		}
		return { ok: true, ast };
	} catch (err) {
		const error =
			err instanceof ExpressionError
				? err
				: new ExpressionError('Could not parse the expression', 0, 'syntax');
		return {
			ok: false,
			error,
			issue: { code: error.code, message: error.message, position: error.position }
		};
	}
}

const CACHE_LIMIT = 256;
const cache = new Map<string, ParseResult>();

/** Parse with a bounded memo cache. Keyed on source text only. */
export function parseCached(raw: string, limits: SafetyLimits): ParseResult {
	const key = raw;
	const hit = cache.get(key);
	if (hit) return hit;
	const result = parseExpression(raw, limits);
	if (cache.size >= CACHE_LIMIT) {
		const first = cache.keys().next();
		if (!first.done) cache.delete(first.value);
	}
	cache.set(key, result);
	return result;
}

export function clearParseCache(): void {
	cache.clear();
}
