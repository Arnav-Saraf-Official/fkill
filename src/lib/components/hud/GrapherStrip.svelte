<script lang="ts">
	import type { MatchState } from '$lib/game/types';
	import { cooldownApplies, cooldownDurationMs } from '$lib/game/rules';
	import { playerVisual, GRAPHER_TYPE_ACCENT, GRAPHER_GLYPH } from '$lib/ui/theme';

	let {
		state,
		selfId,
		selectedId = null,
		now,
		onSelect,
		disabled = false
	}: {
		state: MatchState;
		selfId: string;
		selectedId?: string | null;
		now: number;
		onSelect: (grapherId: string) => void;
		disabled?: boolean;
	} = $props();

	const player = $derived(state.players.find((p) => p.id === selfId));
	const visual = $derived(playerVisual(player?.colorIndex ?? 0));
	const graphers = $derived(state.graphers.filter((g) => g.ownerId === selfId));
	const manual = $derived(state.rules.selection === 'manual');
	const cooldownMs = $derived(cooldownDurationMs(state.rules));

	function remaining(until: number | null): number {
		if (until === null) return 0;
		return Math.max(0, until - now);
	}

	function label(type: string): string {
		return state.rules.grapherTypes[type as keyof typeof state.rules.grapherTypes]?.label ?? type;
	}
</script>

<div class="strip" style="--own:{visual.color}">
	{#each graphers as grapher, index (grapher.id)}
		{@const cooled = remaining(grapher.cooldownUntil)}
		{@const ready = grapher.alive && (cooled === 0 || !manual || !cooldownApplies(state.rules))}
		{@const selected = manual ? grapher.id === selectedId : false}
		<button
			type="button"
			class="chip"
			class:selected
			class:down={!grapher.alive}
			disabled={disabled || !ready || !manual}
			title={!grapher.alive
				? 'Destroyed'
				: cooled > 0
					? `Cooling down for ${(cooled / 1000).toFixed(1)}s`
					: `${label(grapher.type)} — ${grapher.health}/${grapher.maxHealth} health`}
			aria-pressed={selected}
			onclick={() => onSelect(grapher.id)}
		>
			<span class="glyph" style="color:{GRAPHER_TYPE_ACCENT[grapher.type]}">{GRAPHER_GLYPH[grapher.type]}</span>
			<span class="text">
				<span class="name">{label(grapher.type)} <span class="index">#{index + 1}</span></span>
				<span class="meta">
					{#if !grapher.alive}
						destroyed
					{:else if cooled > 0 && manual}
						cooldown {(cooled / 1000).toFixed(1)}s
					{:else}
						{grapher.health}/{grapher.maxHealth} hp
					{/if}
				</span>
			</span>
			{#if cooled > 0 && manual && cooldownMs > 0}
				<span class="cooldown-bar" aria-hidden="true">
					<span style="width:{(cooled / cooldownMs) * 100}%"></span>
				</span>
			{/if}
		</button>
	{/each}
</div>

{#if !manual}
	<p class="auto">
		Automatic selection ({state.rules.selection === 'auto-random' ? 'random' : 'round robin'}) chooses the firing grapher. Cooldowns are disabled.
	</p>
{/if}

<style>
	.strip {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.chip {
		display: grid;
		grid-template-columns: 26px 1fr;
		align-items: center;
		gap: 8px;
		text-align: left;
		padding: 6px 8px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--own) 8%, transparent), transparent);
		border: 1px solid var(--line);
		border-radius: 7px;
		color: var(--text);
		cursor: pointer;
		position: relative;
		overflow: hidden;
	}

	.chip:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--own) 55%, var(--line));
	}

	.chip.selected {
		border-color: var(--own);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--own) 45%, transparent) inset;
	}

	.chip.down {
		opacity: 0.42;
		cursor: not-allowed;
	}

	.chip:disabled {
		cursor: not-allowed;
	}

	.glyph {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 13px;
		text-align: center;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.name {
		font-size: 12px;
		display: flex;
		gap: 5px;
	}

	.index {
		color: var(--muted);
		font-size: 10px;
	}

	.meta {
		font-size: 10px;
		color: var(--muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.cooldown-bar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		width: 100%;
		background: var(--line);
	}

	.cooldown-bar > span {
		display: block;
		height: 100%;
		background: var(--attack);
	}

	.auto {
		margin: 6px 0 0;
		font-size: 10.5px;
		line-height: 1.45;
		color: var(--muted);
	}
</style>
