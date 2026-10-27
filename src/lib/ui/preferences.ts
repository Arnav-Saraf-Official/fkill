/**
 * Local preferences.
 *
 * These are convenience settings, not match rules: changing them never changes
 * legality, hit detection or scoring. Match rules are stored separately and are
 * always validated before use.
 */

import { writable, get } from 'svelte/store';

export interface Preferences {
	reduceMotion: boolean;
	showHitZones: boolean;
	showHistory: boolean;
	historyCount: number;
	showGrid: boolean;
	playerName: string;
	/** Last configuration the user reviewed; validated on load. */
	defaultConfigJson: string | null;
}

const KEY = 'fkill:preferences';

const DEFAULTS: Preferences = {
	reduceMotion: false,
	showHitZones: true,
	showHistory: true,
	historyCount: 3,
	showGrid: true,
	playerName: 'You',
	defaultConfigJson: null
};

function load(): Preferences {
	try {
		if (typeof localStorage === 'undefined') return { ...DEFAULTS };
		const raw = localStorage.getItem(KEY);
		if (!raw) return { ...DEFAULTS };
		const parsed = JSON.parse(raw) as Partial<Preferences>;
		return {
			reduceMotion: Boolean(parsed.reduceMotion ?? DEFAULTS.reduceMotion),
			showHitZones: Boolean(parsed.showHitZones ?? DEFAULTS.showHitZones),
			showHistory: Boolean(parsed.showHistory ?? DEFAULTS.showHistory),
			historyCount: Math.max(0, Math.min(8, Number(parsed.historyCount ?? DEFAULTS.historyCount))),
			showGrid: Boolean(parsed.showGrid ?? DEFAULTS.showGrid),
			playerName:
				typeof parsed.playerName === 'string' && parsed.playerName.trim()
					? parsed.playerName.slice(0, 20)
					: DEFAULTS.playerName,
			defaultConfigJson:
				typeof parsed.defaultConfigJson === 'string' ? parsed.defaultConfigJson : null
		};
	} catch {
		return { ...DEFAULTS };
	}
}

export const preferences = writable<Preferences>(load());

preferences.subscribe((value) => {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(KEY, JSON.stringify(value));
	} catch {
		// Preferences are best-effort; the game runs without storage.
	}
});

export function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
	preferences.update((p) => ({ ...p, [key]: value }));
}

export function currentPreferences(): Preferences {
	return get(preferences);
}

export function prefersReducedMotion(): boolean {
	const prefs = get(preferences);
	if (prefs.reduceMotion) return true;
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
