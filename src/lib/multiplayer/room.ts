/**
 * Authoritative rooms.
 *
 * The room owns the lobby, the rules (locked once the match starts), the
 * authoritative MatchState and the CPU participants. Clients send intents; the
 * room validates them against the same engine used by solo play. Nothing a
 * client sends is trusted as an outcome.
 */

import type {
	AttackComponentInput,
	CpuDifficulty,
	GameRules,
	GrapherType,
	MatchConfig,
	MatchState,
	PlayerConfig
} from '../game/types';
import { validateMatchConfig, validateRules } from '../game/configuration';
import { DEFAULT_RULES, defaultLoadout, GRAPHER_TYPE_ORDER, cloneRules } from '../game/rules';
import {
	alivePlayerIds,
	createMatch,
	passTurn,
	removePlayer,
	setPlayerConnected,
	submitAttack,
	tick
} from '../game/state';
import { cpuThinkTimeMs, planCpuAttack } from '../cpu/planner';
import { randomId, randomRoomCode } from '../game/rng';
import type { ClientIntent, LobbyPlayer, RoomPhase, RoomSnapshot } from './protocol';
import { PROTOCOL_VERSION, sanitiseName } from './protocol';

export interface InternalPlayer {
	id: string;
	name: string;
	kind: 'human' | 'cpu';
	colorIndex: number;
	ready: boolean;
	connected: boolean;
	cpuDifficulty?: CpuDifficulty;
	loadout: GrapherType[];
	token: string;
}

export interface RoomActionResult {
	ok: boolean;
	code?: string;
	message?: string;
	changed: boolean;
}

const DISCONNECT_GRACE_MS = 45_000;

function loadoutFor(rules: GameRules, requested?: GrapherType[]): GrapherType[] {
	const source = requested?.filter((t) => GRAPHER_TYPE_ORDER.includes(t)) ?? defaultLoadout(rules);
	const capped = source.slice(0, rules.maxGraphersPerPlayer);
	if (capped.length > 0) return capped;
	return [GRAPHER_TYPE_ORDER[0]];
}

/** Never leak precise coordinates to a viewer who is not allowed to see them. */
export function projectStateForViewer(state: MatchState, viewerId: string): MatchState {
	const copy = structuredClone(state);
	if (!state.rules.precision.showCoordinates) {
		const spacing = state.rules.coordinates.gridSpacing;
		for (const grapher of copy.graphers) {
			if (grapher.ownerId === viewerId) continue;
			grapher.position = {
				x: Math.round(grapher.position.x / spacing) * spacing,
				y: Math.round(grapher.position.y / spacing) * spacing
			};
		}
	}
	copy.recentSubmits = {};
	return copy;
}

export class Room {
	readonly code: string;
	readonly createdAt: number;
	hostId: string;
	phase: RoomPhase;
	revision = 1;
	players: InternalPlayer[] = [];
	rules: GameRules;
	/** Seed used for the current (or next) match. */
	seed: string;
	match?: MatchState;
	notice?: string;
	lastActivity: number;
	nextCpuActionAt = 0;
	matchNumber = 0;

	constructor(code: string, hostName: string, rules: GameRules, now: number, seed: string) {
		this.code = code;
		this.createdAt = now;
		this.lastActivity = now;
		this.phase = 'lobby';
		this.rules = cloneRules(rules);
		this.seed = seed;
		const host: InternalPlayer = {
			id: `u_${randomId()}`,
			name: sanitiseName(hostName, 'Host'),
			kind: 'human',
			colorIndex: 0,
			ready: false,
			connected: true,
			loadout: loadoutFor(rules),
			token: randomId('rt')
		};
		this.players.push(host);
		this.hostId = host.id;
	}

	private touch(): void {
		this.revision++;
	}

	private humanCount(): number {
		return this.players.filter((p) => p.kind === 'human').length;
	}

	player(playerId: string): InternalPlayer | undefined {
		return this.players.find((p) => p.id === playerId);
	}

	playerByToken(token: string): InternalPlayer | undefined {
		return this.players.find((p) => p.token === token);
	}

	config(): MatchConfig {
		return {
			rules: this.rules,
			setup: {
				seed: this.seed,
				players: this.players.map((p) => this.toPlayerConfig(p))
			}
		};
	}

	private toPlayerConfig(p: InternalPlayer): PlayerConfig {
		return {
			id: p.id,
			name: p.name,
			kind: p.kind,
			colorIndex: p.colorIndex,
			cpuDifficulty: p.cpuDifficulty,
			loadout: p.loadout.slice(0, this.rules.maxGraphersPerPlayer)
		};
	}

