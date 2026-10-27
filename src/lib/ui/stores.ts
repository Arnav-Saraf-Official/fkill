/**
 * UI-facing controllers. The engine stays framework-independent; these classes
 * only adapt it to Svelte stores, timers and the screen.
 */

import { writable, get } from 'svelte/store';
import type {
	AttackComponentInput,
	AttackRecord,
	MatchConfig,
	MatchState
} from '../game/types';
import { createMatch, passTurn, submitAttack, tick } from '../game/state';
import { planCpuAttack, cpuThinkTimeMs } from '../cpu/planner';
import type { ActionError } from '../game/types';
import { RoomClient, defaultRelayUrl } from '../multiplayer/transport';
import type { ClientIntent, RoomSnapshot } from '../multiplayer/protocol';
import type { ConnectionStatus } from '../multiplayer/reconnect';

export interface AttackFeedback {
	id: number;
	ok: boolean;
	message: string;
	attack?: AttackRecord;
	error?: ActionError;
	at: number;
}

let feedbackId = 0;

/** Solo / local match with CPU opponents driven through the real engine. */
class SoloGame {
	readonly state = writable<MatchState | null>(null);
	readonly config = writable<MatchConfig | null>(null);
	readonly feedback = writable<AttackFeedback | null>(null);
	readonly clock = writable<number>(Date.now());
	readonly warnings = writable<string[]>([]);

	private timer: ReturnType<typeof setInterval> | null = null;
	private cpuNextAt = new Map<string, number>();
	private lastNow = Date.now();

	start(config: MatchConfig): void {
		this.stop();
		const now = Date.now();
		const state = createMatch(config, now);
		this.config.set(config);
		this.state.set(state);
		this.feedback.set(null);
		this.clock.set(now);
		this.lastNow = now;
		this.cpuNextAt.clear();
		this.timer = setInterval(() => this.loop(), 200);
		this.loop();
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
	}

	clear(): void {
		this.stop();
		this.state.set(null);
		this.config.set(null);
		this.feedback.set(null);
	}

	get selfId(): string | null {
		const state = get(this.state);
		if (!state) return null;
		return this.actingHumanId(state);
	}

	/**
	 * With several humans sharing one screen, the acting player is the human in
	 * the current batch. In FFA the first surviving human owns the console.
	 */
	private actingHumanId(state: MatchState): string | null {
		const humans = state.players.filter((p) => p.kind === 'human' && p.alive);
		if (state.turn.mode !== 'ffa') {
			const active = state.turn.activePlayerIds.find((id) => humans.some((h) => h.id === id));
			if (active) return active;
		}
		return humans[0]?.id ?? state.players[0]?.id ?? null;
	}

	private loop(): void {
		const state = get(this.state);
		if (!state) return;
		const now = Date.now();
		this.lastNow = now;
		this.clock.set(now);
		try {
			const next = tick(state, now);
			if (next !== state) this.state.set(next);
			this.driveCpus(next, now);
			if (next.phase === 'finished') this.stop();
		} catch (err) {
			console.error('game loop error', err);
		}
	}

	/** One CPU action per tick keeps the interface responsive. */
	private driveCpus(state: MatchState, now: number): void {
		if (state.phase !== 'running') return;
		const active = state.turn.activePlayerIds
			.map((id) => state.players.find((p) => p.id === id))
			.filter((p): p is NonNullable<typeof p> => Boolean(p) && p!.kind === 'cpu');
		for (const cpu of active) {
			const readyAt = this.cpuNextAt.get(cpu.id) ?? 0;
			if (now < readyAt) continue;
			const plan = planCpuAttack(state, cpu.id, now);
			if (plan) {
				const result = submitAttack(state, plan.action, now);
				if (result.ok) {
					this.state.set(result.state);
					this.feedback.set({
						id: ++feedbackId,
						ok: true,
						message: `${cpu.name} fired: ${result.attack?.targetsHit ?? 0} hit(s), ${result.attack?.totalDamage ?? 0} damage.`,
						attack: result.attack,
						at: now
					});
				}
			} else if (state.turn.mode !== 'ffa') {
				const passed = passTurn(state, cpu.id, now);
				if (passed.ok) this.state.set(passed.state);
			}
			this.cpuNextAt.set(cpu.id, now + Math.max(350, cpuThinkTimeMs(state, cpu.id)));
			// Only one CPU acts per tick.
			break;
		}
	}

