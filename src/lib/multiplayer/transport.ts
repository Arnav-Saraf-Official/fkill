/**
 * Browser transport for online rooms.
 *
 * Speaks the shared protocol over a WebSocket to the authoritative relay in
 * `server/`. On a dropped connection it reconnects with backoff and resumes the
 * same seat with its stored token; the UI is told the connection status so it can
 * show an honest offline state.
 */

import type {
	ClientIntent,
	ClientMessage,
	RoomSnapshot,
	ServerMessage
} from './protocol';	import { PROTOCOL_VERSION, parseServerMessage, sanitiseName } from './protocol';
import {
	MAX_RECONNECT_ATTEMPTS,
	type ConnectionStatus,
	clearSession,
	loadSession,
	reconnectDelay,
	saveSession
} from './reconnect';
import type { MatchConfig } from '../game/types';

export interface RoomClientOptions {
	url: string;
	name: string;
	onSnapshot: (snapshot: RoomSnapshot) => void;
	onStatus: (status: ConnectionStatus, detail?: string) => void;
	onError: (code: string, message: string) => void;
	onWelcome?: (playerId: string, roomCode: string) => void;
}

/**
 * Minimal transport interface so tests can drive the protocol in memory and a
 * future host could provide another realtime transport.
 */
export interface Transport {
	send(message: ClientMessage): void;
	close(): void;
}

const WebSocketOpen = 1;

export class RoomClient implements Transport {
	private options: RoomClientOptions;
	private socket: WebSocket | null = null;
	private status: ConnectionStatus = 'idle';
	private token: string | null = null;
	private playerId: string | null = null;
	private roomCode: string | null = null;
	private pending: ClientMessage | null = null;
	private reconnectAttempt = 0;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingTimer: ReturnType<typeof setInterval> | null = null;
	private deliberatelyClosed = false;
	private seq = 0;
	private lastSnapshotRevision = -1;
	latencyMs = 0;

	constructor(options: RoomClientOptions) {
		this.options = options;
	}

	get currentStatus(): ConnectionStatus {
		return this.status;
	}

	get selfId(): string | null {
		return this.playerId;
	}

	get code(): string | null {
		return this.roomCode;
	}

	createRoom(config?: MatchConfig): void {
		this.roomCode = null;
		this.token = null;
		this.pending = {
			t: 'create',
			name: sanitiseName(this.options.name),
			...(config ? { config } : {})
		};
		this.connect();
	}

	joinRoom(code: string, name?: string): void {
		const normalised = code.trim().toUpperCase();
		this.roomCode = normalised;
		this.pending = {
			t: 'join',
			code: normalised,
			name: sanitiseName(name ?? this.options.name)
		};
		this.connect();
	}

	/** Try to resume a stored session, falling back to joining the room. */
	resume(code: string): boolean {
		const session = loadSession(code);
		if (!session) return false;
		this.token = session.token;
		this.roomCode = session.code;
		this.pending = null;
		this.connect();
		return true;
	}

	private setStatus(status: ConnectionStatus, detail?: string): void {
		this.status = status;
		this.options.onStatus(status, detail);
	}

	private connect(): void {
		if (this.socket && this.socket.readyState === WebSocketOpen) {
			this.flushPending();
			return;
		}
		if (this.socket && this.socket.readyState === 0) return;
		this.deliberatelyClosed = false;
		this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
		let socket: WebSocket;
		try {
			socket = new WebSocket(this.options.url);
		} catch (err) {
			this.setStatus('offline', err instanceof Error ? err.message : 'Could not open socket');
			return;
		}
		this.socket = socket;
		socket.onopen = () => {
			this.reconnectAttempt = 0;
			this.setStatus('connected');
			if (this.token) {
				this.sendRaw({ t: 'resume', token: this.token });
			}
			this.flushPending();
			this.startPing();
		};
		socket.onmessage = (event) => this.handleMessage(event.data);
		socket.onclose = () => this.handleClose();
		socket.onerror = () => {
			// onclose always follows; nothing to do beyond keeping the console clean.
		};
	}

	private flushPending(): void {
		if (this.pending) {
			this.sendRaw(this.pending);
			this.pending = null;
		}
	}

