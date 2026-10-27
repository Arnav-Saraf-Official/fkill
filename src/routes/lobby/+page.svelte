<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import type {
		CpuDifficulty,
		GameRules,
		GrapherType,
		MatchConfig,
		PlayerConfig,
		PlayerKind,
		Vector2
	} from '$lib/game/types';
	import { randomId } from '$lib/game/rng';
	import { defaultLoadout } from '$lib/game/rules';
	import { PRESETS, buildPreset } from '$lib/game/defaults';
	import { exportConfig, importConfig, validateMatchConfig } from '$lib/game/configuration';
	import { soloGame, onlineSession, type OnlineState } from '$lib/ui/stores';
	import { preferences, updatePreference } from '$lib/ui/preferences';
	import { playerVisual } from '$lib/ui/theme';
	import { DIFFICULTY_LABELS, DIFFICULTY_ORDER } from '$lib/cpu/difficulty';
	import MatchSettings from '$lib/components/lobby/MatchSettings.svelte';
	import LoadoutEditor from '$lib/components/lobby/LoadoutEditor.svelte';
	import PlacementBoard from '$lib/components/lobby/PlacementBoard.svelte';
	import PlaneRotation from '$lib/components/lobby/PlaneRotation.svelte';
	import OnlineLobby from '$lib/components/lobby/OnlineLobby.svelte';

	const CPU_NAMES = ['Vector', 'Tangent', 'Asymptote', 'Sigma', 'Lemma', 'Parabola', 'Radix', 'Orbit', 'Cusp', 'Nadir'];

	function savedConfig(): MatchConfig {
		const prefs = get(preferences);
		if (prefs.defaultConfigJson) {
			const parsed = importConfig(prefs.defaultConfigJson);
			if (parsed.ok) return parsed.config;
		}
		const preset = buildPreset('quick');
		preset.setup.seed = `fkill-${randomId()}`;
		return preset;
	}

	const initial = savedConfig();

	let rules = $state<GameRules>(initial.rules);
	let players = $state<PlayerConfig[]>(initial.setup.players);
	let seed = $state(initial.setup.seed);
	let manualPlacements = $state<Record<string, Vector2[]>>(initial.setup.manualPlacements ?? {});
	let rotations = $state<Record<string, number[]>>(initial.setup.rotations ?? {});
	let presetId = $state('custom');
	let notice = $state('');
	let importErrors = $state<string[]>([]);
	let fileInput = $state<HTMLInputElement | null>(null);

	const onlineStore = onlineSession.store;
	const online = $derived<OnlineState>($onlineStore);

	const query = $derived(page.url.searchParams);
	const mode = $derived(query.get('room') || query.get('mode') === 'online' ? 'online' : 'solo');
	const initialCode = $derived(query.get('room') ?? '');

	const soloConfig = $derived<MatchConfig>({
		rules,
		setup: {
			seed,
			players,
			...(Object.keys(manualPlacements).length > 0 ? { manualPlacements } : {}),
			...(Object.keys(rotations).length > 0 ? { rotations } : {})
		}
	});

	const validation = $derived(validateMatchConfig(soloConfig));
	const grapherTotal = $derived(players.reduce((sum, p) => sum + p.loadout.length, 0));
	const humanCount = $derived(players.filter((p) => p.kind === 'human').length);
	const atCap = $derived(players.length >= Math.min(10, rules.maxPlayers));

	function nextColor(): number {
		const used = new Set(players.map((p) => p.colorIndex));
		for (let i = 0; i < 10; i++) if (!used.has(i)) return i;
		return 0;
	}

	function applyPreset(id: string): void {
		const config = buildPreset(id);
		rules = config.rules;
		players = config.setup.players;
		seed = config.setup.seed;
		manualPlacements = config.setup.manualPlacements ?? {};
		rotations = config.setup.rotations ?? {};
		presetId = id;
		notice = '';
		importErrors = [];
	}

	function normalise(next: GameRules): void {
		const capped = players.map((p) => {
			const loadout = p.loadout.slice(0, next.maxGraphersPerPlayer);
			return { ...p, loadout: loadout.length > 0 ? loadout : defaultLoadout(next, 1) };
		});
		players = capped;
		const nextRotations: Record<string, number[]> = {};
		for (const p of capped) {
			const list = rotations[p.id];
			if (list) nextRotations[p.id] = list.slice(0, p.loadout.length);
		}
		rotations = nextRotations;
		const placements: Record<string, Vector2[]> = {};
		for (const p of capped) {
			const list = manualPlacements[p.id];
			if (list) placements[p.id] = list.slice(0, p.loadout.length);
		}
		manualPlacements = placements;
		if (next.maxPlayers < players.length) {
			notice = `The player limit is now ${next.maxPlayers}; remove ${players.length - next.maxPlayers} player(s) before starting.`;
		}
	}

	function applyRules(next: GameRules): void {
		rules = next;
		normalise(next);
		presetId = 'custom';
	}

	function updateLoadout(playerId: string, loadout: GrapherType[]): void {
		players = players.map((p) => (p.id === playerId ? { ...p, loadout } : p));
		const angles = rotations[playerId];
		if (angles) {
			rotations = { ...rotations, [playerId]: angles.slice(0, loadout.length) };
		}
		const positions = manualPlacements[playerId];
		if (positions) {
			manualPlacements = {
				...manualPlacements,
				[playerId]: positions.slice(0, loadout.length)
			};
		}
		presetId = 'custom';
	}

	function updatePlayer(playerId: string, patch: Partial<PlayerConfig>): void {
		players = players.map((p) => (p.id === playerId ? { ...p, ...patch } : p));
		presetId = 'custom';
	}

	function addPlayer(kind: PlayerKind): void {
		if (atCap) return;
		const id = `p_${randomId()}`;
		const cpuIndex = players.filter((p) => p.kind === 'cpu').length;
		players = [
			...players,
			{
				id,
				name: kind === 'cpu' ? `CPU ${cpuIndex + 1}` : `Player ${humanCount + 1}`,
				kind,
				colorIndex: nextColor(),
				cpuDifficulty: kind === 'cpu' ? 'steady' : undefined,
				loadout: defaultLoadout(rules, Math.min(5, rules.maxGraphersPerPlayer))
			}
		];
		presetId = 'custom';
	}

	function fillCpus(): void {
		const limit = Math.min(10, rules.maxPlayers);
		let working = [...players];
		let index = working.filter((p) => p.kind === 'cpu').length;
		while (working.length < limit) {
			const used = new Set(working.map((p) => p.colorIndex));
			let color = 0;
			while (used.has(color) && color < 9) color++;
			working.push({
				id: `p_${randomId()}`,
				name: CPU_NAMES[index % CPU_NAMES.length] ?? `CPU ${index + 1}`,
				kind: 'cpu',
				colorIndex: color,
				cpuDifficulty: 'steady',
				loadout: defaultLoadout(rules, Math.min(5, rules.maxGraphersPerPlayer))
			});
			index++;
		}
		players = working;
		presetId = 'custom';
	}

	function removePlayer(playerId: string): void {
		if (players.length <= 2) return;
		const target = players.find((p) => p.id === playerId);
		if (!target) return;
		if (target.kind === 'human' && humanCount <= 1) return;
		players = players.filter((p) => p.id !== playerId);
		const placements = { ...manualPlacements };
		delete placements[playerId];
		manualPlacements = placements;
		const angles = { ...rotations };
		delete angles[playerId];
		rotations = angles;
		presetId = 'custom';
	}

	function changeKind(player: PlayerConfig, kind: PlayerKind): void {
		updatePlayer(player.id, {
			kind,
			cpuDifficulty: kind === 'cpu' ? (player.cpuDifficulty ?? 'steady') : undefined
		});
	}

	function setDifficulty(player: PlayerConfig, value: string): void {
		updatePlayer(player.id, { cpuDifficulty: value as CpuDifficulty });
	}

	function rerollSeed(): void {
		seed = `fkill-${randomId()}`;
	}

	function start(): void {
		if (!validation.ok) return;
		soloGame.start(validation.config);
		void goto('/play');
	}

	function download(): void {
		if (!validation.ok) {
			importErrors = ['Fix the configuration errors before exporting.'];
			return;
		}
		const blob = new Blob([exportConfig(validation.config)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `fkill-${seed.slice(0, 24) || 'config'}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function loadFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const text = await file.text();
		const parsed = importConfig(text);
		if (!parsed.ok) {
			importErrors = parsed.errors;
			notice = '';
			input.value = '';
			return;
		}
		rules = parsed.config.rules;
		players = parsed.config.setup.players;
		seed = parsed.config.setup.seed;
		manualPlacements = parsed.config.setup.manualPlacements ?? {};
		rotations = parsed.config.setup.rotations ?? {};
		presetId = 'custom';
		importErrors = [];
		notice = `Imported ${players.length} players and a ${parsed.config.setup.seed} seed.`;
		input.value = '';
	}

	function rememberSetup(): void {
		if (!validation.ok) return;
		updatePreference('defaultConfigJson', exportConfig(validation.config));
		notice = 'Saved this configuration as the default for new matches.';
	}

	function enterOnlineMatch(): void {
		void goto('/play?mode=online');
	}
</script>

<svelte:head>
	<title>Match setup — f(kill)</title>
</svelte:head>

<div class="setup">
	<header class="page-head">
		<div>
			<p class="eyebrow">{mode === 'online' ? 'Online rooms' : 'Solo / local match'}</p>
			<h1>{mode === 'online' ? 'Play other humans' : 'Build the engagement'}</h1>
			<p class="sub">
				{mode === 'online'
					? 'Create a room and share the code, or join one. The relay validates every shot.'
					: 'Configure rules, rosters and placement. Everything you change here is enforced by the engine.'}
			</p>
		</div>
		<div class="mode-switch" role="tablist" aria-label="Play mode">
			<a
				href="/lobby?mode=solo"
				class:active={mode === 'solo'}
				role="tab"
				aria-selected={mode === 'solo'}
			>Solo / local</a>
			<a
				href="/lobby?mode=online"
				class:active={mode === 'online'}
				role="tab"
				aria-selected={mode === 'online'}
			>Online room</a>
		</div>
	</header>

	{#if mode === 'online'}
		<OnlineLobby
			online={online}
			{initialCode}
			onEnterMatch={enterOnlineMatch}
			onExit={() => goto('/')}
		/>
	{:else}
		<div class="presets" aria-label="Match presets">
			<span class="presets-label">Presets</span>
			{#each PRESETS as preset (preset.id)}
				<button
					type="button"
					class="preset"
					class:active={presetId === preset.id}
					title={preset.description}
					onclick={() => applyPreset(preset.id)}
				>
					{preset.label}
				</button>
			{/each}
			<span class="preset-hint">Presets populate real rules and stay editable.</span>
		</div>

		<div class="setup-grid">
			<div class="left">
				<section class="roster" aria-labelledby="roster-title">
					<header class="section-bar">
						<div>
							<h2 id="roster-title">Roster</h2>
							<p>{players.length} / {Math.min(10, rules.maxPlayers)} players · {grapherTotal} graphers total</p>
						</div>
						<div class="roster-actions">
							<button type="button" onclick={() => addPlayer('cpu')} disabled={atCap}>+ CPU</button>
							<button type="button" onclick={() => addPlayer('human')} disabled={atCap}>+ Local player</button>
							<button type="button" onclick={fillCpus} disabled={atCap}>Fill CPUs</button>
						</div>
					</header>

					<div class="player-grid">
						{#each players as player, index (player.id)}
							{@const visual = playerVisual(player.colorIndex)}
							<article class="player-card" style="--c:{visual.color}">
								<header>
									<span class="marker" aria-hidden="true">{visual.glyph}</span>
									<input
										class="name"
										aria-label={`Name for player ${index + 1}`}
										maxlength="20"
										value={player.name}
										oninput={(e) => updatePlayer(player.id, { name: (e.currentTarget as HTMLInputElement).value })}
									/>
									<span class="kind-tag">{player.kind === 'cpu' ? 'CPU' : 'HUMAN'}</span>
									<button
										type="button"
										class="remove"
										aria-label={`Remove ${player.name}`}
										disabled={players.length <= 2 || (player.kind === 'human' && humanCount <= 1)}
										onclick={() => removePlayer(player.id)}
									>×</button>
								</header>

								<div class="player-controls">
									<label>
										<span>Kind</span>
										<select value={player.kind} onchange={(e) => changeKind(player, (e.currentTarget as HTMLSelectElement).value as PlayerKind)}>
											<option value="human">Human</option>
											<option value="cpu">CPU</option>
										</select>
									</label>
									{#if player.kind === 'cpu'}
										<label>
											<span>Difficulty</span>
											<select
												value={player.cpuDifficulty ?? 'steady'}
												onchange={(e) => setDifficulty(player, (e.currentTarget as HTMLSelectElement).value)}
											>
												{#each DIFFICULTY_ORDER as tier (tier)}
													<option value={tier}>{DIFFICULTY_LABELS[tier]}</option>
												{/each}
											</select>
										</label>
									{:else}
										<span class="human-note">Shares this screen · acts on their turn</span>
									{/if}
									<span class="identity">
										<span class="line-sample" data-style={visual.lineStyle} aria-hidden="true"></span>
										Identity {player.colorIndex + 1}
									</span>
								</div>

								<LoadoutEditor
									loadout={player.loadout}
									{rules}
									onChange={(loadout) => updateLoadout(player.id, loadout)}
								/>
							</article>
						{/each}
					</div>
				</section>

				{#if rules.coordinates.mode === 'local' && rules.coordinates.allowRotation}
					<PlaneRotation {players} bind:rotations />
				{/if}

				{#if rules.placement.mode === 'manual'}
					<PlacementBoard
						{rules}
						{players}
						{seed}
						{rotations}
						bind:manualPlacements
					/>
				{/if}

				<section class="validation" aria-labelledby="validation-title">
					<header>
						<h2 id="validation-title">Pre-flight check</h2>
						<span class="status" class:ok={validation.ok} class:bad={!validation.ok}>
							{validation.ok ? 'configuration valid' : `${validation.errors.length} error(s)`}
						</span>
					</header>
					{#if !validation.ok}
						<ul class="errors" role="alert">
							{#each validation.errors.slice(0, 8) as error, i (i)}
								<li>{error}</li>
							{/each}
						</ul>
						{#if validation.errors.length > 8}
							<p class="more">+ {validation.errors.length - 8} more…</p>
						{/if}
					{:else}
						<p class="ready">
							{humanCount} human{humanCount === 1 ? '' : 's'} · {players.length - humanCount} CPU ·
							{rules.turns.mode === 'ffa' ? 'free-for-all' : `${rules.turns.mode.replace('-', ' ')} turns`} ·
							{rules.coordinates.mode} plane
						</p>
						{#if validation.warnings.length > 0}
							<details class="warnings">
								<summary>{validation.warnings.length} warning(s)</summary>
								<ul>
									{#each validation.warnings as warning, i (i)}
										<li>{warning}</li>
									{/each}
								</ul>
							</details>
						{/if}
					{/if}
					{#if importErrors.length > 0}
						<ul class="errors" role="alert">
							{#each importErrors as error, i (i)}<li>{error}</li>{/each}
						</ul>
					{/if}
					{#if notice}<p class="notice" role="status">{notice}</p>{/if}
				</section>
			</div>

			<aside class="settings-panel" aria-label="Match settings">
				<MatchSettings
					bind:rules
					playerCount={players.length}
					onChange={applyRules}
				/>
			</aside>
		</div>

		<div class="startbar">
			<div class="seed">
				<label for="seed">Match seed</label>
				<div class="seed-row">
					<input id="seed" value={seed} oninput={(e) => (seed = (e.currentTarget as HTMLInputElement).value)} />
					<button type="button" onclick={rerollSeed}>Reroll</button>
				</div>
				<p>Seeded setup makes obstacle layout, placement and CPU choices reproducible.</p>
			</div>

			<div class="transfer">
				<button type="button" onclick={download} disabled={!validation.ok}>Export JSON</button>
				<button type="button" onclick={() => fileInput?.click()}>Import JSON</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="application/json,.json"
					class="sr-only"
					onchange={loadFile}
				/>
				<button type="button" onclick={rememberSetup} disabled={!validation.ok}>Save as default</button>
			</div>

			<button class="start" type="button" disabled={!validation.ok} onclick={start}>
				Start match
				<span>→</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.setup {
		padding: 22px 18px 34px;
		max-width: 1420px;
		margin: 0 auto;
	}

	.page-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 20px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}

	h1 {
		font-size: clamp(24px, 3vw, 34px);
		letter-spacing: -0.03em;
		margin: 0 0 4px;
		font-weight: 640;
	}

	.sub {
		margin: 0;
		color: var(--muted);
		font-size: 12px;
		max-width: 70ch;
	}

	.mode-switch {
		display: inline-flex;
		border: 1px solid var(--line);
		background: var(--panel);
		border-radius: 6px;
		padding: 2px;
	}

	.mode-switch a {
		padding: 5px 12px;
		border-radius: 4px;
		font-size: 11.5px;
		color: var(--muted);
		text-decoration: none;
	}

	.mode-switch a.active {
		background: var(--accent-dim);
		color: var(--accent);
	}

	.presets {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: rgba(13, 19, 29, 0.7);
		margin-bottom: 12px;
	}

	.presets-label {
		font-size: 9px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--faint);
		margin-right: 3px;
	}

	.preset {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--muted);
		border-radius: 20px;
		padding: 3px 10px;
		font-size: 10.5px;
	}

	.preset:hover {
		border-color: var(--accent);
		color: var(--text);
	}

	.preset.active {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-dim);
	}

	.preset-hint {
		margin-left: auto;
		font-size: 9.5px;
		color: var(--faint);
	}

	.setup-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(380px, 440px);
		gap: 12px;
		align-items: start;
	}

	.left {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.roster {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
		padding: 12px;
	}

	.section-bar {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 10px;
		flex-wrap: wrap;
	}

	.section-bar h2 {
		margin: 0;
		font-size: 13px;
	}

	.section-bar p {
		margin: 2px 0 0;
		font-size: 10px;
		color: var(--muted);
	}

	.roster-actions {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.roster-actions button,
	.transfer button,
	.seed-row button {
		background: var(--panel-raised);
		border: 1px solid var(--line-bright);
		color: var(--text);
		border-radius: 5px;
		padding: 4px 9px;
		font-size: 10.5px;
	}

	.roster-actions button:hover:not(:disabled),
	.transfer button:hover:not(:disabled),
	.seed-row button:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.roster-actions button:disabled,
	.transfer button:disabled {
		opacity: 0.45;
	}

	.player-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 7px;
	}

	.player-card {
		border: 1px solid var(--line);
		border-left: 2px solid var(--c);
		border-radius: 0 7px 7px 0;
		background: rgba(18, 26, 38, 0.55);
		padding: 8px 9px;
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
	}

	.player-card > header {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.marker {
		color: var(--c);
		width: 14px;
		text-align: center;
		flex: none;
	}

	.name {
		background: transparent;
		border: 1px solid transparent;
		border-bottom-color: var(--line);
		border-radius: 3px;
		padding: 2px 4px;
		font-size: 12px;
		font-weight: 600;
		min-width: 0;
		flex: 1;
	}

	.name:hover {
		border-color: var(--line-bright);
	}

	.name:focus {
		border-color: var(--accent);
		outline: none;
	}

	.kind-tag {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.08em;
		color: var(--faint);
	}

	.remove {
		background: transparent;
		border: 0;
		color: var(--faint);
		font-size: 15px;
		line-height: 1;
		padding: 0 2px;
	}

	.remove:hover:not(:disabled) {
		color: var(--danger);
	}

	.remove:disabled {
		opacity: 0.25;
	}

	.player-controls {
		display: flex;
		gap: 8px;
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.player-controls label {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 8.5px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
	}

	.player-controls select {
		background: var(--bg-soft);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 3px 4px;
		font-size: 10.5px;
		color: var(--text);
	}

	.human-note {
		font-size: 9.5px;
		color: var(--faint);
		padding-bottom: 4px;
	}

	.identity {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-family: var(--mono);
		font-size: 8.5px;
		color: var(--faint);
		padding-bottom: 4px;
	}

	.line-sample {
		width: 18px;
		height: 0;
		border-top: 2px solid var(--c);
	}

	.line-sample[data-style='dashed'] {
		border-top-style: dashed;
	}

	.line-sample[data-style='dotted'] {
		border-top-style: dotted;
	}

	.line-sample[data-style='dashdot'] {
		border-top-style: dashed;
	}

	.validation {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
		padding: 11px 12px;
	}

	.validation header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		margin-bottom: 6px;
	}

	.validation h2 {
		margin: 0;
		font-size: 12px;
	}

	.status {
		font-family: var(--mono);
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.status.ok {
		color: var(--success);
	}

	.status.bad {
		color: var(--danger);
	}

	.errors {
		margin: 0;
		padding-left: 16px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 10.5px;
		color: #ffc1c1;
	}

	.more {
		margin: 4px 0 0;
		font-size: 9.5px;
		color: var(--faint);
	}

	.ready {
		margin: 0;
		font-size: 10.5px;
		color: var(--muted);
	}

	.warnings {
		margin-top: 7px;
		font-size: 10px;
		color: var(--muted);
	}

	.warnings summary {
		cursor: pointer;
		color: var(--attack);
	}

	.warnings ul {
		margin: 5px 0 0;
		padding-left: 16px;
	}

	.notice {
		margin: 7px 0 0;
		font-size: 10.5px;
		color: var(--success);
	}

	.settings-panel {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
		min-width: 0;
		max-height: calc(100vh - 120px);
		overflow: auto;
		position: sticky;
		top: 64px;
	}

	.startbar {
		position: sticky;
		bottom: 0;
		z-index: 20;
		display: flex;
		align-items: flex-end;
		gap: 16px;
		flex-wrap: wrap;
		margin-top: 12px;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: 9px;
		background: rgba(9, 14, 22, 0.94);
		backdrop-filter: blur(8px);
	}

	.seed {
		flex: 1 1 320px;
		min-width: 0;
	}

	.seed > label {
		display: block;
		font-size: 8.5px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--faint);
		margin-bottom: 3px;
	}

	.seed-row {
		display: flex;
		gap: 4px;
	}

	.seed-row input {
		flex: 1;
		min-width: 0;
		background: var(--bg-soft);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 4px 7px;
		font-family: var(--mono);
		font-size: 10.5px;
	}

	.seed p {
		margin: 3px 0 0;
		font-size: 9px;
		color: var(--faint);
	}

	.transfer {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.start {
		background: var(--accent);
		border: 1px solid var(--accent);
		color: #041016;
		font-weight: 700;
		font-size: 13px;
		padding: 7px 18px;
		border-radius: 6px;
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}

	.start:hover:not(:disabled) {
		background: #7defff;
	}

	.start:disabled {
		background: var(--panel-raised);
		border-color: var(--line);
		color: var(--faint);
	}

	.start span {
		font-size: 15px;
	}

	@media (max-width: 1120px) {
		.setup-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.settings-panel {
			position: static;
			max-height: none;
		}
	}

	@media (max-width: 720px) {
		.setup {
			padding: 16px 10px 28px;
		}
		.player-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.startbar {
			gap: 10px;
		}
		.start {
			width: 100%;
			justify-content: center;
		}
	}
</style>
