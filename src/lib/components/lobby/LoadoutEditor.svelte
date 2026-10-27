<script lang="ts">
	import type { GameRules, GrapherType } from '$lib/game/types';
	import { GRAPHER_TYPE_ORDER } from '$lib/game/rules';
	import { GRAPHER_GLYPH, GRAPHER_TYPE_ACCENT } from '$lib/ui/theme';

	let {
		loadout = $bindable([]),
		rules,
		disabled = false,
		onChange
	}: {
		loadout: GrapherType[];
		rules: GameRules;
		disabled?: boolean;
		onChange?: (loadout: GrapherType[]) => void;
	} = $props();

	const cap = $derived(Math.max(1, rules.maxGraphersPerPlayer));
	const overCap = $derived(loadout.length > cap);
	const full = $derived(loadout.length >= cap);
	const empty = $derived(loadout.length === 0);
	const locked = $derived(disabled || overCap);

	function defOf(type: GrapherType) {
		return rules.grapherTypes[type];
	}

	function facts(type: GrapherType): string {
		const def = defOf(type);
		if (def.attackMode === 'arc') {
			return `arc · radius ≤ ${def.maxArcRadius ?? '—'} · sweep ≤ ${def.maxArcSweepDegrees ?? '—'}°`;
		}
		if (def.attackMode === 'multi-function') {
			return `${def.maxFunctions ?? 1} fns · ${def.maxTotalRoots ?? def.maxRoots} roots · span ${def.domainRangeSpan}`;
		}
		return `${def.maxRoots} roots · span ${def.domainRangeSpan}`;
	}

	function tooltip(type: GrapherType): string {
		const def = defOf(type);
		return `${def.label}: ${def.description} Damage ${def.damageToGraphers} to graphers, ${def.damageToObstacles} to cover.`;
	}

	function commit(next: GrapherType[]): void {
		loadout = next;
		onChange?.(next);
	}

	function add(type: GrapherType): void {
		if (locked || full) return;
		commit([...loadout, type]);
	}

	function remove(index: number): void {
		if (locked || loadout.length <= 1) return;
		commit(loadout.filter((_, i) => i !== index));
	}

	function fill(): void {
		if (locked || full) return;
		const next = [...loadout];
		let cursor = 0;
		while (next.length < cap) {
			next.push(GRAPHER_TYPE_ORDER[cursor % GRAPHER_TYPE_ORDER.length]);
			cursor++;
		}
		commit(next);
	}

	function clear(): void {
		if (locked) return;
		commit(['basic']);
	}

	function trim(): void {
		const next = loadout.slice(0, cap);
		commit(next.length > 0 ? next : ['basic']);
	}
</script>