	private handleClose(): void {
		this.stopPing();
		this.socket = null;
		if (this.deliberatelyClosed) {
			this.setStatus('closed');
			return;
		}
		if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
			this.setStatus('offline', 'The relay is unreachable. Solo play still works.');
			return;
		}
		this.setStatus('reconnecting', `Reconnecting (attempt ${this.reconnectAttempt + 1})…`);
		const delay = reconnectDelay(this.reconnectAttempt);
		this.reconnectAttempt++;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = setTimeout(() => {
			if (!this.token && this.roomCode) {
				const session = loadSession(this.roomCode);
				if (session) this.token = session.token;
			}
			this.connect();
		}, delay);
	}

	private startPing(): void {
		this.stopPing();
		this.pingTimer = setInterval(() => {
			if (this.socket && this.socket.readyState === WebSocketOpen) {
				this.sendRaw({ t: 'ping', at: Date.now() });
			}
		}, 20_000);
	}

	private stopPing(): void {
		if (this.pingTimer) clearInterval(this.pingTimer);
		this.pingTimer = null;
	}

	private sendRaw(message: ClientMessage): void {
		if (!this.socket || this.socket.readyState !== WebSocketOpen) {
			if (message.t !== 'resume') this.pending = message;
			return;
		}
		try {
			this.socket.send(JSON.stringify(message));
		} catch {
			if (message.t !== 'resume') this.pending = message;
		}
	}

	send(message: ClientMessage): void {
		this.sendRaw(message);
	}

	sendIntent(intent: ClientIntent): void {
		this.seq++;
		this.sendRaw({ t: 'intent', seq: this.seq, intent });
	}

	private handleMessage(raw: unknown): void {
		if (typeof raw !== 'string') return;
		const message: ServerMessage | null = parseServerMessage(raw);
		if (!message) {
			this.options.onError('protocol', 'Received an unreadable message from the relay.');
			return;
		}
		switch (message.t) {
			case 'welcome': {
				if (message.protocol !== PROTOCOL_VERSION) {
					this.options.onError(
						'protocol',
						`The relay speaks protocol ${message.protocol}; this build speaks ${PROTOCOL_VERSION}.`
					);
					this.close();
					return;
				}
				this.playerId = message.playerId;
				this.token = message.resumeToken;
				this.roomCode = message.roomCode;
				this.lastSnapshotRevision = -1;
				saveSession({
					code: message.roomCode,
					token: message.resumeToken,
					name: this.options.name
				});
				this.options.onWelcome?.(message.playerId, message.roomCode);
				this.deliver(message.snapshot);
				break;
			}
			case 'snapshot':
				this.deliver(message.snapshot);
				break;
			case 'error':
				this.options.onError(message.code, message.message);
				if (message.code === 'no-room' || message.code === 'unknown-token') {
					this.token = null;
					clearSession(this.roomCode ?? '');
				}
				break;
			case 'pong':
				this.latencyMs = Math.max(0, Date.now() - message.at);
				break;
			case 'closed':
				this.deliberatelyClosed = true;
				this.setStatus('closed', message.reason);
				break;
		}
	}

	private deliver(snapshot: RoomSnapshot): void {
		// Snapshots can arrive twice across a reconnect; revision guards avoid
		// needless state churn in the UI.
		if (snapshot.revision < this.lastSnapshotRevision && snapshot.code === this.roomCode) {
			return;
		}
		this.lastSnapshotRevision = snapshot.revision;
		this.options.onSnapshot(snapshot);
	}

	close(): void {
		this.deliberatelyClosed = true;
		this.stopPing();
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		this.socket?.close();
		this.socket = null;
		this.setStatus('closed');
	}

	/** Forget the stored session and leave the room. */
	leave(): void {
		try {
			this.sendIntent({ kind: 'leave' });
		} catch {
			// ignore transport errors on leave
		}
		if (this.roomCode) clearSession(this.roomCode);
		this.token = null;
		setTimeout(() => this.close(), 60);
	}
}

export function defaultRelayUrl(): string {
	const env = (import.meta as { env?: Record<string, string | undefined> }).env;
	return env?.VITE_FKILL_RELAY_URL || 'ws://localhost:8787/ws';
}
