<script lang="ts">
	import type { AttackComponentInput, MatchState } from '$lib/game/types';
	import type { CurveSegments } from '$lib/math/geometry';
	import { previewSelectedGrapher } from '$lib/game/state';
	import { cooldownApplies, cooldownDurationMs } from '$lib/game/rules';
	import { playerVisual, GRAPHER_TYPE_ACCENT } from '$lib/ui/theme';
	import type { AttackFeedback } from '$lib/ui/stores';
	import { preferences } from '$lib/ui/preferences';
	import GraphCanvas from '../graph/GraphCanvas.svelte';
	import EquationEditor from '../equation-editor/EquationEditor.svelte';
	import GrapherStrip from '../hud/GrapherStrip.svelte';
	import TurnPanel from '../hud/TurnPanel.svelte';
	import PlayerPanel from '../hud/PlayerPanel.svelte';
	import EventFeed from '../hud/EventFeed.svelte';
	import ResultsOverlay from '../hud/ResultsOverlay.svelte';

	let {
		state: match,
		selfId,
		now,
		feedback = null,
		onAttack,
		onPass,
		onRematch,
		onExit,
		mode = 'solo',
		connectionNote = '',
		busy = false,
		canRematch = true
	}: {
		state: MatchState;
		selfId: string;
		now: number;
		feedback?: AttackFeedback | null;
		onAttack: (components: AttackComponentInput[], grapherId?: string) => boolean;
		onPass: () => void;
		onRematch: () => void;
		onExit: () => void;
		mode?: 'solo' | 'online';
		connectionNote?: string;
		busy?: boolean;
		canRematch?: boolean;
	} = $props();

	let preview: CurveSegments = $state([]);
	let selectedGrapherId: string | null = $state(null);
	const prefs = $derived($preferences);

	const self = $derived(match.players.find((p) => p.id === selfId));
	const ownGraphers = $derived(match.graphers.filter((g) => g.ownerId === selfId));
	const aliveOwn = $derived(ownGraphers.filter((g) => g.alive));
	const isFfa = $derived(match.turn.mode === 'ffa');
	const active = $derived(isFfa || match.turn.activePlayerIds.includes(selfId));
	const acted = $derived(!isFfa && match.turn.actedPlayerIds.includes(selfId));
	const predicted = $derived(previewSelectedGrapher(match, selfId));
	const grapher = $derived(
		match.rules.selection === 'manual'
			? (ownGraphers.find((g) => g.id === selectedGrapherId) ?? aliveOwn[0] ?? null)
			: predicted
	);
	const myVisual = $derived(playerVisual(self?.colorIndex ?? 0));
	const cooldownLeft = $derived(
		grapher && grapher.cooldownUntil !== null && match.rules.selection === 'manual'
			? Math.max(0, grapher.cooldownUntil - now)
			: 0
	);

	const disabledReason = $derived.by(() => {
		if (match.phase === 'finished') return 'The match is over.';
		if (!self || !self.alive || aliveOwn.length === 0) return 'You have been eliminated.';
		if (!active) return 'Waiting for your turn.';
		if (acted) return 'You have already acted this batch.';
		if (!grapher) return 'No grapher available.';
		if (cooldownLeft > 0 && cooldownApplies(match.rules)) {
			return `${match.rules.grapherTypes[grapher.type].label} is cooling down for ${(cooldownLeft / 1000).toFixed(1)}s.`;
		}
		if (mode === 'online' && busy) return 'Applying your action…';
		return '';
	});
	const canFire = $derived(disabledReason === '');

	$effect(() => {
		if (match.rules.selection !== 'manual') return;
		const exists = ownGraphers.some((g) => g.id === selectedGrapherId && g.alive);
		if (!exists) {
			const ready = aliveOwn.find((g) => g.cooldownUntil === null || g.cooldownUntil <= now);
			selectedGrapherId = (ready ?? aliveOwn[0])?.id ?? null;
		}
	});

	const recentMine = $derived(match.attacks.filter((a) => a.playerId === selfId).slice(-4).reverse());

	function submit(components: AttackComponentInput[]): boolean {
		if (!canFire || !grapher) return false;
		const grapherId = match.rules.selection === 'manual' ? grapher.id : undefined;
		const ok = onAttack(components, grapherId);
		return ok;
	}

	function selectGrapher(id: string): void {
		selectedGrapherId = id;
	}

	function expressionOf(component: { expression?: string; arc?: { center: { x: number; y: number }; radius: number; startAngleDeg: number; sweepAngleDeg: number } }): string {
		if (component.expression) return component.expression;
		if (component.arc) {
			const a = component.arc;
			return `arc(${a.center.x}, ${a.center.y}, ${a.radius}, ${a.startAngleDeg}°, ${a.sweepAngleDeg}°)`;
		}
		return '';
	}