	join(
		name: string,
		now: number,
		resumeToken?: string
	): RoomActionResult & { player?: InternalPlayer } {
		if (resumeToken) {
			const existing = this.playerByToken(resumeToken);
			if (existing) {
				existing.connected = true;
				this.lastActivity = now;
				this.touch();
				return { ok: true, changed: true, player: existing };
			}
		}
		if (this.phase !== 'lobby') {
			return {
				ok: false,
				code: 'room-running',
				message: 'This match has already started.',
				changed: false
			};
		}
		if (this.players.length >= this.rules.maxPlayers) {
			return { ok: false, code: 'room-full', message: 'The room is full.', changed: false };
		}
		const used = new Set(this.players.map((p) => p.colorIndex));
		let colorIndex = 0;
		while (used.has(colorIndex) && colorIndex < 9) colorIndex++;
		const player: InternalPlayer = {
			id: `u_${randomId()}`,
			name: sanitiseName(name),
			kind: 'human',
			colorIndex,
			ready: false,
			connected: true,
			loadout: loadoutFor(this.rules),
			token: randomId('rt')
		};
		this.players.push(player);
		this.notice = undefined;
		this.lastActivity = now;
		this.touch();
		return { ok: true, changed: true, player };
	}

	intent(playerId: string, intent: ClientIntent, now: number): RoomActionResult {
		const player = this.player(playerId);
		if (!player) {
			return { ok: false, code: 'unknown-player', message: 'You are not in this room.', changed: false };
		}
		this.lastActivity = now;
		switch (intent.kind) {
			case 'ready': {
				if (this.phase !== 'lobby') {
					return { ok: false, code: 'wrong-phase', message: 'The match has started.', changed: false };
				}
				player.ready = Boolean(intent.ready);
				this.notice = undefined;
				this.touch();
				return { ok: true, changed: true };
			}
			case 'set-loadout': {
				if (this.phase !== 'lobby') {
					return { ok: false, code: 'wrong-phase', message: 'Loadouts are locked once the match starts.', changed: false };
				}
				const requested = Array.isArray(intent.loadout)
					? intent.loadout.filter((t): t is GrapherType => GRAPHER_TYPE_ORDER.includes(t))
					: [];
				if (requested.length === 0) {
					return { ok: false, code: 'invalid-loadout', message: 'Choose at least one grapher.', changed: false };
				}
				if (requested.length > this.rules.maxGraphersPerPlayer) {
					return {
						ok: false,
						code: 'invalid-loadout',
						message: `This room allows at most ${this.rules.maxGraphersPerPlayer} graphers per player.`,
						changed: false
					};
				}
				player.loadout = requested.slice(0, this.rules.maxGraphersPerPlayer);
				player.ready = false;
				this.notice = undefined;
				this.touch();
				return { ok: true, changed: true };
			}
			case 'set-rules': {
				if (player.id !== this.hostId) {
					return { ok: false, code: 'not-host', message: 'Only the host can change match rules.', changed: false };
				}
				if (this.phase !== 'lobby') {
					return { ok: false, code: 'wrong-phase', message: 'Rules are locked once the match starts.', changed: false };
				}
				const validation = validateRules(intent.rules);
				if (!validation.ok) {
					return {
						ok: false,
						code: 'invalid-rules',
						message: validation.errors[0] ?? 'Invalid rules.',
						changed: false
					};
				}
				if (this.players.length > validation.rules.maxPlayers) {
					return {
						ok: false,
						code: 'invalid-rules',
						message: `The room already has ${this.players.length} players; the maximum cannot be lower.`,
						changed: false
					};
				}
				this.rules = validation.rules;
				for (const p of this.players) {
					p.loadout = p.loadout.slice(0, this.rules.maxGraphersPerPlayer);
					if (p.loadout.length === 0) p.loadout = loadoutFor(this.rules);
					p.ready = false;
				}
				this.notice = 'Rules changed by the host; everyone must ready up again.';
				this.touch();
				return { ok: true, changed: true };
			}
			case 'set-cpu': {
				if (player.id !== this.hostId) {
					return { ok: false, code: 'not-host', message: 'Only the host can add CPUs.', changed: false };
				}
				if (this.phase !== 'lobby') {
					return { ok: false, code: 'wrong-phase', message: 'Cannot change players mid-match.', changed: false };
				}
				const difficulty: CpuDifficulty = intent.difficulty ?? 'steady';
				const count = Math.max(0, Math.floor(intent.count));
				const humans = this.humanCount();
				const wanted = Math.min(this.rules.maxPlayers - humans, count);
				const cpus = this.players.filter((p) => p.kind === 'cpu');
				if (cpus.length > wanted) {
					const remove = new Set(cpus.slice(wanted).map((p) => p.id));
					this.players = this.players.filter((p) => !remove.has(p.id));
				} else if (cpus.length < wanted) {
					const used = new Set(this.players.map((p) => p.colorIndex));
					for (let i = cpus.length; i < wanted; i++) {
						let colorIndex = 0;
						while (used.has(colorIndex) && colorIndex < 9) colorIndex++;
						used.add(colorIndex);
						this.players.push({
							id: `c_${randomId()}`,
							name: `CPU ${i + 1}`,
							kind: 'cpu',
							colorIndex,
							ready: true,
							connected: true,
							cpuDifficulty: difficulty,
							loadout: loadoutFor(this.rules),
							token: randomId('ct')
						});
					}
				}
				for (const cpu of this.players.filter((p) => p.kind === 'cpu')) {
					cpu.cpuDifficulty = difficulty;
				}
				this.notice = undefined;
				this.touch();
				return { ok: true, changed: true };
			}
			case 'start': {
				if (player.id !== this.hostId) {
					return { ok: false, code: 'not-host', message: 'Only the host can start.', changed: false };
				}
				return this.start(now);
			}
			case 'submit-attack': {
				if (this.phase !== 'running' || !this.match) {
					return { ok: false, code: 'wrong-phase', message: 'The match is not running.', changed: false };
				}
				if (player.kind !== 'human') {
					return { ok: false, code: 'not-owner', message: 'Bots act through the authority.', changed: false };
				}
				const components = Array.isArray(intent.components) ? intent.components.slice(0, 8) : [];
				const result = submitAttack(
					this.match,
					{
						type: 'submit-attack',
						playerId: player.id,
						grapherId: intent.grapherId,
						components: components as AttackComponentInput[]
					},
					now
				);
				if (!result.ok) {
					return {
						ok: false,
						code: result.error?.code ?? 'invalid-attack',
						message: result.error?.message ?? 'Attack rejected.',
						changed: false
					};
				}
				this.match = result.state;
				this.touch();
				this.syncPhase();
				return { ok: true, changed: true };
			}
			case 'pass': {
				if (this.phase !== 'running' || !this.match) {
					return { ok: false, code: 'wrong-phase', message: 'The match is not running.', changed: false };
				}
				if (player.kind !== 'human') {
					return { ok: false, code: 'not-owner', message: 'Bots act through the authority.', changed: false };
				}
				const result = passTurn(this.match, player.id, now);
				if (!result.ok) {
					return {
						ok: false,
						code: result.error?.code ?? 'bad-action',
						message: result.error?.message ?? 'Cannot pass.',
						changed: false
					};
				}
				this.match = result.state;
				this.touch();
				this.syncPhase();
				return { ok: true, changed: true };
			}
			case 'leave': {
				return this.leave(player.id, now);
			}
			case 'rematch': {
				if (player.id !== this.hostId) {
					return { ok: false, code: 'not-host', message: 'Only the host can start a rematch.', changed: false };
				}
				if (this.phase === 'running') {
					return { ok: false, code: 'wrong-phase', message: 'Finish the match first.', changed: false };
				}
				this.phase = 'lobby';
				this.match = undefined;
				this.matchNumber++;
				this.seed = intent.seed ?? `${this.code}-${this.matchNumber}-${randomId()}`;
				for (const p of this.players) p.ready = p.kind === 'cpu';
				this.notice = 'Rematch ready: review the rules and ready up.';
				this.touch();
				return { ok: true, changed: true };
			}
			default:
				return { ok: false, code: 'bad-intent', message: 'Unsupported action.', changed: false };
		}
	}

