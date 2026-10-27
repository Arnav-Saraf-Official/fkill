<script lang="ts">
	import type { MatchState } from '$lib/game/types';
	import { playerVisual } from '$lib/ui/theme';

	let {
		state,
		selfId,
		now,
		onPass,
		busy = false
	}: {
		state: MatchState;
		selfId: string;
		now: number;
		onPass: () => void;
		busy?: boolean;
	} = $props();

	const active = $derived(
		state.turn.activePlayerIds
			.map((id) => state.players.find((p) => p.id === id))
			.filter((p): p is NonNullable<typeof p> => Boolean(p))
	);
	const isMine = $derived(state.turn.mode === 'ffa' ? true : state.turn.activePlayerIds.includes(selfId));
	const remaining = $derived(state.turn.endsAt === null ? null : Math.max(0, state.turn.endsAt - now));
	const total = $derived(Math.max(1, state.rules.turns.timePerTurnSeconds * 1000));
	const ratio = $derived(remaining === null ? 0 : remaining / total);
	const urgent = $derived(remaining !== null && remaining <= 10_000);

	function clock(ms: number): string {
		const totalSeconds = Math.ceil(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;
	}
</script>

<section class="turn" aria-label="Turn status">
	<div class="top">
		<span class="phase">{state.turn.mode === 'ffa' ? 'Free-for-all' : `Batch ${state.turn.batchNumber}`}</span>
		{#if remaining !== null}
			<span class="timer" class:urgent>{clock(remaining)}</span>
		{/if}
	</div>

	<div class="who">
		{#if active.length === 0}
			<span class="muted">No active players</span>
		{:else}
			{#each active as player (player.id)}
				{@const visual = playerVisual(player.colorIndex)}
				<span class="pill" style="--c:{visual.color}" class:you={player.id === selfId}>
					<span class="dot" aria-hidden="true">{visual.glyph}</span>
					{player.name}{player.id === selfId ? ' (you)' : ''}
				</span>
			{/each}
		{/if}
	</div>

	{#if state.turn.mode === 'ffa'}
		<p class="note">Every surviving player may fire at any time. Cooldowns are the only rate limit.</p>
	{:else}
		<div class="bar" aria-hidden="true">
			<span style="width:{Math.min(100, Math.max(0, ratio * 100))}%"></span>
		</div>
		<div class="actions">
			<span class="status" aria-live="polite">
				{#if isMine}
					Your turn — construct an attack.
				{:else}
					Waiting for {active.map((p) => p.name).join(', ') || 'the next batch'}.
				{/if}
			</span>
			<button type="button" onclick={onPass} disabled={!isMine || busy}>Pass</button>
		</div>
	{/if}
</section>

<style>
	.turn {
		border: 1px solid var(--line);
		border-radius: 9px;
		background: var(--panel);
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.top {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}

	.phase {
		font-size: 10.5px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.timer {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 18px;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.timer.urgent {
		color: var(--danger);
	}

	.who {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		padding: 3px 7px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--c) 45%, var(--line));
		color: var(--text);
		background: color-mix(in srgb, var(--c) 8%, transparent);
	}

	.pill.you {
		border-color: var(--c);
	}

	.dot {
		color: var(--c);
		font-size: 10px;
	}

	.bar {
		height: 3px;
		background: var(--line);
		border-radius: 2px;
		overflow: hidden;
	}

	.bar > span {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, var(--accent), #7ad8ff);
		transition: width 160ms linear;
	}

	.muted {
		color: var(--muted);
		font-size: 11px;
	}

	.note {
		margin: 0;
		font-size: 10.5px;
		line-height: 1.45;
		color: var(--muted);
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.status {
		font-size: 11px;
		color: var(--muted);
	}

	.actions button {
		border: 1px solid var(--line);
		background: var(--panel-raised);
		color: var(--text);
		border-radius: 6px;
		padding: 5px 12px;
		font-size: 11px;
		cursor: pointer;
	}

	.actions button:hover:not(:disabled) {
		border-color: var(--muted);
	}

	.actions button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
