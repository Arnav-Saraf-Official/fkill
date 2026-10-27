/**
 * Grapher placement.
 *
 * Every generated position obeys:
 *  - the world bounds (with a margin so markers are visible),
 *  - the placement precision grid (multiples of 1/denominator),
 *  - obstacle clearance (no grapher starts inside cover),
 *  - separation from every other grapher.
 *
 * Generation is seeded and bounded. When no legal position is found the
 * separation requirement is relaxed in documented stages and, as a last
 * resort, a deterministic coarse scan is used. Placement never loops forever.
 */

import type { GameRules, MatchSetup, Obstacle, Vector2 } from './types';
import { shapeContains, shapeBounds } from './obstacles';
import { placementStep, snapToPlacementGrid } from './rules';
import type { Rng } from './rng';

export interface PlacementTarget {
	playerId: string;
	count: number;
}

export interface PlacementResult {
	positions: Record<string, Vector2[]>;
	warnings: string[];
}

const MARGIN = 2.5;
const OBSTACLE_CLEARANCE = 1.5;

function inWorld(rules: GameRules, p: Vector2): boolean {
	const half = rules.worldSize / 2 - MARGIN;
	return Math.abs(p.x) <= half && Math.abs(p.y) <= half;
}

function snaps(rules: GameRules, p: Vector2): boolean {
	const step = placementStep(rules);
	const eps = step * 1e-6;
	const nx = p.x / step;
	const ny = p.y / step;
	return Math.abs(nx - Math.round(nx)) < eps * 10 && Math.abs(ny - Math.round(ny)) < eps * 10;
}

export function distanceToObstacle(p: Vector2, obstacles: Obstacle[]): number {
	let best = Infinity;
	for (const obstacle of obstacles) {
		if (shapeContains(obstacle.shape, p)) return 0;
		const b = shapeBounds(obstacle.shape);
		const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
		const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
		best = Math.min(best, Math.hypot(dx, dy));
	}
	return best;
}

export interface PlacementCheck {
	rules: GameRules;
	obstacles: Obstacle[];
	existing: Vector2[];
	separation: number;
}

export function isLegalPlacement(p: Vector2, check: PlacementCheck): boolean {
	if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
	if (!inWorld(check.rules, p)) return false;
	if (!snaps(check.rules, p)) return false;
	if (distanceToObstacle(p, check.obstacles) < OBSTACLE_CLEARANCE) return false;
	for (const q of check.existing) {
		if (Math.hypot(p.x - q.x, p.y - q.y) < Math.max(check.separation, 0.5)) return false;
	}
	return true;
}

function snap(rules: GameRules, p: Vector2): Vector2 {
	return { x: snapToPlacementGrid(rules, p.x), y: snapToPlacementGrid(rules, p.y) };
}

function playerAnchors(rules: GameRules, targets: PlacementTarget[], rng: Rng): Vector2[] {
	const half = rules.worldSize / 2 - MARGIN * 2;
	const mode = rules.placement.distribution;
	if (mode === 'uniform' || mode === 'min-separation') {
		// Unanchored: positions are drawn across the whole plane, but each player
		// gets a coarse sector so loadouts do not interleave into one blob.
		const sector = (Math.PI * 2) / Math.max(1, targets.length);
		const offset = rng.range(0, Math.PI * 2);
		return targets.map((_, i) => {
			const angle = offset + sector * i + sector * 0.2;
			return { x: Math.cos(angle) * half * 0.45, y: Math.sin(angle) * half * 0.45 };
		});
	}
	if (mode === 'clustered') {
		return targets.map(() => ({
			x: rng.range(-half * 0.7, half * 0.7),
			y: rng.range(-half * 0.7, half * 0.7)
		}));
	}
	// even: players around a ring, evenly spaced
	const radius = Math.min(half * 0.75, 18);
	const start = -Math.PI / 2;
	return targets.map((_, i) => {
		const angle = start + (Math.PI * 2 * i) / Math.max(1, targets.length);
		return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
	});
}

function candidateFromAnchor(
	rules: GameRules,
	anchor: Vector2,
	index: number,
	count: number,
	rng: Rng
): Vector2 {
	const mode = rules.placement.distribution;
	if (mode === 'clustered') {
		const angle = rng.range(0, Math.PI * 2);
		const radius = rng.range(1.5, Math.max(3, rules.placement.minSeparation * 0.5));
		return snap(rules, {
			x: anchor.x + Math.cos(angle) * radius,
			y: anchor.y + Math.sin(angle) * radius
		});
	}
	if (mode === 'even') {
		const angle = (Math.PI * 2 * index) / Math.max(1, count) + rng.range(-0.25, 0.25);
		const radius = rng.range(3, 8);
		return snap(rules, {
			x: anchor.x + Math.cos(angle) * radius,
			y: anchor.y + Math.sin(angle) * radius
		});
	}
	// uniform / min-separation: anywhere inside the world, biased towards the
	// player's sector anchor so opponents start apart.
	const half = rules.worldSize / 2 - MARGIN;
	const spread = 12;
	return snap(rules, {
		x: Math.min(half, Math.max(-half, anchor.x + rng.range(-spread, spread))),
		y: Math.min(half, Math.max(-half, anchor.y + rng.range(-spread, spread)))
	});
}

