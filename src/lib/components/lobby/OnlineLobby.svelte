<script lang="ts">
	import { onMount } from 'svelte';
	import type { CpuDifficulty, GameRules, GrapherType } from '$lib/game/types';
	import { PRESETS, buildPreset } from '$lib/game/defaults';
	import { defaultRelayUrl } from '$lib/multiplayer/transport';
	import { onlineSession, type OnlineState } from '$lib/ui/stores';
	import { preferences, updatePreference } from '$lib/ui/preferences';
	import { playerVisual } from '$lib/ui/theme';
	import { DIFFICULTY_LABELS, DIFFICULTY_ORDER } from '$lib/cpu/difficulty';
	import MatchSettings from './MatchSettings.svelte';
	import LoadoutEditor from './LoadoutEditor.svelte';

	let {
		online,
		initialCode = '',
		onEnterMatch,
		onExit
	}: {
		online: OnlineState;
		initialCode?: string;
		onEnterMatch: () => void;
		onExit: () => void;
	} = $props();

	let name = $state($preferences.playerName);
	let presetId = $state(PRESETS[0].id);
	let code = $state(initialCode.toUpperCase().slice(0, 6));
	let localError = $state('');
	let copied = $state(false);
	let cpuDifficulty = $state<CpuDifficulty>('steady');
	let triedAutoJoin = false;

	const snapshot = $derived(online.snapshot);
	const selfPlayer = $derived(snapshot?.players.find((p) => p.id === snapshot.selfId) ?? null);
	const isHost = $derived(Boolean(snapshot && snapshot.hostId === snapshot.selfId));
	const humans = $derived(snapshot?.players.filter((p) => p.kind === 'human') ?? []);
	const cpus = $derived(snapshot?.players.filter((p) => p.kind === 'cpu') ?? []);
	const allHumansReady = $derived(humans.length > 0 && humans.every((p) => p.ready));
	const maxCpus = $derived(
		snapshot ? Math.max(0, snapshot.config.rules.maxPlayers - humans.length) : 0
	);
	const canStart = $derived(Boolean(snapshot && snapshot.players.length >= 2 && allHumansReady));
	const startReason = $derived.by(() => {
		if (!snapshot) return '';
		if (snapshot.players.length < 2) return 'At least two players (human or CPU) are needed.';
		if (!allHumansReady) {
			const waiting = humans.filter((p) => !p.ready).map((p) => p.name);
			return `Waiting for ${waiting.join(', ')} to ready up.`;
		}
		return '';
	});
	const relay = defaultRelayUrl();
	const phase = $derived(snapshot?.phase ?? null);

	const statusLabel = $derived(
		online.status === 'connected'
			? 'Connected'
			: online.status === 'connecting'
				? 'Connecting…'
				: online.status === 'reconnecting'
					? 'Reconnecting…'
					: online.status === 'offline'
						? 'Offline'
						: online.status === 'closed'
							? 'Closed'
							: 'Not connected'
	);

	function rememberName(value: string): void {
		name = value.slice(0, 20);
		updatePreference('playerName', name.trim() || 'Player');
	}

	function create(): void {
		if (!name.trim()) {
			localError = 'Choose a display name first.';
			return;
		}
		localError = '';
		onlineSession.create(buildPreset(presetId), name.trim());
	}

	function doJoin(raw?: string): void {
		const wanted = (raw ?? code).trim().toUpperCase();
		if (wanted.length < 4) {
			localError = 'Room codes are at least four characters.';
			return;
		}
		if (!name.trim()) {
			localError = 'Choose a display name first.';
			return;
		}
		localError = '';
		// Returning to an invite link after a reload resumes the stored seat
		// (same room, same player id) before falling back to a fresh join.
		if (onlineSession.resume(wanted, name.trim())) return;
		onlineSession.join(wanted, name.trim());
	}

	function copyInvite(): void {
		if (!snapshot) return;
		const url = `${window.location.origin}${window.location.pathname}?room=${snapshot.code}`;
		const done = () => {
			copied = true;
			setTimeout(() => (copied = false), 1600);
		};
		if (navigator.clipboard?.writeText) {
			void navigator.clipboard.writeText(url).then(done).catch(() => {
				window.prompt('Copy this invite link', url);
			});
		} else {
			window.prompt('Copy this invite link', url);
		}
	}

	function setCpuCount(count: number): void {
		onlineSession.send({ kind: 'set-cpu', count: Math.max(0, Math.floor(count)), difficulty: cpuDifficulty });
	}

	function setCpuDifficulty(value: CpuDifficulty): void {
		cpuDifficulty = value;
		setCpuCount(cpus.length);
	}

	function setReady(ready: boolean): void {
		onlineSession.send({ kind: 'ready', ready });
	}

	function start(): void {
		onlineSession.send({ kind: 'start' });
	}

	function leave(): void {
		onlineSession.leave();
	}

	function sendLoadout(loadout: GrapherType[]): void {
		if (!loadout.length) return;
		onlineSession.send({ kind: 'set-loadout', loadout });
	}

	function sendRules(rules: GameRules): void {
		if (isHost) onlineSession.send({ kind: 'set-rules', rules });
	}

	$effect(() => {
		if (cpus.length > 0 && cpus[0].cpuDifficulty && cpus[0].cpuDifficulty !== cpuDifficulty) {
			cpuDifficulty = cpus[0].cpuDifficulty;
		}
	});

	let entered = false;
	$effect(() => {
		if (entered) return;
		if (phase === 'starting' || phase === 'running' || phase === 'finished') {
			entered = true;
			onEnterMatch();
		}
	});

	onMount(() => {
		if (initialCode && !triedAutoJoin) {
			triedAutoJoin = true;
			doJoin(initialCode);
		}
	});
