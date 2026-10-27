/**
 * Attack validation and geometry preparation.
 *
 * This is the only place where an attack becomes legal geometry. Player input,
 * CPU candidates and authoritative submissions all pass through it, so the
 * same restrictions are enforced everywhere. Nothing is silently clamped:
 * invalid input produces a positional, human-readable issue.
 */

import type {
	ArcComponentInput,
	AttackComponentInput,
	GameRules,
	GrapherType,
	SafetyLimits,
	ValidationIssue,
	Vector2
} from '../game/types';
import type { Bounds, CurveSegments } from './geometry';
import { boundsOf, degToRad, intersectBounds } from './geometry';
import type { AstNode } from './parser';
import { parseCached } from './parser';
import { analyseRoots } from './roots';
import { sampleArcPoints, sampleFunctionGeometry } from './sampling';
import { attackWindow, localToWorld, worldBounds } from './transforms';
import type { CoordinateFrame } from './transforms';
import { clipPolylineToBounds } from './geometry';
import { evaluate } from './evaluator';

export interface PreparedFunctionComponent {
	kind: 'function';
	expression: string;
	ast: AstNode;
	rootCount: number;
	roots: number[];
	/** Geometry in the grapher's local frame, clipped to its valid window. */
	local: CurveSegments;
	/** Geometry in world coordinates, clipped to the world plane. */
	world: CurveSegments;
}

export interface PreparedArcComponent {
	kind: 'arc';
	input: ArcComponentInput;
	centerLocal: Vector2;
	centerWorld: Vector2;
	radius: number;
	/** Radians, world orientation. */
	startRadWorld: number;
	sweepRad: number;
	local: CurveSegments;
	world: CurveSegments;
}

export type PreparedComponent = PreparedFunctionComponent | PreparedArcComponent;

export type PrepareResult =
	| { ok: true; components: PreparedComponent[]; rootCountTotal: number }
	| { ok: false; issues: ValidationIssue[] };

function issue(
	message: string,
	componentIndex?: number,
	position?: number,
	code = 'invalid'
): ValidationIssue {
	return { code, message, componentIndex, position };
}

function prepareArc(
	rules: GameRules,
	type: GrapherType,
	frame: CoordinateFrame,
	raw: ArcComponentInput,
	componentIndex: number,
	issues: ValidationIssue[]
): PreparedArcComponent | null {
	const def = rules.grapherTypes[type];
	const window = attackWindow(rules, type);
	const world = worldBounds(rules);

	const center = raw.center;
	if (!center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) {
		issues.push(issue('Arc centre must be a finite (x, y) pair', componentIndex, undefined, 'arc-center'));
		return null;
	}
	const maxRadius = def.maxArcRadius ?? 0;
	const radius = raw.radius;
	if (!Number.isFinite(radius) || radius <= 0) {
		issues.push(issue('Arc radius must be greater than 0', componentIndex, undefined, 'arc-radius'));
		return null;
	}
	if (radius > maxRadius + 1e-9) {
		issues.push(
			issue(`Arc radius ${radius} exceeds the ${def.label} limit of ${maxRadius} units`, componentIndex, undefined, 'arc-radius')
		);
		return null;
	}
	const maxSweep = def.maxArcSweepDegrees ?? 180;
	const sweepDeg = raw.sweepAngleDeg;
	if (!Number.isFinite(sweepDeg) || sweepDeg === 0) {
		issues.push(issue('Arc sweep must be a non-zero angle in degrees', componentIndex, undefined, 'arc-sweep'));
		return null;
	}
	if (Math.abs(sweepDeg) > maxSweep + 1e-9) {
		issues.push(
			issue(`Arc sweep ${Math.abs(sweepDeg)}° exceeds the ${def.label} limit of ${maxSweep}°`, componentIndex, undefined, 'arc-sweep')
		);
		return null;
	}
	if (!Number.isFinite(raw.startAngleDeg)) {
		issues.push(issue('Arc start angle must be a finite number of degrees', componentIndex, undefined, 'arc-angle'));
		return null;
	}
	if (center.x < window.minX || center.x > window.maxX || center.y < window.minY || center.y > window.maxY) {
		issues.push(
			issue(
				`Arc centre must lie inside the grapher's ${def.domainRangeSpan}-unit coordinate window`,
				componentIndex,
				undefined,
				'arc-center'
			)
		);
		return null;
	}

	const startRadLocal = degToRad(raw.startAngleDeg);
	const sweepRad = degToRad(sweepDeg);
	const localPoints = sampleArcPoints(center, radius, startRadLocal, sweepRad);
	const localSegments = clipPolylineToBounds(localPoints, window);
	const local = localSegments.filter((s) => s.length >= 2);
	if (local.length === 0) {
		issues.push(issue('The arc lies entirely outside the grapher\'s valid range', componentIndex, undefined, 'arc-outside'));
		return null;
	}
	const worldSegments: CurveSegments = [];
	for (const segment of local) {
		const transformed = segment.map((p) => localToWorld(frame, p));
		for (const piece of clipPolylineToBounds(transformed, world)) {
			if (piece.length >= 2) worldSegments.push(piece);
		}
	}
	if (worldSegments.length === 0) {
		issues.push(issue('The arc lies entirely outside the playable plane', componentIndex, undefined, 'arc-outside'));
		return null;
	}

	return {
		kind: 'arc',
		input: { ...raw, center: { ...center } },
		centerLocal: { ...center },
		centerWorld: localToWorld(frame, center),
		radius,
		startRadWorld: startRadLocal + frame.rotation,
		sweepRad,
		local,
		world: worldSegments
	};
}