</script>

<div class="game">
	<aside class="console panel" aria-label="Equation console">
		<div class="panel-head">
			<h2>Console</h2>
			<span class="you" style="--c:{myVisual.color}">
				<span aria-hidden="true">{myVisual.glyph}</span>
				{self?.name ?? 'You'}
			</span>
		</div>

		<GrapherStrip
			state={match}
			{selfId}
			{now}
			selectedId={selectedGrapherId}
			disabled={match.phase === 'finished' || busy}
			onSelect={selectGrapher}
		/>

		{#if grapher}
			<EquationEditor
				rules={match.rules}
				{grapher}
				disabled={!canFire}
				disabledReason={disabledReason}
				onSubmit={submit}
				onPreview={(segments) => (preview = segments)}
			/>
		{:else}
			<p class="eliminated">No graphers remain.</p>
		{/if}

		{#if feedback}
			<div class="feedback" class:ok={feedback.ok} role="status" aria-live="polite">
				<span class="tag">{feedback.ok ? 'accepted' : 'rejected'}</span>
				<span>{feedback.message}</span>
			</div>
		{/if}

		{#if recentMine.length > 0}
			<div class="history">
				<h3>Your attacks</h3>
				<ul>
					{#each recentMine as attack (attack.id)}
						<li>
							<span class="a-time">b{attack.batchNumber}</span>
							<span class="a-expr">
								{#each attack.components as component, i (i)}
									<code>{expressionOf(component)}</code>{i < attack.components.length - 1 ? ' ' : ''}
								{/each}
							</span>
							<span class="a-result" class:hit={attack.targetsHit > 0}>
								{attack.targetsHit > 0 ? `${attack.targetsHit} hit` : attack.components.every((c) => c.outcome === 'blocked') ? 'blocked' : 'miss'}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</aside>

	<main class="arena" aria-label="Graphing arena">
		<div class="arena-top">
			<div class="summary">
				<span class="mode-chip">{match.rules.turns.mode === 'ffa' ? 'FFA' : match.rules.turns.mode === 'random' ? 'Random turns' : 'Round robin'}</span>
				<span>{match.rules.coordinates.mode === 'shared' ? 'Shared plane' : 'Local planes'}</span>
				<span>{match.rules.precision.showCoordinates ? 'Coordinates visible' : 'Coordinates hidden'}</span>
				{#if match.rules.obstacles.enabled}<span>Cover ×{match.rules.obstacles.durability}</span>{/if}
				{#if mode === 'online'}<span class="online">online</span>{/if}
			</div>
			{#if connectionNote}<span class="conn">{connectionNote}</span>{/if}
		</div>

		<div class="canvas-wrap">
			<GraphCanvas
				state={match}
				rules={match.rules}
				{selfId}
				{preview}
				previewColor={grapher ? GRAPHER_TYPE_ACCENT[grapher.type] : '#46e6ff'}
				selectedGrapherId={grapher?.id ?? null}
				historyCount={prefs.showHistory ? prefs.historyCount : 0}
				showHitZones={prefs.showHitZones}
				showGrid={prefs.showGrid}
				{now}
			/>
			{#if match.phase === 'finished'}
				<ResultsOverlay
					state={match}
					{selfId}
					onRematch={onRematch}
					onExit={onExit}
					online={mode === 'online'}
					{canRematch}
				/>
			{/if}
		</div>
	</main>

	<aside class="info" aria-label="Match information">
		<TurnPanel state={match} {selfId} {now} onPass={onPass} busy={busy} />
		<PlayerPanel state={match} {selfId} />
		<EventFeed state={match} />
		<details class="rules">
			<summary>Match rules</summary>
			<dl>
				<dt>Health</dt><dd>{match.rules.grapherHealth}</dd>
				<dt>Graphers / player</dt><dd>{match.rules.maxGraphersPerPlayer}</dd>
				<dt>Hit radius</dt><dd>{match.rules.targetHitRadius}</dd>
				<dt>Selection</dt><dd>{match.rules.selection.replace('auto-', 'auto ')}</dd>
				<dt>Cooldown</dt>
				<dd>{cooldownApplies(match.rules) ? `${(cooldownDurationMs(match.rules) / 1000).toFixed(1)}s` : 'off'}</dd>
				<dt>Scores</dt>
				<dd>{match.rules.scoring.baseHitPoints} + {match.rules.scoring.precisionBonusMax} × precision</dd>
				<dt>Seed</dt><dd><code>{match.seed}</code></dd>
			</dl>
			<button type="button" class="exit" onclick={onExit}>Leave match</button>
		</details>
	</aside>
</div>

<style>
	.game {
		display: grid;
		grid-template-columns: 318px minmax(0, 1fr) 296px;
		gap: 10px;
		height: calc(100vh - 108px);
		min-height: 540px;
		padding: 10px 12px 14px;
		box-sizing: border-box;
	}

	.panel,
	.info > :global(*) {
		min-width: 0;
	}

	.console {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
		padding: 11px;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 11px;
	}

	.panel-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	h2 {
		margin: 0;
		font-size: 10.5px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
		font-weight: 600;
	}

	.you {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--c);
	}

	.feedback {
		display: flex;
		gap: 6px;
		align-items: flex-start;
		border: 1px solid rgba(255, 107, 107, 0.35);
		background: rgba(255, 107, 107, 0.07);
		border-radius: 7px;
		padding: 6px 8px;
		font-size: 11px;
		line-height: 1.45;
		color: #ffc6c6;
	}

	.feedback.ok {
		border-color: rgba(94, 240, 168, 0.35);
		background: rgba(94, 240, 168, 0.06);
		color: #bdf5d8;
	}

	.feedback .tag {
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.85;
		padding-top: 1px;
	}

	.history {
		border-top: 1px solid var(--line);
		padding-top: 8px;
	}

	.history h3 {
		margin: 0 0 5px;
		font-size: 9.5px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
		font-weight: 600;
	}

	.history ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.history li {
		display: grid;
		grid-template-columns: 22px minmax(0, 1fr) auto;
		gap: 5px;
		align-items: baseline;
		font-size: 10px;
		color: var(--muted);
	}

	.a-time {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		opacity: 0.6;
	}

	.a-expr code {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: #cfe0f4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		display: inline-block;
		max-width: 100%;
		vertical-align: bottom;
	}

	.a-result {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.a-result.hit {
		color: var(--attack);
	}

	.eliminated {
		color: var(--muted);
		font-size: 12px;
	}

	.arena {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		min-height: 0;
	}

	.arena-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		min-height: 18px;
		font-size: 10px;
		color: var(--muted);
		flex-wrap: wrap;
	}

	.summary {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		align-items: center;
	}

	.mode-chip {
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 1px 5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		font-size: 9px;
		color: var(--text);
	}

	.online {
		color: var(--success);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 9px;
	}

	.conn {
		color: var(--attack);
	}

	.canvas-wrap {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
		overflow: auto;
	}

	.rules {
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--panel);
		padding: 8px 10px;
		font-size: 11px;
		color: var(--muted);
	}

	.rules summary {
		cursor: pointer;
		font-size: 10px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.rules dl {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 3px 8px;
		margin: 8px 0 0;
	}

	.rules dt {
		color: var(--muted);
	}

	.rules dd {
		margin: 0;
		text-align: right;
		color: var(--text);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 10px;
	}

	.exit {
		margin-top: 10px;
		width: 100%;
		background: transparent;
		border: 1px solid var(--line);
		color: var(--danger);
		border-radius: 6px;
		padding: 5px;
		font-size: 10.5px;
		cursor: pointer;
	}

	.exit:hover {
		border-color: var(--danger);
	}

	@media (max-width: 1240px) {
		.game {
			grid-template-columns: 290px minmax(0, 1fr);
			grid-template-areas:
				'console arena'
				'info info';
			height: auto;
		}
		.console {
			grid-area: console;
			max-height: 72vh;
		}
		.arena {
			grid-area: arena;
			min-height: 58vh;
		}
		.info {
			grid-area: info;
			flex-direction: row;
			flex-wrap: wrap;
		}
		.info > :global(*) {
			flex: 1 1 260px;
		}
	}

	@media (max-width: 820px) {
		.game {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'arena'
				'console'
				'info';
			padding: 8px;
			gap: 8px;
		}
		.arena {
			min-height: 52vh;
		}
		.console {
			max-height: none;
		}
		.info {
			flex-direction: column;
		}
	}
</style>
