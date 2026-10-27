import { describe, expect, it } from 'vitest';
import { RoomAuthority, projectStateForViewer } from '$lib/multiplayer/room';
import { createPresetConfig } from './mp-helpers';
import type { MatchConfig } from '$lib/game/types';
import { parseServerMessage, type ClientIntent } from '$lib/multiplayer/protocol';

const T0 = 2_000_000_000_000;

function setupRoom(config?: MatchConfig) {
	const authority = new RoomAuthority();
	const created = authority.createRoom('Host', config ?? null, T0);
	if (!created.ok) throw new Error(created.message);
	const { room, player: host, code } = created;
	return { authority, room, host, code };
}

function join(authority: RoomAuthority, code: string, name: string, now = T0 + 10) {
	const result = authority.join(code, name, now);
	if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
	return result;
}

function intent(authority: RoomAuthority, playerId: string, value: ClientIntent, now: number) {
	return authority.intent(playerId, value, now);
}

describe('room lifecycle', () => {
	it('creates a room with a human-hosted lobby and a room code', () => {
		const { room, code } = setupRoom();
		expect(code).toMatch(/^[A-Z2-9]{5}$/);
		expect(room.phase).toBe('lobby');
		expect(room.snapshot(room.hostId, T0).selfId).toBe(room.hostId);
	});

	it('rejects invalid configuration at creation', () => {
		const authority = new RoomAuthority();
		const bad = createPresetConfig();
		bad.rules.grapherHealth = 500;
		const result = authority.createRoom('Host', bad, T0);
		expect(result.ok).toBe(false);
	});

	it('joins players, enforces the 10-player cap and keeps colours distinct', () => {
		const { authority, code } = setupRoom();
		for (let i = 0; i < 9; i++) join(authority, code, `Player ${i}`);
		const full = authority.join(code, 'Overflow', T0 + 20);
		expect(full.ok).toBe(false);
		if (!full.ok) expect(full.code).toBe('room-full');
		const room = authority.roomByCode(code)!;
		expect(room.players.length).toBe(10);
		const colours = new Set(room.players.map((p) => p.colorIndex));
		expect(colours.size).toBe(10);
	});

	it('refuses to join a running match', () => {
		const { authority, room, host, code } = setupRoom();
		const guest = join(authority, code, 'Guest');
		expect(intent(authority, host.id, { kind: 'ready', ready: true }, T0 + 30).ok).toBe(true);
		expect(intent(authority, guest.player.id, { kind: 'ready', ready: true }, T0 + 31).ok).toBe(true);
		expect(intent(authority, host.id, { kind: 'start' }, T0 + 32).ok).toBe(true);
		expect(room.phase).toBe('running');
		expect(authority.join(code, 'Late', T0 + 33).ok).toBe(false);
	});

	it('requires every human to be ready before starting', () => {
		const { authority, host, code } = setupRoom();
		join(authority, code, 'Guest');
		const result = intent(authority, host.id, { kind: 'start' }, T0 + 30);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('not-ready');
	});

	it('lets only the host start and change settings', () => {
		const { authority, room, host, code } = setupRoom();
		const guest = join(authority, code, 'Guest');
		expect(intent(authority, guest.player.id, { kind: 'start' }, T0 + 30).ok).toBe(false);
		expect(intent(authority, guest.player.id, { kind: 'set-cpu', count: 2, difficulty: 'easy' }, T0 + 30).ok).toBe(false);
		const rules = structuredClone(room.rules);
		rules.grapherHealth = 5;
		expect(intent(authority, host.id, { kind: 'set-rules', rules }, T0 + 30).ok).toBe(true);
		expect(room.rules.grapherHealth).toBe(5);
	});

	it('locks rules once the match starts', () => {
		const { authority, room, host, code } = setupRoom();
		const guest = join(authority, code, 'Guest');
		intent(authority, host.id, { kind: 'ready', ready: true }, T0 + 30);
		intent(authority, guest.player.id, { kind: 'ready', ready: true }, T0 + 31);
		intent(authority, host.id, { kind: 'start' }, T0 + 32);
		const rules = structuredClone(room.rules);
		rules.grapherHealth = 9;
		const result = intent(authority, host.id, { kind: 'set-rules', rules }, T0 + 33);
		expect(result.ok).toBe(false);
		expect(room.rules.grapherHealth).not.toBe(9);
	});

	it('lets a player edit their own lobby loadout and enforces the room cap', () => {
		const { authority, room, host, code } = setupRoom();
		const guest = join(authority, code, 'Guest');
		const changed = intent(
			authority,
			guest.player.id,
			{ kind: 'set-loadout', loadout: ['arc', 'spray', 'sniper'] },
			T0 + 30
		);
		expect(changed.ok, changed.message).toBe(true);
		expect(guest.player.loadout).toEqual(['arc', 'spray', 'sniper']);
		expect(guest.player.ready).toBe(false);

		const tooMany = Array.from(
			{ length: room.rules.maxGraphersPerPlayer + 1 },
			() => 'basic' as const
		);
		const rejected = intent(
			authority,
			guest.player.id,
			{ kind: 'set-loadout', loadout: tooMany },
			T0 + 31
		);
		expect(rejected.ok).toBe(false);
		expect(guest.player.loadout).toEqual(['arc', 'spray', 'sniper']);

		const empty = intent(authority, host.id, { kind: 'set-loadout', loadout: [] }, T0 + 32);
		expect(empty.ok).toBe(false);
	});

	it('adds and removes CPU participants through the host', () => {
		const { authority, room, host } = setupRoom();
		expect(intent(authority, host.id, { kind: 'set-cpu', count: 3, difficulty: 'asian' }, T0 + 30).ok).toBe(true);
		expect(room.players.filter((p) => p.kind === 'cpu').length).toBe(3);
		expect(room.players.filter((p) => p.kind === 'cpu').every((p) => p.cpuDifficulty === 'asian')).toBe(true);
		expect(intent(authority, host.id, { kind: 'set-cpu', count: 1, difficulty: 'easy' }, T0 + 31).ok).toBe(true);
		expect(room.players.filter((p) => p.kind === 'cpu').length).toBe(1);
	});
});

