<script lang="ts">
	import type {
		AttackComponentInput,
		GameRules,
		Grapher,
		ValidationIssue
	} from '$lib/game/types';
	import { prepareAttack, countRootsForPreview } from '$lib/math/validation';
	import { frameForGrapher } from '$lib/math/transforms';
	import type { CurveSegments } from '$lib/math/geometry';
	import { GRAPHER_TYPE_ACCENT } from '$lib/ui/theme';
	import { GRAPHER_GLYPH } from '$lib/ui/theme';

	let {
		rules,
		grapher,
		disabled = false,
		disabledReason = '',
		onSubmit,
		onPreview
	}: {
		rules: GameRules;
		grapher: Grapher;
		disabled?: boolean;
		disabledReason?: string;
		onSubmit: (components: AttackComponentInput[]) => boolean;
		onPreview: (segments: CurveSegments) => void;
	} = $props();

	interface ArcDraft {
		cx: string;
		cy: string;
		radius: string;
		start: string;
		sweep: string;
	}

	interface Draft {
		functions: string[];
		arc: ArcDraft;
	}

	const defaultArc = (): ArcDraft => ({
		cx: '0',
		cy: '0',
		radius: '5',
		start: '0',
		sweep: '90'
	});

	const cache: Record<string, Draft> = {};
	let lastType = grapher.type;
	let functions = $state<string[]>(['']);
	let arc = $state<ArcDraft>(defaultArc());
	let issues = $state<ValidationIssue[]>([]);
	let rootCounts = $state<number[]>([]);
	let validComponents = $state<AttackComponentInput[]>([]);
	let canSubmit = $derived(!disabled && issues.length === 0 && validComponents.length > 0);

	const def = $derived(rules.grapherTypes[grapher.type]);
	const windowSpan = $derived(def.domainRangeSpan);
	const maxFunctions = $derived(def.attackMode === 'multi-function' ? (def.maxFunctions ?? 1) : 1);
	const totalRoots = $derived(rootCounts.reduce((sum, n) => sum + n, 0));

	$effect(() => {
		// Swap drafts when the selected grapher type changes.
		if (grapher.type === lastType) return;
		cache[lastType] = { functions: [...functions], arc: { ...arc } };
		const restored = cache[grapher.type];
		functions = restored ? [...restored.functions] : [''];
		arc = restored ? { ...restored.arc } : defaultArc();
		lastType = grapher.type;
	});

	function buildComponents(): { components: AttackComponentInput[]; structural: ValidationIssue[] } {
		const structural: ValidationIssue[] = [];
		if (def.attackMode === 'arc') {
			const cx = Number(arc.cx);
			const cy = Number(arc.cy);
			const radius = Number(arc.radius);
			const start = Number(arc.start);
			const sweep = Number(arc.sweep);
			if ([cx, cy, radius, start, sweep].some((n) => !Number.isFinite(n))) {
				structural.push({
					code: 'arc-number',
					message: 'Every arc field must be a number.',
					componentIndex: 0
				});
				return { components: [], structural };
			}
			return {
				components: [
					{
						kind: 'arc',
						center: { x: cx, y: cy },
						radius,
						startAngleDeg: start,
						sweepAngleDeg: sweep
					}
				],
				structural
			};
		}
		const filled = functions.filter((f) => f.trim().length > 0);
		if (filled.length === 0) {
			structural.push({ code: 'empty', message: 'Enter an expression.', componentIndex: 0 });
			return { components: [], structural };
		}
		return {
			components: filled.slice(0, maxFunctions).map((expression) => ({
				kind: 'function' as const,
				expression
			})),
			structural
		};
	}

	$effect(() => {
		// Read every draft field explicitly: reading only the array reference would
		// not track element edits made through bind:value.
		void [
			functions.length,
			...functions,
			arc.cx,
			arc.cy,
			arc.radius,
			arc.start,
			arc.sweep,
			rules,
			grapher.id,
			grapher.type,
			grapher.rotation,
			grapher.position.x,
			grapher.position.y
		];
		const timer = setTimeout(() => evaluate(), 140);
		return () => clearTimeout(timer);
	});

	function evaluate(): void {
		const { components, structural } = buildComponents();
		validComponents = components;
		if (structural.length > 0) {
			issues = structural;
			rootCounts = [];
			onPreview([]);
			return;
		}
		const frame = frameForGrapher(grapher, rules);
		const prepared = prepareAttack(rules, grapher.type, frame, components);
		if (prepared.ok) {
			issues = [];
			onPreview(prepared.components.flatMap((c) => c.world));
		} else {
			issues = prepared.issues;
			// Even an invalid attack can preview the parts that did resolve; show
			// nothing rather than a misleading partial curve.
			onPreview([]);
		}
		rootCounts = components.map((component) => {
			if (component.kind !== 'function') return 0;
			const preview = countRootsForPreview(rules, grapher.type, component.expression);
			return preview.ok ? preview.count : 0;
		});
	}

	function submit(): void {
		if (!canSubmit) return;
		const ok = onSubmit(validComponents);
		if (ok) {
			if (def.attackMode !== 'arc') functions = [''];
		}
	}

	function handleKey(event: KeyboardEvent): void {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			event.preventDefault();
			submit();
		}
	}

	function addFunction(): void {
		if (functions.length >= maxFunctions) return;
		functions = [...functions, ''];
	}

	function removeFunction(index: number): void {
		if (functions.length <= 1) return;
		functions = functions.filter((_, i) => i !== index);
	}

	function useTemplate(expression: string): void {
		functions = [expression];
	}

	const perFunctionLimit = $derived(def.maxRoots);
	const budget = $derived(def.maxTotalRoots ?? def.maxRoots);

	function issueFor(index: number): ValidationIssue[] {
		return issues.filter((i) => i.componentIndex === index);
	}