	private start(now: number): RoomActionResult {
		if (this.phase !== 'lobby') {
			return { ok: false, code: 'wrong-phase', message: 'The match has already started.', changed: false };
		}
		if (this.players.length < 2) {
			return {
				ok: false,
				code: 'not-enough-players',
				message: 'At least two players (human or CPU) are required.',
				changed: false
			};
		}
		if (this.players.some((p) => p.kind === 'human' && !p.ready)) {
			return { ok: false, code: 'not-ready', message: 'Every human player must ready up.', changed: false };
		}
		this.seed = `${this.code}-${this.matchNumber}-${now.toString(36)}`;
		const config: MatchConfig = {
			rules: this.rules,
			setup: {
				seed: this.seed,
				players: this.players.map((p) => this.toPlayerConfig(p))
			}
		};
		const validated = validateMatchConfig(config);
		if (!validated.ok) {
			return {
				ok: false,
				code: 'invalid-config',
				message: validated.errors[0] ?? 'Invalid configuration.',
				changed: false
			};
		}
		this.match = createMatch(validated.config, now);
		this.phase = 'running';
		this.notice = undefined;
		this.nextCpuActionAt = now + 500;
		this.touch();
		return { ok: true, changed: true };
	}

	private syncPhase(): void {
		if (this.match?.phase === 'finished') this.phase = 'finished';
	}

