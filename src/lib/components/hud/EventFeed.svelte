<script lang="ts">
	import type { MatchState } from '$lib/game/types';
	import { playerVisual } from '$lib/ui/theme';

	let { state, limit = 16 }: { state: MatchState; limit?: number } = $props();

	const events = $derived([...state.events].slice(-limit).reverse());

	function colorFor(playerId: string | undefined): string | null {
		if (!playerId) return null;
		const player = state.players.find((p) => p.id === playerId);
		return player ? playerVisual(player.colorIndex).color : null;
	}

	function timeOf(at: number): string {
		const elapsed = Math.max(0, at - state.stats.startedAt);
		const seconds = Math.floor(elapsed / 1000);
		const minutes = Math.floor(seconds / 60);
		return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
	}

	const typeLabel: Record<string, string> = {
		'attack-accepted': 'attack',
		'attack-rejected': 'rejected',
		'grapher-destroyed': 'destroyed',
		'player-eliminated': 'eliminated',
		'obstacle-destroyed': 'cover',
		'player-disconnected': 'network',
		'player-reconnected': 'network',
		'player-left': 'left'
	};
</script>

<section class="feed" aria-label="Match log">
	<header>
		<h3>Event log</h3>
		<span>{state.stats.attacks} attacks</span>
	</header>
	<ol aria-live="polite">
		{#each events as event (event.id)}
			{@const color = colorFor(event.playerId)}
			<li class={event.type}>
				<span class="time">{timeOf(event.at)}</span>
				<span class="kind" style={color ? `color:${color}` : ''}>{typeLabel[event.type] ?? event.type}</span>
				<span class="message">{event.message}</span>
			</li>
		{/each}
	</ol>
</section>

<style>
	.feed {
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--panel);
		padding: 10px;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 6px;
	}

	h3 {
		margin: 0;
		font-size: 10.5px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
		font-weight: 600;
	}

	header span {
		font-size: 10px;
		color: var(--muted);
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow: auto;
		max-height: 220px;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	li {
		display: grid;
		grid-template-columns: 34px 58px 1fr;
		gap: 6px;
		font-size: 10.5px;
		line-height: 1.45;
		color: var(--muted);
		border-bottom: 1px solid rgba(30, 43, 61, 0.4);
		padding-bottom: 4px;
	}

	li:last-child {
		border-bottom: none;
	}

	.time {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: rgba(147, 164, 188, 0.6);
	}

	.kind {
		text-transform: uppercase;
		font-size: 8.5px;
		letter-spacing: 0.06em;
		color: var(--muted);
		padding-top: 1px;
	}

	.message {
		color: var(--text);
		opacity: 0.86;
	}

	.attack-accepted .message {
		color: #d9e8f8;
	}

	.grapher-destroyed .message,
	.player-eliminated .message {
		color: #ffb3b3;
	}

	.attack-rejected .message {
		color: #ffc98a;
	}

	.obstacle-destroyed .message {
		color: #bfc9ff;
	}

	.match-finished .message {
		color: var(--success);
	}
</style>
