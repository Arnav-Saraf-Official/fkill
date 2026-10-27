/**
 * Obstacles are real geometry, not decoration.
 *
 * Each obstacle is a shape (circle, polygon/blob, rounded rectangle) filled
 * with a grid of independently destructible sections. Sections block attack
 * paths while intact, absorb `damageToObstacles` per crossing, and stop
 * blocking once destroyed. Damage is strictly local: destroying one section
 * never deletes the whole obstacle.
 */

import type {
	GameRules,
	Obstacle,
	ObstacleSection,
	ObstacleShape,
	Vector2
} from './types';
import type { Bounds } from '../math/geometry';
import {
	clipSegmentToBounds,
	pointInCircle,
	pointInPolygon,
	pointInRoundRect
} from '../math/geometry';
import type { Rng } from './rng';

export function shapeBounds(shape: ObstacleShape): Bounds {
	switch (shape.kind) {
		case 'circle':
			return {
				minX: shape.center.x - shape.radius,
				maxX: shape.center.x + shape.radius,
				minY: shape.center.y - shape.radius,
				maxY: shape.center.y + shape.radius
			};
		case 'polygon': {
			const xs = shape.points.map((p) => p.x);
			const ys = shape.points.map((p) => p.y);
			return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
		}
		case 'roundRect':
			return {
				minX: shape.x,
				maxX: shape.x + shape.width,
				minY: shape.y,
				maxY: shape.y + shape.height
			};
	}
}

export function shapeContains(shape: ObstacleShape, p: Vector2): boolean {
	switch (shape.kind) {
		case 'circle':
			return pointInCircle(p, shape.center, shape.radius);
		case 'polygon':
			return pointInPolygon(p, shape.points);
		case 'roundRect':
			return pointInRoundRect(p, shape.x, shape.y, shape.width, shape.height, shape.cornerRadius);
	}
}

export function sectionBounds(section: ObstacleSection): Bounds {
	const half = section.size / 2;
	return {
		minX: section.center.x - half,
		maxX: section.center.x + half,
		minY: section.center.y - half,
		maxY: section.center.y + half
	};
}

/** Fill a shape with sections whose centres lie inside it. */
export function buildSections(
	obstacleId: string,
	shape: ObstacleShape,
	size: number,
	durability: number
): ObstacleSection[] {
	const b = shapeBounds(shape);
	const sections: ObstacleSection[] = [];
	const cols = Math.ceil((b.maxX - b.minX) / size);
	const rows = Math.ceil((b.maxY - b.minY) / size);
	let index = 0;
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const center = {
				x: b.minX + size * (col + 0.5),
				y: b.minY + size * (row + 0.5)
			};
			if (!shapeContains(shape, center)) continue;
			sections.push({
				id: `${obstacleId}_s${index++}`,
				center,
				size,
				maxDurability: durability,
				durability,
				destroyed: false
			});
		}
	}
	return sections;
}

export function buildObstacle(
	id: string,
	shape: ObstacleShape,
	rules: GameRules,
	indestructible = rules.obstacles.indestructible
): Obstacle {
	// Durability stays finite so the whole state is JSON-safe; the obstacle's
	// `indestructible` flag is what prevents damage in `damageSection`.
	return {
		id,
		shape,
		indestructible,
		sections: buildSections(id, shape, rules.obstacles.sectionSize, rules.obstacles.durability)
	};
}

function withinWorld(rules: GameRules, shape: ObstacleShape, margin = 3): boolean {
	const half = rules.worldSize / 2 - margin;
	const b = shapeBounds(shape);
	return b.minX >= -half && b.maxX <= half && b.minY >= -half && b.maxY <= half;
}

function clampInWorld(rules: GameRules, shape: ObstacleShape, margin = 3): ObstacleShape {
	const half = rules.worldSize / 2 - margin;
	const b = shapeBounds(shape);
	const dx = Math.max(0, -half - b.minX) - Math.max(0, b.maxX - half);
	const dy = Math.max(0, -half - b.minY) - Math.max(0, b.maxY - half);
	if (dx === 0 && dy === 0) return shape;
	switch (shape.kind) {
		case 'circle':
			return { ...shape, center: { x: shape.center.x + dx, y: shape.center.y + dy } };
		case 'polygon':
			return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
		case 'roundRect':
			return { ...shape, x: shape.x + dx, y: shape.y + dy };
	}
}