	leave(playerId: string, now: number): RoomActionResult {
		const player = this.player(playerId);
		if (!player) {
			return { ok: false, code: 'unknown-player', message: 'Not in this room.', changed: false };
		}
		const wasHost = player.id === this.hostId;
		if (this.phase === 'running' && this.match) {
			this.match = removePlayer(this.match, player.id, now);
			this.syncPhase();
		}
		this.players = this.players.filter((p) => p.id !== playerId);
		if (wasHost) {
			const nextHost = this.players.find((p) => p.kind === 'human');
			this.hostId = nextHost?.id ?? '';
		}
		if (this.players.filter((p) => p.kind === 'human').length === 0) {
			this.phase = 'closed';
		}
		this.lastActivity = now;
		this.touch();
		return { ok: true, changed: true };
	}

	disconnect(playerId: string, now: number): boolean {
		const player = this.player(playerId);
		if (!player || !player.connected) return false;
		player.connected = false;
		if (this.match) this.match = setPlayerConnected(this.match, playerId, false);
		this.lastActivity = now;
		this.touch();
		return true;
	}

	reconnect(token: string, now: number): RoomActionResult & { player?: InternalPlayer } {
		const player = this.playerByToken(token);
		if (!player) {
			return { ok: false, code: 'unknown-token', message: 'Session expired.', changed: false };
		}
		if (!player.connected) {
			player.connected = true;
			if (this.match) this.match = setPlayerConnected(this.match, player.id, true);
			this.touch();
		}
		this.lastActivity = now;
		return { ok: true, changed: true, player };
	}

	/** Advance timers, drive CPUs and expire disconnected lobby players. */
	tick(now: number): boolean {
		let changed = false;
		if (this.phase === 'lobby') {
			const stale = this.players.filter(
				(p) => p.kind === 'human' && !p.connected && now - this.lastActivity > DISCONNECT_GRACE_MS
			);
			for (const p of stale) {
				const result = this.leave(p.id, now);
				changed = changed || result.changed;
			}
			return changed;
		}
		if (this.phase !== 'running' || !this.match) return false;

		const before = this.match;
		const advanced = tick(this.match, now);
		if (advanced !== before) {
			this.match = advanced;
			changed = true;
		}

		// Drive CPU participants through the same action interface as humans.
		if (this.match.phase === 'running' && now >= this.nextCpuActionAt) {
			const active = alivePlayerIds(this.match).filter((id) => {
				const p = this.player(id);
				return p?.kind === 'cpu' && this.match?.turn.activePlayerIds.includes(id);
			});
			const cpuId = active[0];
			if (cpuId) {
				const plan = planCpuAttack(this.match, cpuId, now);
				if (plan) {
					const result = submitAttack(this.match, plan.action, now);
					if (result.ok) {
						this.match = result.state;
						changed = true;
					}
				} else if (this.match.turn.mode !== 'ffa') {
					const result = passTurn(this.match, cpuId, now);
					if (result.ok) {
						this.match = result.state;
						changed = true;
					}
				}
				this.nextCpuActionAt = now + Math.max(250, cpuThinkTimeMs(this.match, cpuId));
			}
		}

		this.syncPhase();
		if (changed) this.revision++;
		return changed;
	}

	snapshot(viewerId: string, now: number): RoomSnapshot {
		const self = this.player(viewerId);
		const players: LobbyPlayer[] = this.players.map((p) => ({
			id: p.id,
			name: p.name,
			kind: p.kind,
			colorIndex: p.colorIndex,
			ready: p.kind === 'cpu' ? true : p.ready,
			connected: p.connected,
			cpuDifficulty: p.cpuDifficulty,
			loadout: p.loadout
		}));
		const snapshot: RoomSnapshot = {
			code: this.code,
			protocol: PROTOCOL_VERSION,
			revision: this.revision,
			phase: this.phase,
			hostId: this.hostId,
			selfId: self?.id ?? viewerId,
			players,
			config: this.config(),
			serverTime: now
		};
		if (this.match) snapshot.state = projectStateForViewer(this.match, viewerId);
		if (this.notice) snapshot.notice = this.notice;
		return snapshot;
	}
}

