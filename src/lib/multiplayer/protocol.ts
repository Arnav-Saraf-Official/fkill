/**
 * Wire protocol for online rooms.
 *
 * Clients send intents; the authority validates them and replies with
 * snapshots. Clients never report damage, hits, scores, cooldowns or turn
 * ownership, and never send authoritative timestamps.
 *
 * This module is shared by the browser client and the Node relay so both sides
 * cannot drift apart.
 */

import type {
	AttackComponentInput,
	GameRules,
	GrapherType,
	MatchConfig,
	MatchState,
	PlayerKind,
	CpuDifficulty
} from '../game/types';

export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 96 * 1024;

export type RoomPhase = 'lobby' | 'starting' | 'running' | 'finished' | 'closed';

export interface LobbyPlayer {
	id: string;
	name: string;
	kind: PlayerKind;
	colorIndex: number;
	ready: boolean;
	connected: boolean;
	cpuDifficulty?: CpuDifficulty;
	loadout: GrapherType[];
}

/** Public state of a room, tailored to one viewer. */
export interface RoomSnapshot {
	code: string;
	protocol: number;
	revision: number;
	phase: RoomPhase;
	hostId: string;
	selfId: string;
	players: LobbyPlayer[];
	config: MatchConfig;
	/** Present once the match starts. Positions of other graphers are projected. */
	state?: MatchState;
	/** Server wall-clock time; the only trusted clock. */
	serverTime: number;
	/** Set when the host changed something that invalidated readiness. */
	notice?: string;
}

export type ClientIntent =
	| { kind: 'ready'; ready: boolean }
	| { kind: 'set-loadout'; loadout: GrapherType[] }
	| { kind: 'set-rules'; rules: GameRules }
	| { kind: 'set-cpu'; count: number; difficulty: CpuDifficulty }
	| { kind: 'start' }
	| { kind: 'submit-attack'; grapherId?: string; components: AttackComponentInput[] }
	| { kind: 'pass' }
	| { kind: 'leave' }
	| { kind: 'rematch'; seed?: string };

export type ClientMessage =
	| { t: 'create'; name: string; config?: MatchConfig }
	| {
			t: 'join';
			code: string;
			name: string;
			resumeToken?: string;
	  }
	| { t: 'intent'; seq: number; intent: ClientIntent }
	| { t: 'ping'; at: number }
	| { t: 'resume'; token: string };

export type ServerMessage =
	| {
			t: 'welcome';
			protocol: number;
			playerId: string;
			resumeToken: string;
			roomCode: string;
			snapshot: RoomSnapshot;
	  }
	| { t: 'snapshot'; snapshot: RoomSnapshot }
	| { t: 'error'; code: string; message: string }
	| { t: 'pong'; at: number; serverTime: number }
	| { t: 'closed'; reason: string };

export interface ErrorMessage {
	code: string;
	message: string;
}

export function isClientMessage(value: unknown): value is ClientMessage {
	if (typeof value !== 'object' || value === null) return false;
	const t = (value as { t?: unknown }).t;
	return (
		t === 'create' ||
		t === 'join' ||
		t === 'intent' ||
		t === 'ping' ||
		t === 'resume'
	);
}

/** Server messages are validated separately from client messages. */
export function isServerMessage(value: unknown): value is ServerMessage {
	if (typeof value !== 'object' || value === null) return false;
	const frame = value as Record<string, unknown>;
	switch (frame.t) {
		case 'welcome':
			return (
				typeof frame.protocol === 'number' &&
				typeof frame.playerId === 'string' &&
				typeof frame.resumeToken === 'string' &&
				typeof frame.roomCode === 'string' &&
				typeof frame.snapshot === 'object' &&
				frame.snapshot !== null
			);
		case 'snapshot':
			return typeof frame.snapshot === 'object' && frame.snapshot !== null;
		case 'error':
			return typeof frame.code === 'string' && typeof frame.message === 'string';
		case 'pong':
			return typeof frame.at === 'number' && typeof frame.serverTime === 'number';
		case 'closed':
			return typeof frame.reason === 'string';
		default:
			return false;
	}
}

/** Names are display-only and are sanitised before they reach a room. */
export function sanitiseName(raw: unknown, fallback = 'Player'): string {
	if (typeof raw !== 'string') return fallback;
	// Control characters are stripped from display names by design.
	// eslint-disable-next-line no-control-regex
	const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
	return cleaned.length > 0 ? cleaned : fallback;
}

/** JSON-safe parsing with a hard byte budget. */
export function parseServerMessage(raw: string): ServerMessage | null {
	if (raw.length > MAX_MESSAGE_BYTES) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return isServerMessage(parsed) ? parsed : null;
}

/** JSON-safe parsing with a hard byte budget (client -> relay). */
export function parseMessage(raw: string): ClientMessage | null {
	if (raw.length > MAX_MESSAGE_BYTES) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	return isClientMessage(parsed) ? parsed : null;
}