function coarseFallback(rules: GameRules, existing: Vector2[], obstacles: Obstacle[]): Vector2 {
	const half = rules.worldSize / 2 - MARGIN;
	const search = { rules, obstacles, existing, separation: 0.5 };
	// Deterministic scan from the centre outward.
	for (let radius = 0; radius <= half * 2; radius += 1) {
		for (let a = 0; a < 32; a++) {
			const angle = (a / 32) * Math.PI * 2;
			const p = snap(rules, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
			if (isLegalPlacement(p, search)) return p;
		}
	}
	// Documented last resort: the origin, snapped, regardless of separation.
	return snap(rules, { x: 0, y: 0 });
}

export function generatePlacements(
	rules: GameRules,
	targets: PlacementTarget[],
	obstacles: Obstacle[],
	rng: Rng
): PlacementResult {
	const warnings: string[] = [];
	const positions: Record<string, Vector2[]> = {};
	const existing: Vector2[] = [];
	const anchors = playerAnchors(rules, targets, rng);

	targets.forEach((target, playerIndex) => {
		const anchor = anchors[playerIndex] ?? { x: 0, y: 0 };
		const list: Vector2[] = [];
		for (let i = 0; i < target.count; i++) {
			let placed: Vector2 | null = null;
			const anchorLegal = isLegalPlacement(snap(rules, anchor), {
				rules,
				obstacles,
				existing,
				separation: rules.placement.minSeparation
			});
			const separationStages = [rules.placement.minSeparation, rules.placement.minSeparation * 0.6, rules.placement.minSeparation * 0.3, 0.5];
			for (const separation of separationStages) {
				for (let attempt = 0; attempt < 160; attempt++) {
					const candidate = candidateFromAnchor(rules, anchor, i, target.count, rng);
					if (
						isLegalPlacement(candidate, {
							rules,
							obstacles,
							existing,
							separation
						})
					) {
						placed = candidate;
						break;
					}
				}
				if (placed) break;
			}
			if (!placed) {
				placed = coarseFallback(rules, existing, obstacles);
				warnings.push(
					`No ideal position was found for ${target.playerId}'s grapher ${i + 1}; a fallback position was used.`
				);
			}
			void anchorLegal;
			list.push(placed);
			existing.push(placed);
		}
		positions[target.playerId] = list;
	});

	return { positions, warnings };
}

/** Snap and validate player-supplied placements. */
export function prepareManualPlacements(
	rules: GameRules,
	setup: MatchSetup,
	obstacles: Obstacle[]
): { ok: true; positions: Record<string, Vector2[]>; warnings: string[] } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const positions: Record<string, Vector2[]> = {};
	const existing: Vector2[] = [];
	for (const player of setup.players) {
		const supplied = setup.manualPlacements?.[player.id];
		if (!supplied) {
			warnings.push(`No placement supplied for ${player.name}; positions will be generated.`);
			continue;
		}
		if (supplied.length !== player.loadout.length) {
			errors.push(`${player.name} must place exactly ${player.loadout.length} graphers`);
			continue;
		}
		const list: Vector2[] = [];
		supplied.forEach((raw, i) => {
			const p = snap(rules, raw);
			if (!inWorld(rules, p)) {
				errors.push(`${player.name}: grapher ${i + 1} is outside the playable area`);
				return;
			}
			if (!snaps(rules, p)) {
				errors.push(`${player.name}: grapher ${i + 1} does not align to the 1/${rules.precision.denominator} grid`);
				return;
			}
			if (distanceToObstacle(p, obstacles) < OBSTACLE_CLEARANCE) {
				errors.push(`${player.name}: grapher ${i + 1} overlaps an obstacle`);
				return;
			}
			for (const q of existing) {
				if (Math.hypot(p.x - q.x, p.y - q.y) < 1) {
					errors.push(`${player.name}: grapher ${i + 1} is too close to another grapher`);
					return;
				}
			}
			list.push(p);
			existing.push(p);
		});
		if (list.length === player.loadout.length) positions[player.id] = list;
	}
	if (errors.length > 0) return { ok: false, errors };
	return { ok: true, positions, warnings };
}
