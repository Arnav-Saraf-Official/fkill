/**
 * Reconnection helpers.
 *
 * A dropped socket never invalidates a player's seat: the authority keeps the
 * player and their token for the room lifetime, and a resumed connection is
 * matched back to the same player id. Tokens are namespaced by room code so
 * joining another room never leaks or overwrites a session.
 */

export const MAX_RECONNECT_ATTEMPTS = 8;

/** Exponential backoff with jitter, capped at 10 seconds. */
export function reconnectDelay(attempt: number, random = Math.random): number {
	const base = Math.min(10_000, 500 * Math.pow(1.7, Math.max(0, attempt)));
	return Math.round(base * (0.8 + random() * 0.4));
}

export interface StoredSession {
	code: string;
	token: string;
	name: string;
}

function storageKey(code: string): string {
	return `fkill:session:${code.toUpperCase()}`;
}

function safeStorage(): Storage | null {
	try {
		if (typeof localStorage === 'undefined') return null;
		return localStorage;
	} catch {
		return null;
	}
}

export function saveSession(session: StoredSession): void {
	const storage = safeStorage();
	if (!storage) return;
	try {
		storage.setItem(storageKey(session.code), JSON.stringify(session));
	} catch {
		// Storage can be full or blocked; reconnection then simply relies on the
		// in-memory token for this tab.
	}
}

export function loadSession(code: string): StoredSession | null {
	const storage = safeStorage();
	if (!storage) return null;
	try {
		const raw = storage.getItem(storageKey(code));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<StoredSession>;
		if (typeof parsed.code !== 'string' || typeof parsed.token !== 'string') return null;
		return { code: parsed.code, token: parsed.token, name: parsed.name ?? 'Player' };
	} catch {
		return null;
	}
}

export function clearSession(code: string): void {
	const storage = safeStorage();
	if (!storage) return;
	try {
		storage.removeItem(storageKey(code));
	} catch {
		// ignore
	}
}

/** Find a stored session, used by "resume last match". */
export function mostRecentSession(): StoredSession | null {
	const storage = safeStorage();
	if (!storage) return null;
	try {
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (!key || !key.startsWith('fkill:session:')) continue;
			const raw = storage.getItem(key);
			if (!raw) continue;
			const parsed = JSON.parse(raw) as Partial<StoredSession>;
			if (typeof parsed.code === 'string' && typeof parsed.token === 'string') {
				return { code: parsed.code, token: parsed.token, name: parsed.name ?? 'Player' };
			}
		}
	} catch {
		return null;
	}
	return null;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'closed';