describe('authoritative gameplay', () => {
	function startedRoom() {
		const config = createPresetConfig();
		const { authority, room, host, code } = setupRoom(config);
		const guest = join(authority, code, 'Guest');
		intent(authority, host.id, { kind: 'ready', ready: true }, T0 + 30);
		intent(authority, guest.player.id, { kind: 'ready', ready: true }, T0 + 31);
		const started = intent(authority, host.id, { kind: 'start' }, T0 + 32);
		expect(started.ok).toBe(true);
		return { authority, room, host, guest: guest.player, code };
	}

	it('resolves hits on the authority, not the client', () => {
		const { authority, room, host } = startedRoom();
		const state = room.match!;
		const own = state.graphers.find((g) => g.ownerId === host.id)!;
		const enemy = state.graphers.find((g) => g.ownerId !== host.id)!;
		const expression = `y = ${enemy.position.y}`;
		const result = intent(
			authority,
			host.id,
			{ kind: 'submit-attack', grapherId: own.id, components: [{ kind: 'function', expression }] },
			T0 + 100
		);
		expect(result.ok, result.message).toBe(true);
		const attack = room.match!.attacks.at(-1)!;
		expect(attack.playerId).toBe(host.id);
		expect(attack.targetsHit).toBeGreaterThan(0);
		expect(room.match!.players.find((p) => p.id === host.id)!.score).toBeGreaterThan(0);
	});

	it('rejects attacks from another player\'s grapher', () => {
		const { authority, room, host, guest } = startedRoom();
		const enemy = room.match!.graphers.find((g) => g.ownerId === guest.id)!;
		const result = intent(
			authority,
			host.id,
			{
				kind: 'submit-attack',
				grapherId: enemy.id,
				components: [{ kind: 'function', expression: 'y = 1' }]
			},
			T0 + 100
		);
		expect(result.ok).toBe(false);
		expect(result.code).toBe('unknown-grapher');
	});

	it('ignores forged outcome fields and never lets a client set scores', () => {
		const { authority, room, host } = startedRoom();
		const before = room.match!.players.find((p) => p.id === host.id)!.score;
		const forged = {
			kind: 'submit-attack',
			components: [{ kind: 'function', expression: 'y = 999' }],
			score: 100000,
			damage: 100000,
			targetsHit: 99
		} as unknown as ClientIntent;
		const result = intent(authority, host.id, forged, T0 + 100);
		// Invalid geometry is rejected by the engine; even if it were accepted, the
		// extra fields are not part of the action.
		expect(result.ok).toBe(false);
		expect(room.match!.players.find((p) => p.id === host.id)!.score).toBe(before);
	});

	it('lets both players act concurrently in FFA and keeps a single history', () => {
		const config = createPresetConfig({
			grapherHealth: 20,
			turns: { mode: 'ffa', concurrentPlayers: 1, timePerTurnSeconds: 60 }
		});
		const { authority, room, host, code } = setupRoom(config);
		const guest = join(authority, code, 'Guest');
		intent(authority, host.id, { kind: 'ready', ready: true }, T0 + 30);
		intent(authority, guest.player.id, { kind: 'ready', ready: true }, T0 + 31);
		const started = intent(authority, host.id, { kind: 'start' }, T0 + 32);
		expect(started.ok, started.message).toBe(true);
		const state = room.match!;
		const hostGrapher = state.graphers.find((g) => g.ownerId === host.id)!;
		const guestGrapher = state.graphers.find((g) => g.ownerId === guest.player.id)!;
		const hostTarget = state.graphers.find((g) => g.ownerId === guest.player.id)!;
		const guestTarget = state.graphers.find((g) => g.ownerId === host.id)!;
		const a = intent(
			authority,
			host.id,
			{
				kind: 'submit-attack',
				grapherId: hostGrapher.id,
				components: [{ kind: 'function', expression: `y = ${hostTarget.position.y}` }]
			},
			T0 + 1000
		);
		const b = intent(
			authority,
			guest.player.id,
			{
				kind: 'submit-attack',
				grapherId: guestGrapher.id,
				components: [{ kind: 'function', expression: `y = ${guestTarget.position.y}` }]
			},
			T0 + 1100
		);
		expect(a.ok, a.message).toBe(true);
		expect(b.ok, b.message).toBe(true);
		expect(room.match!.attacks.length).toBe(2);
		expect(room.match!.turn.endsAt).toBeNull();
	});

	it('finishes the match and offers a rematch', () => {
		const { authority, room, host } = startedRoom();
		const state = room.match!;
		const own = state.graphers.find((g) => g.ownerId === host.id)!;
		const enemy = state.graphers.find((g) => g.ownerId !== host.id)!;
		// Destroy the opponent directly through the engine so the terminal state is reached.
		for (const target of state.graphers.filter((g) => g.ownerId !== host.id)) {
			target.health = 1;
		}
		const expression = `y = ${enemy.position.y}`;
		intent(
			authority,
			host.id,
			{ kind: 'submit-attack', grapherId: own.id, components: [{ kind: 'function', expression }] },
			T0 + 100
		);
		let now = T0 + 200;
		for (let i = 0; i < 30 && room.phase !== 'finished'; i++) {
			now += 1000;
			authority.tick(now);
		}
		expect(room.phase).toBe('finished');
		expect(room.match!.winnerIds).toContain(host.id);
		const rematch = intent(authority, host.id, { kind: 'rematch' }, now + 10);
		expect(rematch.ok).toBe(true);
		expect(room.phase).toBe('lobby');
		expect(room.match).toBeUndefined();
	});

	it('drives CPU participants and records their attacks', () => {
		const config = createPresetConfig({
			grapherHealth: 20,
			turns: { mode: 'ffa', concurrentPlayers: 1, timePerTurnSeconds: 60 }
		});
		const { authority, room, host } = setupRoom(config);
		intent(authority, host.id, { kind: 'set-cpu', count: 1, difficulty: 'sharp' }, T0 + 30);
		intent(authority, host.id, { kind: 'ready', ready: true }, T0 + 31);
		expect(intent(authority, host.id, { kind: 'start' }, T0 + 32).ok).toBe(true);
		let now = T0 + 1000;
		for (let i = 0; i < 40 && room.match!.stats.attacks === 0; i++) {
			now += 800;
			authority.tick(now);
		}
		expect(room.match!.stats.attacks).toBeGreaterThan(0);
		const cpu = room.players.find((p) => p.kind === 'cpu')!;
		expect(room.match!.attacks.some((a) => a.playerId === cpu.id)).toBe(true);
	});

	it('handles disconnection and reconnection with the same identity', () => {
		const { authority, room, host, code } = setupRoom();
		const guest = join(authority, code, 'Guest');
		intent(authority, host.id, { kind: 'ready', ready: true }, T0 + 30);
		intent(authority, guest.player.id, { kind: 'ready', ready: true }, T0 + 31);
		intent(authority, host.id, { kind: 'start' }, T0 + 32);
		const guestId = guest.player.id;
		const token = guest.player.token;
		authority.disconnect(guestId, T0 + 100);
		expect(room.players.find((p) => p.id === guestId)!.connected).toBe(false);
		const resumed = authority.resume(token, T0 + 200);
		expect(resumed.ok).toBe(true);
		if (resumed.ok) {
			expect(resumed.player.id).toBe(guestId);
			expect(room.players.find((p) => p.id === guestId)!.connected).toBe(true);
		}
		expect(authority.resume('bogus', T0 + 300).ok).toBe(false);
	});

	it('transfers host and closes the room when the last human leaves', () => {
		const { authority, room, host, code } = setupRoom();
		const guest = join(authority, code, 'Guest');
		expect(intent(authority, host.id, { kind: 'leave' }, T0 + 40).ok).toBe(true);
		expect(room.hostId).toBe(guest.player.id);
		expect(intent(authority, guest.player.id, { kind: 'leave' }, T0 + 41).ok).toBe(true);
		expect(room.phase).toBe('closed');
	});

	it('removes a leaving player from a running match', () => {
		const config = createPresetConfig();
		const { authority, room, host, code } = setupRoom(config);
		const guest = join(authority, code, 'Guest');
		intent(authority, host.id, { kind: 'ready', ready: true }, T0 + 30);
		intent(authority, guest.player.id, { kind: 'ready', ready: true }, T0 + 31);
		intent(authority, host.id, { kind: 'start' }, T0 + 32);
		intent(authority, guest.player.id, { kind: 'leave' }, T0 + 40);
		expect(room.match!.players.find((p) => p.id === guest.player.id)!.alive).toBe(false);
		expect(room.match!.graphers.filter((g) => g.ownerId === guest.player.id).every((g) => !g.alive)).toBe(true);
	});
});

