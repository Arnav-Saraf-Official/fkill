<script lang="ts">
	import type { MatchState } from '$lib/game/types';
	import { playerVisual } from '$lib/ui/theme';

	let { state, selfId, compact = false }: { state: MatchState; selfId: string; compact?: boolean } = $props();

	function aliveCount(playerId: string): number {
		return state.graphers.filter((g) => g.ownerId === playerId && g.alive).length;
	}
	function totalCount(playerId: string): number {
		return state.graphers.filter((g) => g.ownerId === playerId).length;
	}
	function healthTotal(playerId: string): number {
		return state.graphers
			.filter((g) => g.ownerId === playerId)
			.reduce((sum, g) => sum + Math.max(0, g.health), 0);
	}
	function healthMax(playerId: string): number {
		return state.graphers
			.filter((g) => g.ownerId === playerId)
			.reduce((sum, g) => sum + g.maxHealth, 0);
	}

	const ranked = $derived(
		[...state.players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
	);
</script>

<section class="players" aria-label="Players">
	<header>
		<h3>Players</h3>
		<span class="count">{state.players.filter((p) => p.alive).length} alive</span>
	</header>
	<ol>
		{#each ranked as player (player.id)}
			{@const visual = playerVisual(player.colorIndex)}
			{@const active = state.turn.activePlayerIds.includes(player.id)}
			<li class:dead={!player.alive} class:you={player.id === selfId} style="--c:{visual.color}">
				<span class="marker" aria-hidden="true">{visual.glyph}</span>
				<div class="body">
					<div class="line">
						<span class="name">{player.name}</span>
						{#if player.kind === 'cpu'}<span class="tag">CPU</span>{/if}
						{#if player.id === selfId}<span class="tag you-tag">you</span>{/if}
						{#if active}<span class="active" title="Active">active</span>{/if}
						{#if !player.connected}<span class="tag off">offline</span>{/if}
					</div>
					<div class="stats">
						<span class="score">{player.score.toFixed(player.score % 1 === 0 ? 0 : 1)} pts</span>
						<span>{aliveCount(player.id)}/{totalCount(player.id)} graphers</span>
						{#if !compact}
							<span>{healthTotal(player.id)}/{healthMax(player.id)} hp</span>
						{/if}
					</div>
					{#if !compact}
						<div class="bar" aria-hidden="true">
							<span
								style="width:{healthMax(player.id) > 0 ? (healthTotal(player.id) / healthMax(player.id)) * 100 : 0}%"
							></span>
						</div>
					{/if}
				</div>
			</li>
		{/each}
	</ol>
</section>

<style>
	.players {
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--panel);
		padding: 10px;
	}

	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 7px;
	}

	h3 {
		margin: 0;
		font-size: 10.5px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
		font-weight: 600;
	}

	.count {
		font-size: 10px;
		color: var(--muted);
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 240px;
		overflow: auto;
	}

	li {
		display: grid;
		grid-template-columns: 18px 1fr;
		gap: 7px;
		padding: 5px 6px;
		border-radius: 6px;
		border: 1px solid transparent;
	}

	li.you {
		border-color: color-mix(in srgb, var(--c) 30%, var(--line));
		background: color-mix(in srgb, var(--c) 5%, transparent);
	}

	li.dead {
		opacity: 0.45;
	}

	.marker {
		color: var(--c);
		font-size: 11px;
		line-height: 1.4;
	}

	.line {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
	}

	.name {
		font-size: 12px;
	}

	.tag {
		font-size: 8.5px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 1px 4px;
		border-radius: 3px;
		border: 1px solid var(--line);
		color: var(--muted);
	}

	.you-tag {
		color: var(--accent);
		border-color: color-mix(in srgb, var(--accent) 40%, transparent);
	}

	.off {
		color: var(--danger);
	}

	.active {
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--attack);
	}

	.stats {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 10px;
		color: var(--muted);
		margin-top: 1px;
		font-variant-numeric: tabular-nums;
	}

	.score {
		color: var(--text);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.bar {
		height: 2px;
		background: var(--line);
		margin-top: 4px;
		border-radius: 1px;
		overflow: hidden;
	}

	.bar > span {
		display: block;
		height: 100%;
		background: var(--c);
	}
</style>