</script>

<div class="editor" class:disabled>
	<header class="head">
		<span class="type-badge" style="--accent:{GRAPHER_TYPE_ACCENT[grapher.type]}">
			<span class="glyph">{GRAPHER_GLYPH[grapher.type]}</span>
			{def.label}
		</span>
		<span class="mode">{def.inputHint}</span>
	</header>

	{#if disabled}
		<div class="inactive" role="status">{disabledReason || 'Waiting…'}</div>
	{/if}

	{#if def.attackMode === 'arc'}
		<div class="arc-grid">
			<label>
				<span>centre x</span>
				<input type="number" step="0.125" bind:value={arc.cx} aria-label="Arc centre x" />
			</label>
			<label>
				<span>centre y</span>
				<input type="number" step="0.125" bind:value={arc.cy} aria-label="Arc centre y" />
			</label>
			<label>
				<span>radius</span>
				<input
					type="number"
					step="0.25"
					min="0"
					max={def.maxArcRadius}
					bind:value={arc.radius}
					aria-label="Arc radius"
				/>
			</label>
			<label>
				<span>start °</span>
				<input type="number" step="5" bind:value={arc.start} aria-label="Arc start angle in degrees" />
			</label>
			<label>
				<span>sweep °</span>
				<input
					type="number"
					step="5"
					min={-(def.maxArcSweepDegrees ?? 180)}
					max={def.maxArcSweepDegrees ?? 180}
					bind:value={arc.sweep}
					aria-label="Arc sweep angle in degrees"
				/>
			</label>
		</div>
		<p class="hint">True circular arc · radius ≤ {def.maxArcRadius} · |sweep| ≤ {def.maxArcSweepDegrees}° · angles counter-clockwise from the local +x axis</p>
	{:else}
		<div class="functions">
			{#each functions as _expression, index (index)}
				<div class="field">
					<span class="prefix">y =</span>
					<input
						class="expr"
						class:invalid={issueFor(index).length > 0}
						type="text"
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"
						bind:value={functions[index]}
						onkeydown={handleKey}
						placeholder={index === 0 ? 'e.g. 2*x + 3' : 'another function'}
						aria-label={`Function ${index + 1}`}
						disabled={disabled}
					/>
					{#if functions.length > 1}
						<button
							type="button"
							class="remove"
							onclick={() => removeFunction(index)}
							aria-label={`Remove function ${index + 1}`}
						>×</button>
					{/if}
				</div>
				<div class="roots">
					<span class="root-label">roots</span>
					<span class="root-count" class:over={(rootCounts[index] ?? 0) > perFunctionLimit}>
						{rootCounts[index] ?? 0} / {perFunctionLimit}
					</span>
					{#if def.attackMode === 'multi-function'}
						<span class="shared">
							shared {totalRoots} / {budget}
						</span>
					{/if}
				</div>
				{#each issueFor(index) as issue, issueIndex (issueIndex)}
					<p class="error">{issue.message}{issue.position !== undefined ? ` (at ${issue.position + 1})` : ''}</p>
				{/each}
			{/each}
		</div>
		{#if def.attackMode === 'multi-function'}
			<div class="spray-actions">
				<button type="button" class="ghost" onclick={addFunction} disabled={functions.length >= maxFunctions || disabled}>
					+ add function ({functions.length}/{maxFunctions})
				</button>
			</div>
		{/if}
		<div class="templates" aria-label="Insert a template">
			<button type="button" onclick={() => useTemplate('x^2 - 4')} disabled={disabled}>x² − 4</button>
			<button type="button" onclick={() => useTemplate('2*x + 3')} disabled={disabled}>2x + 3</button>
			<button type="button" onclick={() => useTemplate('3*sin(2*x)')} disabled={disabled}>3sin(2x)</button>
			<button type="button" onclick={() => useTemplate('(x^2 - 1)/(x + 2)')} disabled={disabled}>rational</button>
		</div>
	{/if}

	{#each issues.filter((i) => i.componentIndex === undefined) as issue, issueIndex (issueIndex)}
		<p class="error">{issue.message}</p>
	{/each}

	<div class="limits">
		<span>window ±{(windowSpan / 2).toFixed(1)}</span>
		{#if def.attackMode !== 'arc'}
			<span>max {perFunctionLimit} roots</span>
		{/if}
		{#if def.attackMode === 'multi-function'}
			<span>{budget} roots across all functions</span>
		{/if}
		<span>{rules.targetHitRadius.toFixed(1)} hit radius</span>
	</div>

	<div class="submit-row">
		<button type="button" class="fire" onclick={submit} disabled={!canSubmit}>
			Fire
			<kbd>⌘/Ctrl ↵</kbd>
		</button>
		<span class="turn-state">
			{#if disabled}
				Not accepting input
			{:else if issues.length > 0}
				Fix the highlighted issue to fire
			{:else}
				Ready to fire
			{/if}
		</span>
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}

	.type-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
		border-radius: 999px;
		font-size: 12px;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 10%, transparent);
	}

	.glyph {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 11px;
	}

	.mode {
		font-size: 11px;
		color: var(--muted);
	}

	.inactive {
		border: 1px dashed var(--line);
		border-radius: 7px;
		padding: 7px 10px;
		font-size: 12px;
		color: var(--muted);
		background: rgba(12, 19, 29, 0.6);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.prefix {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--muted);
		font-size: 13px;
	}

	input.expr,
	.arc-grid input {
		width: 100%;
		min-width: 0;
		background: #080d15;
		border: 1px solid var(--line);
		border-radius: 6px;
		color: var(--text);
		padding: 8px 9px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 13px;
		letter-spacing: 0.01em;
	}

	input.expr:focus,
	.arc-grid input:focus {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
	}

	input.invalid {
		border-color: color-mix(in srgb, var(--danger) 70%, transparent);
	}

	.remove {
		border: 1px solid var(--line);
		background: transparent;
		color: var(--muted);
		border-radius: 5px;
		width: 24px;
		height: 28px;
		cursor: pointer;
	}

	.roots {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		color: var(--muted);
		margin-top: 4px;
	}

	.root-count {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--text);
	}

	.root-count.over {
		color: var(--danger);
	}

	.shared {
		margin-left: auto;
		color: var(--violet);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.error {
		margin: 4px 0 0;
		font-size: 11px;
		color: var(--danger);
		line-height: 1.4;
	}

	.spray-actions {
		display: flex;
		gap: 6px;
	}

	button.ghost,
	.templates button {
		border: 1px solid var(--line);
		background: transparent;
		color: var(--muted);
		border-radius: 6px;
		padding: 5px 8px;
		font-size: 11px;
		cursor: pointer;
	}

	button.ghost:hover,
	.templates button:hover {
		color: var(--text);
		border-color: var(--muted);
	}

	.templates {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
	}

	.arc-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.arc-grid label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: var(--muted);
	}

	.hint {
		margin: 0;
		font-size: 11px;
		line-height: 1.5;
		color: var(--muted);
	}

	.limits {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: 10.5px;
		color: var(--muted);
		border-top: 1px solid var(--line);
		padding-top: 8px;
	}

	.limits span::before {
		content: '';
		display: inline-block;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--line);
		margin-right: 5px;
		vertical-align: middle;
	}

	.submit-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	button.fire {
		background: linear-gradient(180deg, #2b6f80, #17414e);
		border: 1px solid var(--accent);
		color: #eafcff;
		font-weight: 600;
		letter-spacing: 0.04em;
		padding: 9px 18px;
		border-radius: 7px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}

	button.fire:hover:not(:disabled) {
		background: linear-gradient(180deg, #34889d, #1b5060);
	}

	button.fire:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	button.fire kbd {
		font-family: inherit;
		font-size: 9px;
		font-weight: 400;
		opacity: 0.75;
		border: 1px solid rgba(255, 255, 255, 0.25);
		border-radius: 3px;
		padding: 1px 3px;
	}

	.turn-state {
		font-size: 11px;
		color: var(--muted);
	}

	.disabled {
		opacity: 0.92;
	}

</style>
