<script lang="ts">
	import { get } from 'svelte/store';
	import type { GameRules, MatchConfig } from '$lib/game/types';
	import { cloneRules, DEFAULT_RULES } from '$lib/game/rules';
	import { createSetup } from '$lib/game/defaults';
	import {
		exportConfig,
		importConfig,
		validateMatchConfig,
		validateRules
	} from '$lib/game/configuration';
	import { preferences, updatePreference, type Preferences } from '$lib/ui/preferences';
	import MatchSettings from '$lib/components/lobby/MatchSettings.svelte';

	function initialRules(): GameRules {
		const prefs = get(preferences);
		if (prefs.defaultConfigJson) {
			const parsed = importConfig(prefs.defaultConfigJson);
			if (parsed.ok) return parsed.config.rules;
		}
		return cloneRules(DEFAULT_RULES);
	}

	const prefs = $derived<Preferences>($preferences);

	let rules = $state<GameRules>(initialRules());
	let message = $state('');
	let errors = $state<string[]>([]);
	let fileInput: HTMLInputElement | null = null;

	const rulesValidation = $derived(validateRules(rules));

	function buildConfig(): MatchConfig {
		return {
			rules,
			setup: createSetup(rules, {
				seed: 'settings-default',
				humanCount: 1,
				cpuCount: 1,
				names: [prefs.playerName || 'You', 'CPU 1'],
				cpuDifficulty: 'steady'
			})
		};
	}

	function save(): void {
		if (!rulesValidation.ok) {
			errors = rulesValidation.errors;
			message = '';
			return;
		}
		const config = buildConfig();
		const validated = validateMatchConfig(config);
		if (!validated.ok) {
			errors = validated.errors;
			message = '';
			return;
		}
		updatePreference('defaultConfigJson', exportConfig(validated.config));
		errors = [];
		message = 'Saved as the default rules for new matches and rooms.';
	}

	function reset(): void {
		rules = cloneRules(DEFAULT_RULES);
		updatePreference('defaultConfigJson', null);
		errors = [];
		message = 'Reset to the documented defaults.';
	}

	function download(): void {
		const validated = validateMatchConfig(buildConfig());
		if (!validated.ok) {
			errors = validated.errors;
			return;
		}
		const blob = new Blob([exportConfig(validated.config)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'fkill-default-config.json';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function loadFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const parsed = importConfig(await file.text());
		if (!parsed.ok) {
			errors = parsed.errors;
			message = '';
			input.value = '';
			return;
		}
		rules = parsed.config.rules;
		updatePreference('defaultConfigJson', exportConfig(parsed.config));
		errors = [];
		message = `Imported rules from ${file.name}.`;
		input.value = '';
	}

	function set<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
		updatePreference(key, value);
	}
</script>

<svelte:head>
	<title>Settings — f(kill)</title>
</svelte:head>

<div class="settings">
	<header class="page-head">
		<p class="eyebrow">Configuration</p>
		<h1>Settings</h1>
		<p class="sub">
			Interface preferences live in this browser. Match rules are the same structured configuration the
			engine and relay consume — save them as your default, export them, or import a validated file.
		</p>
	</header>

	<div class="layout">
		<div class="main">
			<section class="panel" aria-labelledby="display-title">
				<header class="panel-head">
					<h2 id="display-title">Interface & accessibility</h2>
					<span>Local only</span>
				</header>

				<div class="field-grid">
					<label class="text-field">
						<span>Display name</span>
						<input
							maxlength="20"
							value={prefs.playerName}
							oninput={(e) => set('playerName', (e.currentTarget as HTMLInputElement).value || 'Player')}
						/>
					</label>

					<label class="toggle">
						<input
							type="checkbox"
							checked={prefs.reduceMotion}
							onchange={(e) => set('reduceMotion', (e.currentTarget as HTMLInputElement).checked)}
						/>
						<span>
							<strong>Reduce motion</strong>
							<em>Disables curve draw-on, hit flashes and non-essential transitions.</em>
						</span>
					</label>

					<label class="toggle">
						<input
							type="checkbox"
							checked={prefs.showHitZones}
							onchange={(e) => set('showHitZones', (e.currentTarget as HTMLInputElement).checked)}
						/>
						<span>
							<strong>Show hit zones</strong>
							<em>Draws each grapher's real target radius. Purely informational.</em>
						</span>
					</label>

					<label class="toggle">
						<input
							type="checkbox"
							checked={prefs.showGrid}
							onchange={(e) => set('showGrid', (e.currentTarget as HTMLInputElement).checked)}
						/>
						<span>
							<strong>Show grid</strong>
							<em>Grid spacing still comes from the match rules; this only hides it.</em>
						</span>
					</label>

					<label class="toggle">
						<input
							type="checkbox"
							checked={prefs.showHistory}
							onchange={(e) => set('showHistory', (e.currentTarget as HTMLInputElement).checked)}
						/>
						<span>
							<strong>Show attack history</strong>
							<em>Keeps recent submitted curves visible on the arena.</em>
						</span>
					</label>

					<label class="text-field">
						<span>History depth ({prefs.historyCount})</span>
						<input
							type="range"
							min="0"
							max="8"
							step="1"
							value={prefs.historyCount}
							oninput={(e) =>
								set('historyCount', Number((e.currentTarget as HTMLInputElement).value))}
						/>
					</label>
				</div>
			</section>

			<section class="rules-panel" aria-labelledby="rules-title">
				<header class="panel-head">
					<h2 id="rules-title">Default match rules</h2>
					<span class:danger={!rulesValidation.ok}>
						{rulesValidation.ok ? 'valid' : `${rulesValidation.errors.length} error(s)`}
					</span>
				</header>
				<p class="panel-note">
					Every value here is read by the validator, collision engine, CPU and authoritative relay.
					Changing Sniper damage or a root budget only requires changing it once.
				</p>
				<MatchSettings bind:rules />
			</section>
		</div>

		<aside class="side">
			<section class="panel">
				<h2>Save & transfer</h2>
				<p class="panel-note">
					The default configuration is used when you open match setup. Imported files are fully
					validated before anything is applied.
				</p>
				<div class="actions">
					<button class="primary" type="button" onclick={save} disabled={!rulesValidation.ok}>
						Save as default
					</button>
					<button type="button" onclick={download}>Export config</button>
					<button type="button" onclick={() => fileInput?.click()}>Import config</button>
					<button type="button" class="danger" onclick={reset}>Reset to defaults</button>
					<input
						bind:this={fileInput}
						type="file"
						accept="application/json,.json"
						class="sr-only"
						onchange={loadFile}
					/>
				</div>
				{#if errors.length > 0}
					<ul class="errors" role="alert">
						{#each errors.slice(0, 8) as error, i (i)}<li>{error}</li>{/each}
					</ul>
				{/if}
				{#if message}<p class="message" role="status">{message}</p>{/if}
			</section>

			<section class="panel reference">
				<h2>Rules reference</h2>
				<dl>
					<dt>Plane</dt>
					<dd>50 × 50 units, centred on (0, 0)</dd>
					<dt>Domain/range span</dt>
					<dd>Total width of the grapher's local window</dd>
					<dt>Root</dt>
					<dd>A distinct real solution of f(x) = 0 inside that window</dd>
					<dt>Score per hit</dt>
					<dd>base + precisionBonus × (1 − d / R), rounded per rules</dd>
					<dt>Victory</dt>
					<dd>Last player with a surviving grapher; ties by health then score</dd>
					<dt>Health</dt>
					<dd>1–20, shared by every grapher in the match</dd>
				</dl>
				<p class="docs-note">
					Full explanations live in <code>docs/GAME_RULES.md</code> and
					<code>docs/ARCHITECTURE.md</code>.
				</p>
			</section>
		</aside>
	</div>
</div>

<style>
	.settings {
		padding: 22px 18px 40px;
		max-width: 1340px;
		margin: 0 auto;
	}

	.page-head {
		margin-bottom: 16px;
		max-width: 78ch;
	}

	h1 {
		font-size: clamp(24px, 3vw, 32px);
		letter-spacing: -0.03em;
		margin: 0 0 5px;
	}

	.sub {
		margin: 0;
		font-size: 12px;
		color: var(--muted);
		line-height: 1.6;
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 340px;
		gap: 12px;
		align-items: start;
	}

	.main {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.panel,
	.rules-panel {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
		padding: 13px;
	}

	.panel-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		margin-bottom: 8px;
	}

	.panel h2,
	.rules-panel h2 {
		margin: 0;
		font-size: 13px;
	}

	.panel-head span {
		font-family: var(--mono);
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--faint);
	}

	.panel-head span.danger {
		color: var(--danger);
	}

	.panel-note {
		margin: 0 0 10px;
		font-size: 10.5px;
		line-height: 1.55;
		color: var(--muted);
	}

	.field-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
		gap: 10px;
	}

	.text-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 10px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
	}

	.text-field input {
		background: var(--bg-soft);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 5px 7px;
		font-size: 12px;
		letter-spacing: 0;
		text-transform: none;
		color: var(--text);
	}

	.toggle {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 11px;
		line-height: 1.45;
		color: var(--text);
	}

	.toggle input {
		margin-top: 3px;
		accent-color: var(--accent);
	}

	.toggle strong {
		display: block;
		font-weight: 600;
		font-size: 11.5px;
	}

	.toggle em {
		display: block;
		font-style: normal;
		font-size: 10px;
		color: var(--muted);
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.actions button {
		background: var(--panel-raised);
		border: 1px solid var(--line-bright);
		color: var(--text);
		border-radius: 5px;
		padding: 6px 10px;
		font-size: 11px;
		text-align: left;
	}

	.actions button:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.actions button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: #041016;
		font-weight: 650;
	}

	.actions button.primary:disabled {
		opacity: 0.5;
	}

	.actions button.danger {
		color: var(--danger);
		border-color: rgba(255, 107, 107, 0.3);
	}

	.errors {
		margin: 10px 0 0;
		padding-left: 16px;
		font-size: 10.5px;
		color: #ffc1c1;
	}

	.message {
		margin: 10px 0 0;
		font-size: 10.5px;
		color: var(--success);
	}

	.reference dl {
		display: grid;
		grid-template-columns: 1fr;
		gap: 7px;
		margin: 0;
	}

	.reference dt {
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--faint);
	}

	.reference dd {
		margin: 1px 0 0;
		font-size: 10.5px;
		line-height: 1.45;
		color: var(--muted);
	}

	.docs-note {
		margin: 11px 0 0;
		border-top: 1px solid var(--line);
		padding-top: 8px;
		font-size: 9.5px;
		color: var(--faint);
		line-height: 1.5;
	}

	@media (max-width: 1000px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