function blobShape(center: Vector2, radius: number, rng: Rng): ObstacleShape {
	const points: Vector2[] = [];
	const lobes = 7 + rng.int(5);
	for (let i = 0; i < lobes; i++) {
		const angle = (i / lobes) * Math.PI * 2;
		const wobble = 0.72 + rng.next() * 0.42;
		points.push({
			x: center.x + Math.cos(angle) * radius * wobble,
			y: center.y + Math.sin(angle) * radius * wobble
		});
	}
	return { kind: 'polygon', points };
}

function randomShape(rules: GameRules, rng: Rng, center: Vector2, size: number): ObstacleShape {
	const roll = rng.next();
	if (roll < 0.36) return { kind: 'circle', center, radius: size };
	if (roll < 0.68) return blobShape(center, size, rng);
	const w = size * 1.6;
	const h = size * 1.2;
	const angle = rng.range(0, Math.PI);
	const cx = Math.cos(angle);
	const sx = Math.sin(angle);
	// Axis-aligned bounds of the rotated rectangle, expressed as a polygon so
	// rotations are supported without a second intersection implementation.
	const corners = [
		{ x: -w / 2, y: -h / 2 },
		{ x: w / 2, y: -h / 2 },
		{ x: w / 2, y: h / 2 },
		{ x: -w / 2, y: h / 2 }
	].map((p) => ({ x: center.x + p.x * cx - p.y * sx, y: center.y + p.x * sx + p.y * cx }));
	if (rng.next() < 0.5) {
		return {
			kind: 'roundRect',
			x: Math.min(...corners.map((c) => c.x)),
			y: Math.min(...corners.map((c) => c.y)),
			width: Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x)),
			height: Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y)),
			cornerRadius: Math.min(w, h) * 0.25
		};
	}
	return { kind: 'polygon', points: corners };
}

/** Predefined arrangements plus seeded random generation. */
export function createObstacles(rules: GameRules, seed: string, rng: Rng): Obstacle[] {
	if (!rules.obstacles.enabled || rules.obstacles.arrangement === 'none') return [];
	const obs = rules.obstacles;
	const shapes: ObstacleShape[] = [];

	if (obs.arrangement === 'corridor') {
		const half = rules.worldSize / 2;
		shapes.push({
			kind: 'roundRect',
			x: -6,
			y: -half + 5,
			width: 3,
			height: half - 11,
			cornerRadius: 1.2
		});
		shapes.push({
			kind: 'roundRect',
			x: 3,
			y: -half + 5,
			width: 3,
			height: half - 11,
			cornerRadius: 1.2
		});
		shapes.push({ kind: 'circle', center: { x: 0, y: 8 }, radius: 2.6 });
		shapes.push({ kind: 'circle', center: { x: 0, y: -8 }, radius: 2.6 });
	} else if (obs.arrangement === 'fortress') {
		shapes.push({
			kind: 'roundRect',
			x: -5,
			y: -3,
			width: 10,
			height: 6,
			cornerRadius: 1.5
		});
		const ring = 7;
		for (let i = 0; i < 4; i++) {
			const angle = (Math.PI / 2) * i + Math.PI / 4;
			shapes.push({
				kind: 'circle',
				center: { x: Math.cos(angle) * ring * 1.7, y: Math.sin(angle) * ring * 1.2 },
				radius: 2.4
			});
		}
	} else if (obs.arrangement === 'scattered') {
		for (let i = 0; i < obs.count; i++) {
			const size = rng.range(obs.minSize, obs.maxSize);
			const margin = Math.max(3, size + 2);
			const limit = rules.worldSize / 2 - margin;
			const center = { x: rng.range(-limit, limit), y: rng.range(-limit, limit) };
			shapes.push(randomShape(rules, rng, center, size));
		}
	} else {
		// random: mix of shapes, count from settings, guaranteed inside the plane
		for (let i = 0; i < obs.count; i++) {
			const size = rng.range(obs.minSize, obs.maxSize);
			const margin = Math.max(3, size + 2);
			const limit = rules.worldSize / 2 - margin;
			const center = { x: rng.range(-limit, limit), y: rng.range(-limit, limit) };
			shapes.push(randomShape(rules, rng, center, size));
		}
	}

	const obstacles: Obstacle[] = [];
	let index = 0;
	const countLimited = obs.arrangement === 'scattered' || obs.arrangement === 'random';
	const limitCount = countLimited ? Math.max(1, obs.count) : Infinity;
	for (const rawShape of shapes) {
		if (obstacles.length >= limitCount) break;
		const shape = clampInWorld(rules, rawShape);
		if (!withinWorld(rules, shape)) continue;
		const obstacle = buildObstacle(`ob${index++}_${seed.slice(0, 4)}`, shape, rules);
		if (obstacle.sections.length === 0) continue;
		obstacles.push(obstacle);
	}
	return obstacles;
}