/** Room container with codes, membership and lifecycle cleanup. */
export class RoomAuthority {
	readonly rooms = new Map<string, Room>();
	private playerRooms = new Map<string, string>();
	private tickHandle: ReturnType<typeof setInterval> | null = null;

	createRoom(
		hostName: string,
		config: MatchConfig | null,
		now: number
	):
		| { ok: true; code: string; player: InternalPlayer; room: Room }
		| { ok: false; code: string; message: string } {
		let rules = cloneRules(DEFAULT_RULES);
		if (config) {
			const validated = validateMatchConfig(config);
			if (!validated.ok) {
				return {
					ok: false,
					code: 'invalid-config',
					message: validated.errors[0] ?? 'Invalid room configuration.'
				};
			}
			rules = validated.config.rules;
		}
		let code = randomRoomCode();
		let attempts = 0;
		while (this.rooms.has(code) && attempts < 50) {
			code = randomRoomCode();
			attempts++;
		}
		const room = new Room(code, hostName, rules, now, randomId('seed'));
		this.rooms.set(code, room);
		const host = room.players[0];
		this.playerRooms.set(host.id, code);
		return { ok: true, code, player: host, room };
	}

	join(
		code: string,
		name: string,
		now: number,
		resumeToken?: string
	): { ok: true; room: Room; player: InternalPlayer } | { ok: false; code: string; message: string } {
		const room = this.rooms.get(code.toUpperCase());
		if (!room) return { ok: false, code: 'no-room', message: 'No room with that code.' };
		const result = room.join(name, now, resumeToken);
		if (!result.ok || !result.player) {
			return { ok: false, code: result.code ?? 'join-failed', message: result.message ?? 'Could not join.' };
		}
		this.playerRooms.set(result.player.id, room.code);
		return { ok: true, room, player: result.player };
	}

	resume(
		token: string,
		now: number
	): { ok: true; room: Room; player: InternalPlayer } | { ok: false; code: string; message: string } {
		for (const room of this.rooms.values()) {
			const result = room.reconnect(token, now);
			if (result.ok && result.player) {
				this.playerRooms.set(result.player.id, room.code);
				return { ok: true, room, player: result.player };
			}
		}
		return { ok: false, code: 'unknown-token', message: 'That session has expired.' };
	}

	roomForPlayer(playerId: string): Room | undefined {
		const code = this.playerRooms.get(playerId);
		return code ? this.rooms.get(code) : undefined;
	}

	intent(playerId: string, intent: ClientIntent, now: number): RoomActionResult {
		const room = this.roomForPlayer(playerId);
		if (!room) return { ok: false, code: 'no-room', message: 'You are not in a room.', changed: false };
		const result = room.intent(playerId, intent, now);
		if (result.ok && intent.kind === 'leave') this.playerRooms.delete(playerId);
		if (room.phase === 'closed') {
			for (const p of room.players) this.playerRooms.delete(p.id);
			this.rooms.delete(room.code);
		}
		return result;
	}

	disconnect(playerId: string, now: number): void {
		const room = this.roomForPlayer(playerId);
		if (!room) return;
		room.disconnect(playerId, now);
	}

	tick(now: number): void {
		for (const [code, room] of this.rooms) {
			room.tick(now);
			if (room.phase === 'closed' || now - room.lastActivity > 3 * 60 * 60 * 1000) {
				for (const p of room.players) this.playerRooms.delete(p.id);
				this.rooms.delete(code);
			}
		}
	}

	startTicking(intervalMs = 250): void {
		if (this.tickHandle) return;
		this.tickHandle = setInterval(() => this.tick(Date.now()), intervalMs);
		const handle = this.tickHandle as unknown as { unref?: () => void };
		handle.unref?.();
	}

	stopTicking(): void {
		if (this.tickHandle) clearInterval(this.tickHandle);
		this.tickHandle = null;
	}

	roomCodes(): string[] {
		return [...this.rooms.keys()];
	}

	roomByCode(code: string): Room | undefined {
		return this.rooms.get(code.toUpperCase());
	}
}
