/**
 * Visual identity.
 *
 * Dark scientific-plotting foundation with deliberate accents. Player identity
 * never relies on hue alone: every player also has a distinct glyph and line
 * pattern, so curves, markers and HUD chips stay distinguishable for
 * colour-blind players and in greyscale.
 */

export interface PlayerVisual {
	/** Primary hue used for markers and attack trails. */
	color: string;
	/** Softer variant for fills and fog. */
	soft: string;
	/** Redundant identity cue drawn inside the marker. */
	glyph: string;
	/** Redundant identity cue for curves in the attack history. */
	lineStyle: 'solid' | 'dashed' | 'dotted' | 'dashdot';
}

export const PLAYER_VISUALS: PlayerVisual[] = [
	{ color: '#46e6ff', soft: 'rgba(70, 230, 255, 0.18)', glyph: '●', lineStyle: 'solid' },
	{ color: '#ffb545', soft: 'rgba(255, 181, 69, 0.16)', glyph: '▲', lineStyle: 'dashed' },
	{ color: '#b98bff', soft: 'rgba(185, 139, 255, 0.16)', glyph: '■', lineStyle: 'dotted' },
	{ color: '#5ef0a8', soft: 'rgba(94, 240, 168, 0.16)', glyph: '◆', lineStyle: 'dashdot' },
	{ color: '#ff7a8a', soft: 'rgba(255, 122, 138, 0.16)', glyph: '✚', lineStyle: 'solid' },
	{ color: '#ff8ae0', soft: 'rgba(255, 138, 224, 0.16)', glyph: '✦', lineStyle: 'dashed' },
	{ color: '#d8ff62', soft: 'rgba(216, 255, 98, 0.16)', glyph: '⬟', lineStyle: 'dotted' },
	{ color: '#8fb3ff', soft: 'rgba(143, 179, 255, 0.16)', glyph: '⬢', lineStyle: 'dashdot' },
	{ color: '#ff9a5c', soft: 'rgba(255, 154, 92, 0.16)', glyph: '◗', lineStyle: 'solid' },
	{ color: '#6fe3d0', soft: 'rgba(111, 227, 208, 0.16)', glyph: '✶', lineStyle: 'dashed' }
];

export function playerVisual(colorIndex: number): PlayerVisual {
	return PLAYER_VISUALS[((colorIndex % PLAYER_VISUALS.length) + PLAYER_VISUALS.length) % PLAYER_VISUALS.length];
}

export const THEME = {
	bg: '#070a10',
	panel: '#0d131d',
	panelRaised: '#121a26',
	line: '#1e2b3d',
	gridMinor: 'rgba(90, 120, 160, 0.10)',
	gridMajor: 'rgba(100, 140, 190, 0.22)',
	axis: 'rgba(190, 214, 240, 0.55)',
	text: '#e8f0fb',
	muted: '#93a4bc',
	accent: '#46e6ff',
	attack: '#ffb545',
	danger: '#ff6b6b',
	success: '#5ef0a8',
	violet: '#b98bff',
	preview: '#e8f0fb'
} as const;

export const GRAPHER_TYPE_ACCENT: Record<string, string> = {
	basic: '#9fb6d4',
	buzzer: '#ffb545',
	sniper: '#46e6ff',
	spray: '#b98bff',
	arc: '#5ef0a8'
};

export const GRAPHER_GLYPH: Record<string, string> = {
	basic: 'f(x)',
	buzzer: '≋',
	sniper: '⌖',
	spray: '⋔',
	arc: '◜'
};

/** CSS custom properties injected once by the layout. */
export const CSS_VARS: Record<string, string> = {
	'--bg': THEME.bg,
	'--panel': THEME.panel,
	'--panel-raised': THEME.panelRaised,
	'--line': THEME.line,
	'--text': THEME.text,
	'--muted': THEME.muted,
	'--accent': THEME.accent,
	'--attack': THEME.attack,
	'--danger': THEME.danger,
	'--success': THEME.success,
	'--violet': THEME.violet
};