describe('wire protocol', () => {
	it('parses server frames independently from client frames', () => {
		const welcome = parseServerMessage(
			JSON.stringify({
				t: 'welcome',
				protocol: 1,
				playerId: 'u1',
				resumeToken: 'rt1',
				roomCode: 'ABCDE',
				snapshot: { code: 'ABCDE', phase: 'lobby' }
			})
		);
		expect(welcome?.t).toBe('welcome');
		expect(parseServerMessage(JSON.stringify({ t: 'create', name: 'Host' }))).toBeNull();
		expect(parseServerMessage('not json')).toBeNull();
		expect(parseServerMessage(JSON.stringify({ t: 'snapshot', snapshot: { code: 'ABCDE' } }))?.t).toBe(
			'snapshot'
		);
	});
});

describe('information hiding', () => {
	it('projects grid-snapped positions to clients when coordinates are hidden', () => {
		const config = createPresetConfig({
			precision: { denominator: 8, showCoordinates: false },
			coordinates: {
				mode: 'shared',
				allowRotation: false,
				showAxes: true,
				showGrid: true,
				gridSpacing: 4,
				labels: true
			}
		});
		const { authority, room, host, code } = setupRoom(config);
		const guest = join(authority, code, 'Guest');
		intent(authority, host.id, { kind: 'ready', ready: true }, T0 + 30);
		intent(authority, guest.player.id, { kind: 'ready', ready: true }, T0 + 31);
		const started = intent(authority, host.id, { kind: 'start' }, T0 + 32);
		expect(started.ok, started.message).toBe(true);
		const state = room.match!;
		const hostGrapher = state.graphers.find((g) => g.ownerId === host.id)!;
		const enemy = state.graphers.find((g) => g.ownerId === guest.player.id)!;
		const view = projectStateForViewer(state, host.id);
		const viewedEnemy = view.graphers.find((g) => g.id === enemy.id)!;
		expect(Math.abs(viewedEnemy.position.x % 4)).toBeLessThan(1e-9);
		expect(Math.abs(viewedEnemy.position.y % 4)).toBeLessThan(1e-9);
		expect(view.graphers.find((g) => g.id === hostGrapher.id)!.position).toEqual(hostGrapher.position);
		// The authoritative positions are untouched.
		expect(state.graphers.find((g) => g.id === enemy.id)!.position).toEqual(enemy.position);
	});

	it('never sends resume tokens in snapshots', () => {
		const { room } = setupRoom();
		const snapshot = room.snapshot(room.hostId, T0);
		const text = JSON.stringify(snapshot);
		expect(text).not.toContain('"token"');
	});
});
