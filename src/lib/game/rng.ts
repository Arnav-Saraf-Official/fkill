/**
 * Deterministic seeded randomness.
 *
 * Every random decision that can affect a match (obstacle layout, placement,
 * scheduling order, CPU choices) is driven by a seed so a match can be
 * reproduced from `(config, seed)` — essential for debugging, replay and for
 * proving the CPU does not cheat.
 */

export interface Rng {
	/** Uniform float in [0, 1). */
	next(): number;
	int(maxExclusive: number): number;
	range(min: number, max: number): number;
	pick<T>(items: readonly T[]): T | undefined;
	shuffle<T>(items: readonly T[]): T[];
	fork(label: string): Rng;
	/** Opaque state for serialising a deterministic stream. */
	state(): number;
}

/** FNV-1a 32-bit hash. */
export function hashString(input: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

/** Mulberry32 — small, fast, well-distributed, deterministic. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function createRng(seed: string | number): Rng {
	const numeric = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
	const stream = mulberry32(numeric);
	let counter = 0;
	const rng: Rng = {
		next: () => stream(),
		int(maxExclusive: number): number {
			if (maxExclusive <= 0) return 0;
			return Math.floor(stream() * maxExclusive);
		},
		range(min: number, max: number): number {
			return min + stream() * (max - min);
		},
		pick<T>(items: readonly T[]): T | undefined {
			if (items.length === 0) return undefined;
			return items[Math.floor(stream() * items.length)];
		},
		shuffle<T>(items: readonly T[]): T[] {
			const arr = items.slice();
			for (let i = arr.length - 1; i > 0; i--) {
				const j = Math.floor(stream() * (i + 1));
				[arr[i], arr[j]] = [arr[j], arr[i]];
			}
			return arr;
		},
		fork(label: string): Rng {
			counter++;
			return createRng((numeric ^ hashString(label)) + counter * 2654435761);
		},
		state: () => numeric + counter
	};
	return rng;
}

/** Random id for rooms, players and graphers (crypto-backed when available). */
export function randomId(prefix = ''): string {
	const globalCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
	let raw: string;
	if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
		raw = globalCrypto.randomUUID().replace(/-/g, '').slice(0, 12);
	} else {
		raw = Math.random().toString(36).slice(2, 14);
	}
	return prefix ? `${prefix}_${raw}` : raw;
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Human-friendly room code, unambiguous characters only. */
export function randomRoomCode(length = 5): string {
	const globalCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
	let out = '';
	if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
		const buf = new Uint32Array(length);
		globalCrypto.getRandomValues(buf);
		for (let i = 0; i < length; i++) out += ROOM_ALPHABET[buf[i] % ROOM_ALPHABET.length];
		return out;
	}
	for (let i = 0; i < length; i++) {
		out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
	}
	return out;
}