	submit(
		components: AttackComponentInput[],
		grapherId?: string
	): AttackFeedback {
		const state = get(this.state);
		const playerId = this.selfId;
		if (!state || !playerId) {
			const failure: AttackFeedback = {
				id: ++feedbackId,
				ok: false,
				message: 'No match is running.',
				at: Date.now()
			};
			this.feedback.set(failure);
			return failure;
		}
		const now = Date.now();
		const result = submitAttack(
			state,
			{ type: 'submit-attack', playerId, grapherId, components },
			now
		);
		const feedback: AttackFeedback = result.ok
			? {
					id: ++feedbackId,
					ok: true,
					message: describeAttack(result.attack),
					attack: result.attack,
					at: now
				}
			: {
					id: ++feedbackId,
					ok: false,
					message: result.error?.message ?? 'Attack rejected.',
					error: result.error,
					at: now
				};
		this.state.set(result.state);
		this.feedback.set(feedback);
		this.clock.set(now);
		if (result.state.phase === 'finished') this.stop();
		return feedback;
	}

	pass(): void {
		const state = get(this.state);
		const playerId = this.selfId;
		if (!state || !playerId) return;
		const result = passTurn(state, playerId, Date.now());
		if (result.ok) this.state.set(result.state);
	}

	rematch(): void {
		const config = get(this.config);
		if (config) this.start(config);
	}

	now(): number {
		return this.lastNow;
	}
}

export function describeAttack(attack: AttackRecord | undefined): string {
	if (!attack) return 'Attack accepted.';
	const parts: string[] = [];
	parts.push(
		attack.targetsHit > 0
			? `${attack.targetsHit} hit${attack.targetsHit === 1 ? '' : 's'}`
			: 'no hits'
	);
	if (attack.totalDamage > 0) parts.push(`${attack.totalDamage} damage`);
	if (attack.totalScore > 0) parts.push(`+${attack.totalScore} pts`);
	if (attack.destroyedTargetIds.length > 0) parts.push(`${attack.destroyedTargetIds.length} destroyed`);
	const blocked = attack.components.every((c) => c.outcome === 'blocked');
	if (blocked) parts.push('blocked by cover');
	return parts.join(' · ');
}

export const soloGame = new SoloGame();

/* ------------------------------------------------------------------ online */

export interface OnlineState {
	status: ConnectionStatus;
	detail?: string;
	snapshot: RoomSnapshot | null;
	error: { code: string; message: string } | null;
	latencyMs: number;
	/** Local wall-clock time when the last snapshot arrived, for clock offset. */
	receivedAt: number;
}

class OnlineSession {
	readonly store = writable<OnlineState>({
		status: 'idle',
		snapshot: null,
		error: null,
		latencyMs: 0,
		receivedAt: 0
	});
	readonly clock = writable<number>(Date.now());
	private client: RoomClient | null = null;
	private name = 'Player';
	private ticker: ReturnType<typeof setInterval> | null = null;

	private ensureClient(): RoomClient {
		if (this.client) return this.client;
		const client = new RoomClient({
			url: defaultRelayUrl(),
			name: this.name,
			onSnapshot: (snapshot) => {
				this.store.update((s) => ({
					...s,
					snapshot,
					receivedAt: Date.now(),
					status: 'connected',
					detail: undefined
				}));
			},
			onStatus: (status, detail) => {
				this.store.update((s) => ({ ...s, status, detail }));
			},
			onError: (code, message) => {
				this.store.update((s) => ({ ...s, error: { code, message } }));
			}
		});
		this.client = client;
		if (!this.ticker) {
			this.ticker = setInterval(() => {
				this.clock.set(this.now());
				const latency = client.latencyMs;
				this.store.update((s) => (s.latencyMs === latency ? s : { ...s, latencyMs: latency }));
			}, 200);
		}
		return client;
	}

	create(config: MatchConfig | null, name: string): void {
		this.name = name;
		const client = this.ensureClient();
		this.store.update((s) => ({ ...s, status: 'connecting', error: null, snapshot: null }));
		client.createRoom(config ?? undefined);
	}

	join(code: string, name: string): void {
		this.name = name;
		const client = this.ensureClient();
		this.store.update((s) => ({ ...s, status: 'connecting', error: null, snapshot: null }));
		client.joinRoom(code, name);
	}

	resume(code: string, name: string): boolean {
		this.name = name;
		const client = this.ensureClient();
		return client.resume(code);
	}

	send(intent: ClientIntent): void {
		this.client?.sendIntent(intent);
	}

	clearError(): void {
		this.store.update((s) => ({ ...s, error: null }));
	}

	/** Server-aligned clock: never trust the local clock alone. */
	now(): number {
		const state = get(this.store);
		if (!state.snapshot) return Date.now();
		const drift = Date.now() - state.receivedAt;
		return state.snapshot.serverTime + drift;
	}

	leave(): void {
		this.client?.leave();
		this.client = null;
		if (this.ticker) clearInterval(this.ticker);
		this.ticker = null;
		this.store.set({ status: 'idle', snapshot: null, error: null, latencyMs: 0, receivedAt: 0 });
	}

	close(): void {
		this.client?.close();
		this.client = null;
		if (this.ticker) clearInterval(this.ticker);
		this.ticker = null;
		this.store.set({ status: 'idle', snapshot: null, error: null, latencyMs: 0, receivedAt: 0 });
	}
}

export const onlineSession = new OnlineSession();