export function prepareAttack(
	rules: GameRules,
	type: GrapherType,
	frame: CoordinateFrame,
	raw: readonly AttackComponentInput[]
): PrepareResult {
	const def = rules.grapherTypes[type];
	const limits: SafetyLimits = rules.limits;
	const issues: ValidationIssue[] = [];
	const components: PreparedComponent[] = [];
	const window = attackWindow(rules, type);
	const world = worldBounds(rules);
	const clipped = intersectBounds(window, world) ?? window;

	if (!raw || raw.length === 0) {
		return { ok: false, issues: [issue('Add at least one attack component', 0)] };
	}

	if (def.attackMode === 'arc') {
		if (raw.length !== 1) {
			return {
				ok: false,
				issues: [issue(`The ${def.label} fires exactly one arc`, 0)]
			};
		}
		const component = raw[0];
		if (component.kind !== 'arc') {
			return { ok: false, issues: [issue(`${def.label} attacks use arc parameters, not a function`, 0)] };
		}
		const prepared = prepareArc(rules, type, frame, component, 0, issues);
		if (!prepared) return { ok: false, issues };
		return { ok: true, components: [prepared], rootCountTotal: 0 };
	}

	const maxFunctions = def.attackMode === 'multi-function' ? Math.max(1, def.maxFunctions ?? 1) : 1;
	if (raw.length > maxFunctions) {
		issues.push(
			issue(
				def.attackMode === 'multi-function'
					? `${def.label} allows at most ${maxFunctions} functions per attack`
					: `${def.label} fires one function per attack`,
				0
			)
		);
		return { ok: false, issues };
	}

	let rootTotal = 0;
	const rootBudget = def.attackMode === 'multi-function' ? (def.maxTotalRoots ?? def.maxRoots) : def.maxRoots;
	const perFunctionLimit = def.maxRoots;

	raw.forEach((component, index) => {
		if (component.kind === 'arc') {
			issues.push(issue(`${def.label} attacks use y = f(x) functions, not arcs`, index));
			return;
		}
		const expression = component.expression ?? '';
		const parsed = parseCached(expression, limits);
		if (!parsed.ok) {
			issues.push(
				issue(parsed.issue.message, index, parsed.issue.position, parsed.issue.code)
			);
			return;
		}
		const ast = parsed.ast;

		// Cheap sanity check before sampling: the expression must produce some
		// finite value inside the window, otherwise it cannot be a valid attack.
		let finiteFound = false;
		const probe = 32;
		for (let i = 0; i <= probe; i++) {
			const x = clipped.minX + ((clipped.maxX - clipped.minX) * i) / probe;
			const y = evaluate(ast, x);
			if (Number.isFinite(y)) {
				finiteFound = true;
				break;
			}
		}
		if (!finiteFound) {
			issues.push(issue('The function is undefined for every x in the valid range', index));
			return;
		}

		// The per-type root budget is the gameplay limit; the safety cap keeps a
		// deliberately huge custom budget from turning into unbounded work.
		const rootCountCap = Math.max(1, Math.min(perFunctionLimit, limits.maxRootsToCount));
		const roots = analyseRoots(ast, window.minX, window.maxX, limits, {
			maxCount: rootCountCap,
			grid: limits.maxRootGrid
		});
		if (roots.degenerate) {
			issues.push(
				issue('This function is zero everywhere, so it has infinitely many roots', index)
			);
			return;
		}
		if (roots.exceeded || roots.count > perFunctionLimit) {
			issues.push(
				issue(
					`Too many roots: the ${def.label} limit is ${perFunctionLimit} and the safety count limit is ${limits.maxRootsToCount}`,
					index,
					undefined,
					'roots'
				)
			);
			return;
		}

		rootTotal += roots.count;
		if (def.attackMode === 'multi-function' && rootTotal > rootBudget) {
			issues.push(
				issue(
					`Shared root budget exceeded: ${rootTotal} roots across ${index + 1} functions, limit is ${rootBudget}`,
					index,
					undefined,
					'root-budget'
				)
			);
			return;
		}

		const localSegments = sampleFunctionGeometry(ast, clipped, limits);
		const local = localSegments.filter((s) => s.length >= 2);
		if (local.length === 0) {
			issues.push(
				issue('The curve never enters the grapher\'s valid coordinate window', index, undefined, 'outside')
			);
			return;
		}
		const worldSegments: CurveSegments = [];
		for (const segment of local) {
			const transformed = segment.map((p) => localToWorld(frame, p));
			for (const piece of clipPolylineToBounds(transformed, world)) {
				if (piece.length >= 2) worldSegments.push(piece);
			}
		}
		if (worldSegments.length === 0) {
			issues.push(issue('The curve never enters the playable plane', index, undefined, 'outside'));
			return;
		}

		components.push({
			kind: 'function',
			expression,
			ast,
			rootCount: roots.count,
			roots: roots.roots,
			local,
			world: worldSegments
		});
	});

	if (issues.length > 0) return { ok: false, issues };
	if (components.length === 0) {
		return { ok: false, issues: [issue('Add at least one function', 0)] };
	}
	return { ok: true, components, rootCountTotal: rootTotal };
}

/** Number of distinct roots in the local window, for the editor's live counter. */
export function countRootsForPreview(
	rules: GameRules,
	type: GrapherType,
	expression: string
): { ok: boolean; count: number; exceeded: boolean; error?: string } {
	const limits = rules.limits;
	const def = rules.grapherTypes[type];
	const parsed = parseCached(expression, limits);
	if (!parsed.ok) return { ok: false, count: 0, exceeded: false, error: parsed.issue.message };
	const window = attackWindow(rules, type);
	const analysis = analyseRoots(parsed.ast, window.minX, window.maxX, limits, {
		maxCount: Math.max(1, Math.min(def.maxRoots, limits.maxRootsToCount)),
		grid: limits.maxRootGrid
	});
	return { ok: true, count: analysis.count, exceeded: analysis.exceeded || analysis.degenerate };
}

/** Exposed for tests: geometry bounds helper. */
export function geometryWorldBounds(segments: CurveSegments): Bounds | null {
	return boundsOf(segments);
}