<div class="loadout">
	<div class="head">
		<span class="title">Loadout</span>
		<span class="count" class:over={overCap} class:empty>
			{loadout.length} / {cap} graphers
		</span>
	</div>

	{#if overCap}
		<div class="warn" role="status">
			This loadout has {loadout.length} graphers but the match allows {cap}.
			<button type="button" class="trim" onclick={trim}>Trim to {cap}</button>
		</div>
	{:else if empty}
		<div class="warn" role="status">
			At least one grapher is required. Add one below.
		</div>
	{/if}

	<ul class="slots" aria-label="Selected graphers">
		{#each loadout as type, index (index)}
			{@const def = defOf(type)}
			<li class="slot" style="--c:{GRAPHER_TYPE_ACCENT[type]}" title={tooltip(type)}>
				<span class="idx" aria-hidden="true">{index + 1}</span>
				<span class="glyph" aria-hidden="true">{GRAPHER_GLYPH[type]}</span>
				<span class="slot-text">
					<span class="slot-name">{def.label}</span>
					<span class="facts">{facts(type)}</span>
				</span>
				<span class="dmg" title="Damage to enemy graphers">−{def.damageToGraphers}</span>
				<button
					type="button"
					class="remove"
					disabled={locked || loadout.length <= 1}
					aria-label="Remove {def.label} at position {index + 1}"
					onclick={() => remove(index)}
				>
					×
				</button>
			</li>
		{/each}
	</ul>

	<div class="add-row" aria-label="Add a grapher">
		{#each GRAPHER_TYPE_ORDER as type (type)}
			{@const def = defOf(type)}
			<button
				type="button"
				class="add"
				style="--c:{GRAPHER_TYPE_ACCENT[type]}"
				disabled={locked || full}
				title={tooltip(type)}
				aria-label="Add {def.label} grapher"
				onclick={() => add(type)}
			>
				<span class="glyph" aria-hidden="true">{GRAPHER_GLYPH[type]}</span>
				<span>{def.label}</span>
				<span class="plus" aria-hidden="true">+</span>
			</button>
		{/each}
	</div>

	<div class="footer">
		<button type="button" class="aux" disabled={locked || full} onclick={fill}>Fill</button>
		<button
			type="button"
			class="aux"
			disabled={locked || (loadout.length === 1 && loadout[0] === 'basic')}
			onclick={clear}
		>
			Reset to Basic
		</button>
		{#if disabled}
			<span class="locked">Loadout locked</span>
		{/if}
	</div>
</div>

<style>
	.loadout {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.title {
		font-size: 9.5px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
		font-weight: 600;
	}

	.count {
		font-size: 10px;
		color: var(--muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.count.over {
		color: var(--danger);
	}

	.count.empty {
		color: var(--attack);
	}

	.warn {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		font-size: 10.5px;
		line-height: 1.4;
		color: #ffc6c6;
		background: rgba(255, 107, 107, 0.07);
		border: 1px solid rgba(255, 107, 107, 0.3);
		border-radius: 6px;
		padding: 5px 7px;
	}

	.trim {
		background: transparent;
		border: 1px solid rgba(255, 107, 107, 0.5);
		color: #ffd2d2;
		border-radius: 4px;
		padding: 2px 6px;
		font-size: 9.5px;
		cursor: pointer;
	}

	.slots {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.slot {
		display: grid;
		grid-template-columns: 16px 18px minmax(0, 1fr) auto 20px;
		align-items: center;
		gap: 5px;
		padding: 4px 5px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: linear-gradient(90deg, color-mix(in srgb, var(--c) 8%, transparent), transparent);
		min-width: 0;
	}

	.idx {
		font-size: 9px;
		color: var(--muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		text-align: right;
	}

	.glyph {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		color: var(--c);
		text-align: center;
	}

	.slot-text {
		display: flex;
		flex-direction: column;
		gap: 0;
		min-width: 0;
	}

	.slot-name {
		font-size: 11.5px;
		color: var(--text);
	}

	.facts {
		font-size: 9px;
		color: var(--muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.dmg {
		font-size: 9.5px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--attack);
	}

	.remove {
		width: 18px;
		height: 18px;
		line-height: 1;
		padding: 0;
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 4px;
		color: var(--muted);
		cursor: pointer;
		font-size: 12px;
	}

	.remove:hover:not(:disabled) {
		border-color: var(--danger);
		color: var(--danger);
	}

	.remove:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.add-row {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 3px;
	}

	.add {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 4px 2px;
		background: var(--panel-raised);
		border: 1px solid var(--line);
		border-radius: 5px;
		color: var(--text);
		font-size: 9px;
		cursor: pointer;
		min-width: 0;
	}

	.add .glyph {
		font-size: 11px;
	}

	.add .plus {
		font-size: 9px;
		color: var(--muted);
	}

	.add:hover:not(:disabled) {
		border-color: var(--c);
	}

	.add:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.footer {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-wrap: wrap;
	}

	.aux {
		background: transparent;
		border: 1px solid var(--line);
		border-radius: 4px;
		color: var(--muted);
		padding: 2px 7px;
		font-size: 9.5px;
		cursor: pointer;
	}

	.aux:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--muted);
	}

	.aux:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.locked {
		margin-left: auto;
		font-size: 9px;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
</style>