</script>

<div class="online">
	<header class="bar">
		<div>
			<p class="eyebrow">Online rooms</p>
			<h1>f(kill) <span>multiplayer</span></h1>
		</div>
		<div class="bar-right">
			<span class="status" data-status={online.status}>
				<i aria-hidden="true"></i>{statusLabel}
			</span>
			{#if snapshot}
				<button type="button" class="ghost" onclick={leave}>Leave room</button>
			{:else}
				<button type="button" class="ghost" onclick={onExit}>Back to setup</button>
			{/if}
		</div>
	</header>

	{#if online.error}
		<div class="alert" role="alert">
			<div>
				<strong>{online.error.code.replace(/-/g, ' ')}</strong>
				<span>{online.error.message}</span>
			</div>
			<button type="button" class="dismiss" onclick={() => onlineSession.clearError()} aria-label="Dismiss error">✕</button>
		</div>
	{/if}
	{#if localError}
		<div class="alert" role="alert">
			<div><span>{localError}</span></div>
			<button type="button" class="dismiss" onclick={() => (localError = '')} aria-label="Dismiss message">✕</button>
		</div>
	{/if}
	{#if online.detail}
		<p class="detail">{online.detail}</p>
	{/if}

	{#if !snapshot}
		<div class="entry">
			<section class="card" aria-labelledby="create-title">
				<h2 id="create-title">Create a room</h2>
				<p class="hint">
					You become the host and choose the shared rules. Other humans and CPUs fill the
					remaining seats, up to ten players.
				</p>
				<label class="field">
					<span>Display name</span>
					<input value={name} maxlength="20" oninput={(e) => rememberName(e.currentTarget.value)} />
				</label>
				<label class="field">
					<span>Starting preset</span>
					<select bind:value={presetId}>
						{#each PRESETS as preset (preset.id)}
							<option value={preset.id}>{preset.label}</option>
						{/each}
					</select>
				</label>
				<p class="preset-desc">
					{PRESETS.find((p) => p.id === presetId)?.description ?? ''}
				</p>
				<button type="button" class="primary" disabled={online.status === 'connecting'} onclick={create}>
					{online.status === 'connecting' ? 'Opening room…' : 'Create room'}
				</button>
			</section>

			<section class="card" aria-labelledby="join-title">
				<h2 id="join-title">Join a room</h2>
				<p class="hint">
					Ask the host for their six-character room code, or open their invite link.
				</p>
				<label class="field">
					<span>Display name</span>
					<input value={name} maxlength="20" oninput={(e) => rememberName(e.currentTarget.value)} />
				</label>
				<label class="field">
					<span>Room code</span>
					<input
						class="code-input"
						value={code}
						maxlength="6"
						autocomplete="off"
						spellcheck="false"
						placeholder="ABC123"
						oninput={(e) => (code = e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
						onkeydown={(e) => {
							if (e.key === 'Enter') doJoin();
						}}
					/>
				</label>
				<button
					type="button"
					class="primary"
					disabled={online.status === 'connecting' || code.length < 4}
					onclick={() => doJoin()}
				>
					Join room
				</button>
				<p class="relay">
					Relay <code>{relay}</code>. Online play needs the authoritative relay running
					(<code>npm run relay</code>); solo and CPU matches work without it.
				</p>
			</section>
		</div>
	{:else if phase === 'closed'}
		<section class="card narrow">
			<h2>Room closed</h2>
			<p class="hint">This room has ended. Create a fresh room to play again.</p>
			<button type="button" class="primary" onclick={leave}>New room</button>
		</section>
	{:else if phase === 'starting' || phase === 'running' || phase === 'finished'}
		<section class="card narrow">
			<h2>Match in progress</h2>
			<p class="hint">Loading the authoritative board…</p>
			<button type="button" class="primary" onclick={onEnterMatch}>Open match</button>
		</section>
	{:else}
		<div class="lobby">
			<section class="room" aria-label="Room information">
				<div class="room-head">
					<div>
						<p class="eyebrow">Room code</p>
						<p class="room-code">{snapshot.code}</p>
					</div>
					<button type="button" class="ghost" onclick={copyInvite}>
						{copied ? 'Copied' : 'Copy invite'}
					</button>
				</div>

				<div class="players">
					{#each snapshot.players as player (player.id)}
						{@const visual = playerVisual(player.colorIndex)}
						<div class="player" class:me={player.id === snapshot.selfId}>
							<span class="glyph" style="--c:{visual.color}" aria-hidden="true">{visual.glyph}</span>
							<span class="who">
								<span class="name">
									{player.name}
									{#if player.id === snapshot.selfId}<em>you</em>{/if}
									{#if player.id === snapshot.hostId}<span class="tag">host</span>{/if}
								</span>
								<span class="meta">
									{#if player.kind === 'cpu'}
										CPU · {DIFFICULTY_LABELS[player.cpuDifficulty ?? 'steady']}
									{:else}
										Human
									{/if}
									· {player.loadout.length} grapher{player.loadout.length === 1 ? '' : 's'}
									{#if !player.connected}<span class="offline">disconnected</span>{/if}
								</span>
							</span>
							<span class="ready" class:yes={player.ready || player.kind === 'cpu'}>
								{player.kind === 'cpu' || player.ready ? 'Ready' : 'Not ready'}
							</span>
						</div>
					{/each}
				</div>

				{#if snapshot.notice}
					<p class="notice">{snapshot.notice}</p>
				{/if}

				{#if selfPlayer}
					<div class="loadout-block">
						<LoadoutEditor
							loadout={selfPlayer.loadout}
							rules={snapshot.config.rules}
							onChange={sendLoadout}
						/>
						<p class="tiny">
							Your loadout is private to this seat. CPU loadouts use the room defaults.
						</p>
					</div>
					<div class="ready-row">
						<button
							type="button"
							class="primary"
							class:ready-on={selfPlayer.ready}
							onclick={() => setReady(!selfPlayer.ready)}
						>
							{selfPlayer.ready ? 'Ready ✓ (click to cancel)' : 'Ready up'}
						</button>
						<span class="latency">{online.latencyMs > 0 ? `${online.latencyMs} ms` : '—'} ping</span>
					</div>
				{/if}

				<div class="start-row">
					{#if isHost}
						<button type="button" class="start" disabled={!canStart} onclick={start}>
							Start match
						</button>
						{#if startReason}<span class="tiny">{startReason}</span>{/if}
					{:else}
						<span class="waiting">Waiting for the host to start…</span>
					{/if}
				</div>
			</section>

			<div class="settings-column">
				<section class="cpu-panel" aria-label="CPU opponents">
					<h2>CPU opponents</h2>
					{#if isHost}
						<div class="cpu-controls">
							<label class="field inline">
								<span>Count</span>
								<select
									value={String(cpus.length)}
									onchange={(e) => setCpuCount(Number(e.currentTarget.value))}
								>
									{#each Array.from({ length: maxCpus + 1 }, (_, i) => i) as n (n)}
										<option value={String(n)}>{n}</option>
									{/each}
								</select>
							</label>
							<label class="field inline">
								<span>Difficulty</span>
								<select
									value={cpuDifficulty}
									onchange={(e) => setCpuDifficulty(e.currentTarget.value as CpuDifficulty)}
								>
									{#each DIFFICULTY_ORDER as id (id)}
										<option value={id}>{DIFFICULTY_LABELS[id]}</option>
									{/each}
								</select>
							</label>
						</div>
						<p class="tiny">Difficulty changes how well CPUs search and aim, never their legality.</p>
					{:else}
						<p class="tiny">
							{cpus.length} CPU opponent{cpus.length === 1 ? '' : 's'} in this room. Only the host can
							change them.
						</p>
					{/if}
				</section>

				<section class="rules-panel" aria-label="Match rules">
					<MatchSettings
						rules={snapshot.config.rules}
						playerCount={snapshot.players.length}
						locked={!isHost}
						online
						onChange={sendRules}
					/>
				</section>
			</div>
		</div>
	{/if}

	<footer class="foot">
		<span>Authoritative relay · snapshots only</span>
		<span>Protocol {snapshot?.protocol ?? 1}</span>
	</footer>
</div>

<style>
	.online {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px 16px 20px;
		max-width: 1320px;
		width: 100%;
		margin: 0 auto;
		box-sizing: border-box;
	}

	.bar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 14px;
		flex-wrap: wrap;
	}

	.eyebrow {
		margin: 0 0 3px;
		font-size: 9.5px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h1 {
		margin: 0;
		font-size: 22px;
		letter-spacing: -0.01em;
		font-weight: 600;
	}

	h1 span {
		font-size: 12px;
		font-weight: 500;
		color: var(--muted);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	h2 {
		margin: 0 0 8px;
		font-size: 12px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text);
		font-weight: 600;
	}

	.bar-right {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.status i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--muted);
	}

	.status[data-status='connected'] i {
		background: var(--success);
	}

	.status[data-status='connecting'] i,
	.status[data-status='reconnecting'] i {
		background: var(--attack);
	}

	.status[data-status='offline'] i {
		background: var(--danger);
	}

	.alert {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		align-items: flex-start;
		border: 1px solid rgba(255, 107, 107, 0.36);
		background: rgba(255, 107, 107, 0.08);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 11.5px;
		color: #ffc9c9;
	}

	.alert div {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.alert strong {
		text-transform: uppercase;
		font-size: 9px;
		letter-spacing: 0.1em;
		padding-top: 2px;
	}

	.dismiss {
		background: transparent;
		border: 0;
		color: inherit;
		cursor: pointer;
		font-size: 12px;
		line-height: 1;
		opacity: 0.7;
		padding: 2px;
	}

	.detail {
		margin: 0;
		font-size: 11px;
		color: var(--muted);
	}

	.entry {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	.card,
	.room,
	.cpu-panel,
	.rules-panel {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 14px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.card.narrow {
		max-width: 420px;
	}

	.hint {
		margin: 0;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--muted);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 10px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.field input,
	.field select {
		background: #0a1019;
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--text);
		font-size: 12.5px;
		padding: 6px 8px;
		font-family: inherit;
		letter-spacing: normal;
		text-transform: none;
	}

	.field input:focus-visible,
	.field select:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.code-input {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.24em !important;
		text-transform: uppercase;
		font-size: 16px !important;
	}

	.preset-desc {
		margin: 0;
		font-size: 10.5px;
		line-height: 1.45;
		color: var(--muted);
		min-height: 2.9em;
	}

	button {
		font-family: inherit;
		cursor: pointer;
	}

	.primary {
		background: var(--accent);
		color: #04121a;
		border: 1px solid var(--accent);
		border-radius: 6px;
		padding: 7px 11px;
		font-size: 11.5px;
		font-weight: 600;
		letter-spacing: 0.03em;
	}

	.primary:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.ghost {
		background: transparent;
		color: var(--muted);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 5px 9px;
		font-size: 10.5px;
	}

	.ghost:hover {
		color: var(--text);
		border-color: #2c425d;
	}

	.relay {
		margin: 2px 0 0;
		font-size: 10px;
		line-height: 1.5;
		color: var(--muted);
	}

	.relay code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: #b9cbe1;
	}

	.lobby {
		display: grid;
		grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
		gap: 12px;
		align-items: start;
	}

	.room {
		display: flex;
		flex-direction: column;
		gap: 11px;
	}

	.room-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 10px;
	}

	.room-code {
		margin: 0;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 30px;
		letter-spacing: 0.16em;
		color: var(--accent);
		line-height: 1;
	}

	.players {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.player {
		display: grid;
		grid-template-columns: 18px minmax(0, 1fr) auto;
		gap: 7px;
		align-items: center;
		border: 1px solid transparent;
		border-radius: 7px;
		padding: 5px 6px;
	}

	.player.me {
		background: #0a121d;
		border-color: var(--line);
	}

	.glyph {
		color: var(--c);
		font-size: 12px;
		text-align: center;
	}

	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.name {
		font-size: 12px;
		color: var(--text);
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
	}

	.name em {
		font-style: normal;
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
	}

	.tag {
		font-size: 8px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		border: 1px solid var(--line);
		border-radius: 3px;
		padding: 0 3px;
		color: var(--muted);
	}

	.meta {
		font-size: 9.5px;
		color: var(--muted);
	}

	.offline {
		color: var(--danger);
		margin-left: 4px;
	}

	.ready {
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--muted);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 1px 4px;
		white-space: nowrap;
	}

	.ready.yes {
		color: var(--success);
		border-color: rgba(94, 240, 168, 0.35);
	}

	.notice {
		margin: 0;
		font-size: 10.5px;
		line-height: 1.45;
		color: var(--attack);
		border-left: 2px solid var(--attack);
		padding-left: 7px;
	}

	.loadout-block {
		border-top: 1px solid var(--line);
		padding-top: 9px;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.ready-row {
		display: flex;
		align-items: center;
		gap: 9px;
		flex-wrap: wrap;
	}

	.primary.ready-on {
		background: transparent;
		color: var(--success);
		border-color: rgba(94, 240, 168, 0.5);
	}

	.latency {
		font-size: 9.5px;
		color: var(--muted);
	}

	.start-row {
		display: flex;
		flex-direction: column;
		gap: 5px;
		border-top: 1px solid var(--line);
		padding-top: 9px;
	}

	.start {
		background: var(--success);
		color: #04140d;
		border: 1px solid var(--success);
		border-radius: 6px;
		padding: 8px 12px;
		font-size: 12px;
		font-weight: 600;
	}

	.start:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.waiting {
		font-size: 11px;
		color: var(--muted);
	}

	.settings-column {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	.cpu-panel {
		padding: 11px 13px;
	}

	.cpu-controls {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}

	.field.inline {
		flex-direction: row;
		align-items: center;
		gap: 6px;
		text-transform: uppercase;
	}

	.field.inline select {
		padding: 4px 6px;
		font-size: 11px;
	}

	.tiny {
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
		color: var(--muted);
	}

	.rules-panel {
		padding: 0;
		background: transparent;
		border: 0;
	}

	.foot {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 9px;
		color: var(--muted);
		letter-spacing: 0.05em;
		text-transform: uppercase;
		border-top: 1px solid var(--line);
		padding-top: 8px;
	}

	@media (max-width: 960px) {
		.lobby {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.entry {
			grid-template-columns: minmax(0, 1fr);
		}
		.online {
			padding: 10px 10px 18px;
		}
		.room-code {
			font-size: 24px;
		}
	}
</style>
