<script lang="ts">
	import type { MatchState } from '$lib/game/types';
	import { playerVisual } from '$lib/ui/theme';

	let {
		state,
		selfId,
		onRematch,
		onExit,
		online = false,
		canRematch = true
	}: {
		state: MatchState;
		selfId: string;
		onRematch: () => void;
		onExit: () => void;
		online?: boolean;
		canRematch?: boolean;
	} = $props();

	const winners = $derived(state.players.filter((p) => state.winnerIds.includes(p.id)));
	const isWinner = $derived(state.winnerIds.includes(selfId));
	const ranked = $derived(
		[...state.players].sort((a, b) => {
			if (state.winnerIds.includes(a.id) && !state.winnerIds.includes(b.id)) return -1;
			if (state.winnerIds.includes(b.id) && !state.winnerIds.includes(a.id)) return 1;
			return b.score - a.score;
		})
	);
	const durationSeconds = $derived(
		Math.max(0, ((state.stats.finishedAt ?? state.now) - state.stats.startedAt) / 1000)
	);

	function duration(): string {
		const total = Math.round(durationSeconds);
		const minutes = Math.floor(total / 60);
		return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
	}

	function accuracy(playerId: string): string {
		const player = state.players.find((p) => p.id === playerId);
		if (!player || player.shots === 0) return '—';
		return `${Math.round((player.hits / player.shots) * 100)}%`;
	}
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="results-title">
	<div class="card">
		<p class="eyebrow">{isWinner ? 'Victory' : 'Match complete'}</p>
		<h2 id="results-title">
			{#if winners.length > 0}
				{#each winners as winner, i (winner.id)}
					<span style="color:{playerVisual(winner.colorIndex).color}">{winner.name}</span>{i < winners.length - 1 ? ' & ' : ''}
				{/each}
				wins
			{:else}
				Draw
			{/if}
		</h2>
		<p class="sub">
			{duration()} · {state.stats.attacks} attacks · {state.stats.batchCount} batch{state.stats.batchCount === 1 ? '' : 'es'}
		</p>

		<table>
			<thead>
				<tr>
					<th scope="col">Player</th>
					<th scope="col">Score</th>
					<th scope="col">Hits</th>
					<th scope="col">Destroyed</th>
					<th scope="col">Accuracy</th>
					<th scope="col">Cover</th>
				</tr>
			</thead>
			<tbody>
				{#each ranked as player (player.id)}
					<tr class:winner={state.winnerIds.includes(player.id)} class:you={player.id === selfId}>
						<th scope="row">
							<span class="marker" style="color:{playerVisual(player.colorIndex).color}">{playerVisual(player.colorIndex).glyph}</span>
							{player.name}
							{#if player.id === selfId}<span class="tag">you</span>{/if}
							{#if player.kind === 'cpu'}<span class="tag">cpu</span>{/if}
						</th>
						<td>{player.score.toFixed(player.score % 1 === 0 ? 0 : 1)}</td>
						<td>{player.hits}</td>
						<td>{player.graphersDestroyed}</td>
						<td>{accuracy(player.id)}</td>
						<td>{player.obstacleSectionsDestroyed}</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<div class="actions">
			{#if canRematch}
				<button type="button" class="primary" onclick={onRematch}>{online ? 'Return to lobby' : 'Rematch'}</button>
			{/if}
			<button type="button" onclick={onExit}>Leave</button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: absolute;
		inset: 0;
		background: rgba(5, 8, 13, 0.82);
		backdrop-filter: blur(3px);
		display: grid;
		place-items: center;
		padding: 20px;
		z-index: 20;
	}

	.card {
		width: min(640px, 100%);
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 22px;
		box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
	}

	.eyebrow {
		margin: 0 0 4px;
		font-size: 10.5px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: var(--accent);
	}

	h2 {
		margin: 0;
		font-size: clamp(22px, 3.4vw, 30px);
		letter-spacing: -0.02em;
	}

	.sub {
		margin: 4px 0 16px;
		color: var(--muted);
		font-size: 11px;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}

	th,
	td {
		text-align: right;
		padding: 7px 6px;
		border-bottom: 1px solid var(--line);
		font-variant-numeric: tabular-nums;
	}

	thead th {
		font-size: 9.5px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		font-weight: 500;
	}

	tbody th {
		text-align: left;
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	tr.winner td,
	tr.winner th {
		color: var(--accent);
	}

	.marker {
		font-size: 10px;
	}

	.tag {
		font-size: 8px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border: 1px solid var(--line);
		border-radius: 3px;
		padding: 0 3px;
		color: var(--muted);
	}

	.actions {
		display: flex;
		gap: 8px;
		margin-top: 18px;
		justify-content: flex-end;
	}

	.actions button {
		border: 1px solid var(--line);
		background: var(--panel-raised);
		color: var(--text);
		padding: 8px 16px;
		border-radius: 7px;
		font-size: 12px;
		cursor: pointer;
	}

	.actions button.primary {
		border-color: var(--accent);
		background: linear-gradient(180deg, #2b6f80, #17414e);
	}

	.actions button:hover {
		filter: brightness(1.12);
	}

	@media (max-width: 560px) {
		table {
			font-size: 11px;
		}
		tbody th {
			flex-wrap: wrap;
		}
	}
</style>