export interface SectionRef {
	obstacle: Obstacle;
	section: ObstacleSection;
}

export function liveSectionRefs(obstacles: Obstacle[]): SectionRef[] {
	const refs: SectionRef[] = [];
	for (const obstacle of obstacles) {
		for (const section of obstacle.sections) {
			if (!section.destroyed) refs.push({ obstacle, section });
		}
	}
	return refs;
}

/** Simple uniform-grid broadphase over sections. */
export interface SectionIndex {
	cellSize: number;
	cells: Map<string, SectionRef[]>;
}

function key(cx: number, cy: number): string {
	return `${cx},${cy}`;
}

export function buildSectionIndex(obstacles: Obstacle[], cellSize = 2): SectionIndex {
	const cells = new Map<string, SectionRef[]>();
	for (const ref of liveSectionRefs(obstacles)) {
		const b = sectionBounds(ref.section);
		const x0 = Math.floor(b.minX / cellSize);
		const x1 = Math.floor(b.maxX / cellSize);
		const y0 = Math.floor(b.minY / cellSize);
		const y1 = Math.floor(b.maxY / cellSize);
		for (let cx = x0; cx <= x1; cx++) {
			for (let cy = y0; cy <= y1; cy++) {
				const k = key(cx, cy);
				const list = cells.get(k);
				if (list) list.push(ref);
				else cells.set(k, [ref]);
			}
		}
	}
	return { cellSize, cells };
}

/** Sections whose bounding boxes the segment may cross, with entry parameters. */
export function sectionsAlongSegment(
	index: SectionIndex,
	p: Vector2,
	q: Vector2
): { ref: SectionRef; t: number }[] {
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	const length = Math.hypot(dx, dy);
	const steps = Math.max(1, Math.ceil(length / (index.cellSize * 0.5)));
	const seen = new Map<string, SectionRef>();
	const kx0 = Math.floor(Math.min(p.x, q.x) / index.cellSize);
	const kx1 = Math.floor(Math.max(p.x, q.x) / index.cellSize);
	const ky0 = Math.floor(Math.min(p.y, q.y) / index.cellSize);
	const ky1 = Math.floor(Math.max(p.y, q.y) / index.cellSize);
	// Bound the cell walk for long segments.
	if ((kx1 - kx0) * (ky1 - ky0) > 4096) {
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const cx = Math.floor((p.x + dx * t) / index.cellSize);
			const cy = Math.floor((p.y + dy * t) / index.cellSize);
			for (const ref of index.cells.get(key(cx, cy)) ?? []) seen.set(ref.section.id, ref);
		}
	} else {
		for (let cx = kx0; cx <= kx1; cx++) {
			for (let cy = ky0; cy <= ky1; cy++) {
				for (const ref of index.cells.get(key(cx, cy)) ?? []) seen.set(ref.section.id, ref);
			}
		}
	}
	const out: { ref: SectionRef; t: number }[] = [];
	for (const ref of seen.values()) {
		const clipped = clipSegmentToBounds(p, q, sectionBounds(ref.section));
		if (!clipped) continue;
		const bdx = q.x - p.x;
		const bdy = q.y - p.y;
		const lenSq = bdx * bdx + bdy * bdy;
		if (lenSq === 0) continue;
		const t = ((clipped.p.x - p.x) * bdx + (clipped.p.y - p.y) * bdy) / lenSq;
		out.push({ ref, t });
	}
	out.sort((a, b) => a.t - b.t);
	return out;
}

/** Apply damage to one section. Returns true when it just got destroyed. */
export function damageSection(
	section: ObstacleSection,
	amount: number,
	indestructible = false
): boolean {
	if (section.destroyed || !Number.isFinite(amount) || amount <= 0) return false;
	if (indestructible) return false;
	section.durability = Math.max(0, section.durability - amount);
	if (section.durability <= 0) {
		section.destroyed = true;
		return true;
	}
	return false;
}

export function countLiveSections(obstacles: Obstacle[]): number {
	let n = 0;
	for (const o of obstacles) for (const s of o.sections) if (!s.destroyed) n++;
	return n;
}
