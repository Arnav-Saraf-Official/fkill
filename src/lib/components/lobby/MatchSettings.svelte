<script lang="ts">
	import type {
		GameRules,
		GrapherType,
		GrapherTypeDefinition,
		ObstacleArrangement,
		SelectionMode,
		SchedulingMode,
		CoordinateMode,
		PlacementMode,
		AutoPlacementDistribution
	} from '$lib/game/types';
	import { DEFAULT_RULES, GRAPHER_TYPE_ORDER, LIMITS } from '$lib/game/rules';

	let {
		rules = $bindable(),
		playerCount = 2,
		locked = false,
		online = false,
		onChange
	}: {
		rules: GameRules;
		playerCount?: number;
		locked?: boolean;
		online?: boolean;
		onChange?: (rules: GameRules) => void;
	} = $props();

	interface NumOpts {
		label: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		unit?: string;
		hint?: string;
		integer?: boolean;
		off?: boolean;
		set: (value: number) => void;
	}

	function commit(next: GameRules): void {
		if (locked) return;
		rules = next;
		onChange?.(next);
	}

	function patch<K extends keyof GameRules>(key: K, value: GameRules[K]): void {
		commit({ ...rules, [key]: value });
	}

	function patchTurns(p: Partial<GameRules['turns']>): void {
		commit({ ...rules, turns: { ...rules.turns, ...p } });
	}

	function patchCoordinates(p: Partial<GameRules['coordinates']>): void {
		commit({ ...rules, coordinates: { ...rules.coordinates, ...p } });
	}

	function patchPrecision(p: Partial<GameRules['precision']>): void {
		commit({ ...rules, precision: { ...rules.precision, ...p } });
	}

	function patchScoring(p: Partial<GameRules['scoring']>): void {
		commit({ ...rules, scoring: { ...rules.scoring, ...p } });
	}

	function patchObstacles(p: Partial<GameRules['obstacles']>): void {
		commit({ ...rules, obstacles: { ...rules.obstacles, ...p } });
	}

	function patchPlacement(p: Partial<GameRules['placement']>): void {
		commit({ ...rules, placement: { ...rules.placement, ...p } });
	}

	function patchLimits(p: Partial<GameRules['limits']>): void {
		commit({ ...rules, limits: { ...rules.limits, ...p } });
	}

	function patchType(type: GrapherType, p: Partial<GrapherTypeDefinition>): void {
		commit({
			...rules,
			grapherTypes: {
				...rules.grapherTypes,
				[type]: { ...rules.grapherTypes[type], ...p }
			}
		});
	}

	function reset(): void {
		commit(structuredClone(DEFAULT_RULES));
	}

	const ffa = $derived(rules.turns.mode === 'ffa');
	const autoSelection = $derived(rules.selection !== 'manual');
	const localPlane = $derived(rules.coordinates.mode === 'local');
	const cloud = $derived(rules.cooldownMultiplier * rules.baseCooldownSeconds);
	const timeSeconds = $derived(rules.turns.timePerTurnSeconds);
	const customTime = $derived(timeSeconds > LIMITS.turnSecondsSliderMax);
	const modeLabel = $derived(
		rules.turns.mode === 'ffa'
			? 'Free-for-all'
			: rules.turns.mode === 'random'
				? 'Random scheduling'
				: 'Round robin'
	);
	const placementWarning = $derived(
		rules.obstacles.enabled && rules.obstacles.arrangement === 'none'
			? 'Obstacles are enabled but the arrangement is “none”: this configuration will be rejected.'
			: ''
	);

	function clock(seconds: number): string {
		const total = Math.round(seconds);
		const m = Math.floor(total / 60);
		const s = total % 60;
		return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
	}
</script>

{#snippet num(o: NumOpts)}
	<label class="num" class:off={o.off}>
		<span class="lab">{o.label}</span>
		<span class="entry">
			<input
				type="number"
				value={o.value}
				min={o.min}
				max={o.max}
				step={o.step ?? 1}
				disabled={locked || o.off}
				oninput={(event) => {
					const v = event.currentTarget.valueAsNumber;
					if (!Number.isFinite(v)) return;
					if (v < o.min || v > o.max) return;
					if (o.integer && !Number.isInteger(v)) return;
					o.set(v);
				}}
			/>
			{#if o.unit}<span class="unit">{o.unit}</span>{/if}
		</span>
		{#if o.hint}<span class="hint">{o.hint}</span>{/if}
	</label>
{/snippet}

<div class="settings" class:locked>
	<header class="head">
		<div class="summary">
			<span class="chip">{modeLabel}</span>
			<span>{playerCount} players</span>
			<span>{rules.maxGraphersPerPlayer} graphers each</span>
			<span>{rules.grapherHealth} HP</span>
			<span>{rules.coordinates.mode === 'shared' ? 'Shared plane' : 'Local planes'}</span>
		</div>
		<button type="button" class="reset" onclick={reset} disabled={locked}>Reset rules to defaults</button>
	</header>
	{#if locked}
		<p class="lock-note" role="status">
			Rules locked — this match is already running or you are not the host. Settings are read-only.
		</p>
	{/if}

	<details class="group" open>
		<summary>Gameplay &amp; scoring</summary>
		<div class="body">
			<div class="grid">
				{@render num({
					label: 'Graphers per player',
					value: rules.maxGraphersPerPlayer,
					min: LIMITS.graphersPerPlayer.min,
					max: LIMITS.graphersPerPlayer.max,
					integer: true,
					hint: '1–20. Caps every loadout.',
					set: (v) => patch('maxGraphersPerPlayer', v)
				})}
				{@render num({
					label: 'Health per grapher',
					value: rules.grapherHealth,
					min: LIMITS.health.min,
					max: LIMITS.health.max,
					integer: true,
					hint: '1 = one hit destroys. 20 = two full Sniper hits (10 dmg).',
					set: (v) => patch('grapherHealth', v)
				})}
				{@render num({
					label: 'Target hit radius',
					value: rules.targetHitRadius,
					min: LIMITS.hitRadius.min,
					max: LIMITS.hitRadius.max,
					step: 0.1,
					unit: 'u',
					hint: 'Real geometric radius in world units; never pixels.',
					set: (v) => patch('targetHitRadius', v)
				})}
				{@render num({
					label: 'Base hit points',
					value: rules.scoring.baseHitPoints,
					min: LIMITS.baseHitPoints.min,
					max: LIMITS.baseHitPoints.max,
					set: (v) => patchScoring({ baseHitPoints: v })
				})}
				{@render num({
					label: 'Precision bonus (max)',
					value: rules.scoring.precisionBonusMax,
					min: LIMITS.precisionBonusMax.min,
					max: LIMITS.precisionBonusMax.max,
					set: (v) => patchScoring({ precisionBonusMax: v })
				})}
				{@render num({
					label: 'Score rounding',
					value: rules.scoring.roundingDigits,
					min: LIMITS.roundingDigits.min,
					max: LIMITS.roundingDigits.max,
					integer: true,
					unit: 'dp',
					set: (v) => patchScoring({ roundingDigits: v })
				})}
			</div>
			<p class="formula">
				score = {rules.scoring.baseHitPoints} + {rules.scoring.precisionBonusMax} × (1 − d / R),
				rounded to {rules.scoring.roundingDigits} dp — d is the minimum distance from the target
				centre to the valid attack geometry, R the hit radius.
			</p>
		</div>
	</details>

	<details class="group" open>
		<summary>Grapher registry</summary>
		<div class="body">
			<p class="note">
				Every subsystem (editor, validator, combat, CPU, relay) reads this one registry. Damage is
				dealt by the attacking grapher's type. Spans are total widths centred on the local origin.
			</p>
			{#each GRAPHER_TYPE_ORDER as type (type)}
				{@const def = rules.grapherTypes[type]}
				<fieldset class="grapher">
					<legend>
						<span class="gname">{def.label}</span>
						<span class="gmode">{def.attackMode.replace('-', ' ')}</span>
					</legend>
					<div class="grid three">
						{@render num({
							label: 'Max roots',
							value: def.maxRoots,
							min: 0,
							max: 200,
							integer: true,
							set: (v) => patchType(type, { maxRoots: v })
						})}
						{@render num({
							label: 'Domain/range span',
							value: def.domainRangeSpan,
							min: 2,
							max: 60,
							step: 0.5,
							unit: 'u',
							hint: `valid X, Y: ±${def.domainRangeSpan / 2}`,
							set: (v) => patchType(type, { domainRangeSpan: v })
						})}
						{@render num({
							label: 'Damage → graphers',
							value: def.damageToGraphers,
							min: 0,
							max: 100,
							step: 0.5,
							set: (v) => patchType(type, { damageToGraphers: v })
						})}
						{@render num({
							label: 'Damage → cover',
							value: def.damageToObstacles,
							min: 0,
							max: 100,
							step: 0.5,
							set: (v) => patchType(type, { damageToObstacles: v })
						})}
						{#if def.attackMode === 'multi-function'}
							{@render num({
								label: 'Max functions',
								value: def.maxFunctions ?? 3,
								min: 1,
								max: 8,
								integer: true,
								set: (v) => patchType(type, { maxFunctions: v })
							})}
							{@render num({
								label: 'Total root budget',
								value: def.maxTotalRoots ?? 10,
								min: 1,
								max: 200,
								integer: true,
								hint: 'shared across all functions',
								set: (v) => patchType(type, { maxTotalRoots: v })
							})}
						{/if}
						{#if def.attackMode === 'arc'}
							{@render num({
								label: 'Max arc radius',
								value: def.maxArcRadius ?? 25,
								min: 0.5,
								max: 100,
								step: 0.5,
								unit: 'u',
								set: (v) => patchType(type, { maxArcRadius: v })
							})}
							{@render num({
								label: 'Max arc sweep',
								value: def.maxArcSweepDegrees ?? 180,
								min: 1,
								max: 360,
								unit: '°',
								set: (v) => patchType(type, { maxArcSweepDegrees: v })
							})}
						{/if}
					</div>
				</fieldset>
			{/each}
		</div>
	</details>

	<details class="group" open>
		<summary>Turn rules</summary>
		<div class="body">
			<div class="grid">
				<label class="field">
					<span class="lab">Scheduling</span>
					<select
						value={rules.turns.mode}
						disabled={locked}
						onchange={(e) => patchTurns({ mode: e.currentTarget.value as SchedulingMode })}
					>
						<option value="round-robin">Round robin</option>
						<option value="random">Random (without replacement per cycle)</option>
						<option value="ffa">Free-for-all</option>
					</select>
					<span class="hint">
						{#if ffa}
							No turn boundaries or timer; every active player may fire concurrently.
						{:else}
							Players act in batches. Everyone in the active batch acts concurrently.
						{/if}
					</span>
				</label>
				{@render num({
					label: 'Concurrent players',
					value: rules.turns.concurrentPlayers,
					min: LIMITS.concurrentPlayers.min,
					max: LIMITS.concurrentPlayers.max,
					integer: true,
					off: ffa,
					hint: ffa ? 'Not used in Free-for-All.' : 'Size of the active batch (X).',
					set: (v) => patchTurns({ concurrentPlayers: v })
				})}
				<label class="field">
					<span class="lab">Grapher selection</span>
					<select
						value={rules.selection}
						disabled={locked}
						onchange={(e) => patch('selection', e.currentTarget.value as SelectionMode)}
					>
						<option value="manual">Manual — player chooses</option>
						<option value="auto-round-robin">Automatic round robin</option>
						<option value="auto-random">Automatic random</option>
					</select>
					<span class="hint">
						{autoSelection
							? 'The game picks the firing grapher; its capabilities govern validation.'
							: 'The player picks any ready grapher.'}
					</span>
				</label>
				{@render num({
					label: 'Cooldown multiplier',
					value: rules.cooldownMultiplier,
					min: LIMITS.cooldownMultiplier.min,
					max: LIMITS.cooldownMultiplier.max,
					step: 0.25,
					off: autoSelection,
					unit: '×',
					hint: autoSelection
						? 'Disabled: automatic selection never uses cooldowns.'
						: `Base ${rules.baseCooldownSeconds}s → ${cloud.toFixed(2)}s per fired grapher. 0 disables cooldown.`,
					set: (v) => patch('cooldownMultiplier', v)
				})}
			</div>

			<div class="time-row">
				<label class="slider">
					<span class="lab">Time per turn</span>
					<input
						type="range"
						min="5"
						max={LIMITS.turnSecondsSliderMax}
						step="5"
						value={Math.min(LIMITS.turnSecondsSliderMax, timeSeconds)}
						disabled={locked || ffa}
						aria-valuetext={`${Math.min(LIMITS.turnSecondsSliderMax, timeSeconds)} seconds`}
						oninput={(e) => patchTurns({ timePerTurnSeconds: e.currentTarget.valueAsNumber })}
					/>
					<span class="range-ends"><span>5s</span><span>120s</span></span>
				</label>
				{@render num({
					label: 'Exact duration',
					value: timeSeconds,
					min: LIMITS.turnSeconds.min,
					max: LIMITS.turnSeconds.max,
					step: 1,
					unit: 's',
					off: ffa,
					hint: ffa ? 'No turn timer in Free-for-All.' : `Shown as ${clock(timeSeconds)}. Up to 1 hour.`,
					set: (v) => patchTurns({ timePerTurnSeconds: v })
				})}
			</div>
			{#if customTime && !ffa}
				<p class="custom" role="status">
					Custom duration: {timeSeconds}s ({clock(timeSeconds)}). The slider is clamped at its
					120s visual maximum; the real turn length is {timeSeconds}s.
				</p>
			{/if}
			{#if ffa}
				<p class="note">
					Free-for-All disables the turn timer and concurrent-batch setting. Submission order is
					the authoritative acceptance order, with flood protection under Advanced.
				</p>
			{/if}
		</div>
	</details>

	<details class="group" open>
		<summary>Coordinate plane</summary>
		<div class="body">
			<div class="grid">
				<label class="field">
					<span class="lab">Plane mode</span>
					<select
						value={rules.coordinates.mode}
						disabled={locked}
						onchange={(e) => patchCoordinates({ mode: e.currentTarget.value as CoordinateMode })}
					>
						<option value="shared">Shared world plane</option>
						<option value="local">Local plane per grapher</option>
					</select>
					<span class="hint">
						{rules.coordinates.mode === 'shared'
							? 'One world coordinate system for every player; equations use world axes.'
							: 'Each grapher has its own origin and optional rotation; equations transform into world space.'}
					</span>
				</label>
				{@render num({
					label: 'Visible grid spacing',
					value: rules.coordinates.gridSpacing,
					min: LIMITS.gridSpacing.min,
					max: LIMITS.gridSpacing.max,
					step: 0.25,
					unit: 'u',
					hint: 'Rendering only. Never changes accuracy or collisions.',
					set: (v) => patchCoordinates({ gridSpacing: v })
				})}
			</div>
			<div class="checks">
				<label class="check">
					<input
						type="checkbox"
						checked={rules.coordinates.allowRotation}
						disabled={locked || !localPlane}
						onchange={(e) => patchCoordinates({ allowRotation: e.currentTarget.checked })}
					/>
					Allow local-plane rotation
					<span class="hint">
						{localPlane
							? 'Players can rotate their firing grapher’s coordinate frame.'
							: 'Only available in local-plane mode.'}
					</span>
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={rules.coordinates.showAxes}
						disabled={locked}
						onchange={(e) => patchCoordinates({ showAxes: e.currentTarget.checked })}
					/>
					Show axes
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={rules.coordinates.showGrid}
						disabled={locked}
						onchange={(e) => patchCoordinates({ showGrid: e.currentTarget.checked })}
					/>
					Show grid
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={rules.coordinates.labels}
						disabled={locked}
						onchange={(e) => patchCoordinates({ labels: e.currentTarget.checked })}
					/>
					Axis labels
				</label>
			</div>
			<p class="note">
				The mathematical plane is always {rules.worldSize} × {rules.worldSize} units
				({-rules.worldSize / 2}…{rules.worldSize / 2} on both axes). Zoom and window size never
				change reach, validity or hitboxes.
			</p>
		</div>
	</details>

	<details class="group" open>
		<summary>Placement &amp; precision</summary>
		<div class="body">
			<div class="grid">
				<label class="field">
					<span class="lab">Placement</span>
					<select
						value={rules.placement.mode}
						disabled={locked || online}
						onchange={(e) => patchPlacement({ mode: e.currentTarget.value as PlacementMode })}
					>
						<option value="auto">Automatic</option>
						<option value="manual">Player-controlled</option>
					</select>
					<span class="hint">
						{online
							? 'Online rooms use automatic placement.'
							: rules.placement.mode === 'manual'
								? 'Players place graphers on the graph during setup.'
								: 'Generated from the seed, obeying bounds, precision and separation.'}
					</span>
				</label>
				<label class="field">
					<span class="lab">Distribution</span>
					<select
						value={rules.placement.distribution}
						disabled={locked || rules.placement.mode !== 'auto'}
						onchange={(e) =>
							patchPlacement({ distribution: e.currentTarget.value as AutoPlacementDistribution })}
					>
						<option value="uniform">Uniform random</option>
						<option value="even">Evenly spread</option>
						<option value="clustered">Clustered</option>
						<option value="min-separation">Random, minimum separation</option>
					</select>
					<span class="hint">Seeded and reproducible for debugging and replays.</span>
				</label>
				{@render num({
					label: 'Minimum separation',
					value: rules.placement.minSeparation,
					min: LIMITS.placementSeparation.min,
					max: LIMITS.placementSeparation.max,
					step: 0.5,
					unit: 'u',
					off: rules.placement.mode !== 'auto',
					hint: 'Centre-to-centre target distance.',
					set: (v) => patchPlacement({ minSeparation: v })
				})}
				{@render num({
					label: 'Placement precision',
					value: rules.precision.denominator,
					min: LIMITS.precisionDenominator.min,
					max: LIMITS.precisionDenominator.max,
					integer: true,
					unit: '1/N',
					hint: `Positions snap to multiples of ${(1 / rules.precision.denominator).toFixed(5)} units.`,
					set: (v) => patchPrecision({ denominator: v })
				})}
			</div>
			<div class="checks">
				<label class="check">
					<input
						type="checkbox"
						checked={rules.precision.showCoordinates}
						disabled={locked}
						onchange={(e) => patchPrecision({ showCoordinates: e.currentTarget.checked })}
					/>
					Reveal exact coordinates
					<span class="hint">
						{ rules.precision.showCoordinates
							? 'Player and grapher coordinates are shown exactly.'
							: 'Coordinates are hidden; players estimate positions from the graph. Markers stay visible.'}
					</span>
				</label>
			</div>
			<p class="precision-note">
				Placement precision: 1/{rules.precision.denominator} unit · Visible grid:
				{rules.coordinates.gridSpacing} unit · Exact coordinates:
				{rules.precision.showCoordinates ? 'shown' : 'hidden'}
			</p>
			<p class="note">
				Precision controls legal placements and the simulation. Grid spacing only controls how fine
				the drawing looks — a coarse grid never lowers mathematical accuracy.
			</p>
		</div>
	</details>

	<details class="group" open>
		<summary>Obstacles</summary>
		<div class="body">
			<div class="checks">
				<label class="check">
					<input
						type="checkbox"
						checked={rules.obstacles.enabled}
						disabled={locked}
						onchange={(e) => patchObstacles({ enabled: e.currentTarget.checked })}
					/>
					Enable obstacles
					<span class="hint">Cover occludes attacks and can be destroyed section by section.</span>
				</label>
			</div>
			<div class="grid">
				<label class="field">
					<span class="lab">Arrangement</span>
					<select
						value={rules.obstacles.arrangement}
						disabled={locked || !rules.obstacles.enabled}
						onchange={(e) =>
							patchObstacles({ arrangement: e.currentTarget.value as ObstacleArrangement })}
					>
						<option value="none">None</option>
						<option value="scattered">Scattered</option>
						<option value="corridor">Corridor</option>
						<option value="fortress">Fortress</option>
						<option value="random">Random shapes</option>
					</select>
				</label>
				{@render num({
					label: 'Count',
					value: rules.obstacles.count,
					min: LIMITS.obstacleCount.min,
					max: LIMITS.obstacleCount.max,
					integer: true,
					off: !rules.obstacles.enabled,
					set: (v) => patchObstacles({ count: v })
				})}
				{@render num({
					label: 'Minimum size',
					value: rules.obstacles.minSize,
					min: LIMITS.obstacleSize.min,
					max: LIMITS.obstacleSize.max,
					step: 0.5,
					unit: 'u',
					off: !rules.obstacles.enabled,
					set: (v) => patchObstacles({ minSize: v })
				})}
				{@render num({
					label: 'Maximum size',
					value: rules.obstacles.maxSize,
					min: LIMITS.obstacleSize.min,
					max: LIMITS.obstacleSize.max,
					step: 0.5,
					unit: 'u',
					off: !rules.obstacles.enabled,
					set: (v) => patchObstacles({ maxSize: v })
				})}
				{@render num({
					label: 'Durability per section',
					value: rules.obstacles.durability,
					min: LIMITS.obstacleDurability.min,
					max: LIMITS.obstacleDurability.max,
					integer: true,
					unit: 'dmg',
					off: !rules.obstacles.enabled || rules.obstacles.indestructible,
					hint: rules.obstacles.indestructible
						? 'Indestructible cover ignores durability.'
						: 'Damage points one section absorbs before it opens a gap.',
					set: (v) => patchObstacles({ durability: v })
				})}
				{@render num({
					label: 'Section size',
					value: rules.obstacles.sectionSize,
					min: LIMITS.obstacleSectionSize.min,
					max: LIMITS.obstacleSectionSize.max,
					step: 0.25,
					unit: 'u',
					off: !rules.obstacles.enabled,
					hint: 'Spatial grid used for local damage.',
					set: (v) => patchObstacles({ sectionSize: v })
				})}
			</div>
			<div class="checks">
				<label class="check">
					<input
						type="checkbox"
						checked={rules.obstacles.indestructible}
						disabled={locked || !rules.obstacles.enabled}
						onchange={(e) => patchObstacles({ indestructible: e.currentTarget.checked })}
					/>
					Indestructible cover
				</label>
				<label class="check">
					<input
						type="checkbox"
						checked={rules.obstacles.punchThrough}
						disabled={locked || !rules.obstacles.enabled}
						onchange={(e) => patchObstacles({ punchThrough: e.currentTarget.checked })}
					/>
					Punch through
					<span class="hint">
						If off, a section destroyed by a shot still blocks that shot; the gap helps later
						attacks.
					</span>
				</label>
			</div>
			{#if placementWarning}
				<p class="warn" role="alert">{placementWarning}</p>
			{/if}
		</div>
	</details>

	<details class="group">
		<summary>Advanced &amp; safety limits</summary>
		<div class="body">
			<p class="note">
				Hard bounds on parser and numerical work. They apply to humans, CPUs and the authoritative
				relay. FFA flood protection is separate from ordinary turn rules.
			</p>
			<div class="grid three">
				{@render num({
					label: 'Max expression length',
					value: rules.limits.maxExpressionLength,
					min: LIMITS.maxExpressionLength.min,
					max: LIMITS.maxExpressionLength.max,
					integer: true,
					unit: 'chars',
					set: (v) => patchLimits({ maxExpressionLength: v })
				})}
				{@render num({
					label: 'Max AST nodes',
					value: rules.limits.maxAstNodes,
					min: 16,
					max: 512,
					integer: true,
					set: (v) => patchLimits({ maxAstNodes: v })
				})}
				{@render num({
					label: 'Max AST depth',
					value: rules.limits.maxAstDepth,
					min: 4,
					max: 64,
					integer: true,
					set: (v) => patchLimits({ maxAstDepth: v })
				})}
				{@render num({
					label: 'Max render samples',
					value: rules.limits.maxSamples,
					min: 256,
					max: 20000,
					integer: true,
					set: (v) => patchLimits({ maxSamples: v })
				})}
				{@render num({
					label: 'Max root grid',
					value: rules.limits.maxRootGrid,
					min: 128,
					max: 2048,
					integer: true,
					set: (v) => patchLimits({ maxRootGrid: v })
				})}
				{@render num({
					label: 'Max roots to count',
					value: rules.limits.maxRootsToCount,
					min: LIMITS.maxRootsToCount.min,
					max: LIMITS.maxRootsToCount.max,
					integer: true,
					set: (v) => patchLimits({ maxRootsToCount: v })
				})}
				{@render num({
					label: 'Min FFA submit interval',
					value: rules.limits.minSubmitIntervalMs,
					min: 0,
					max: 60000,
					integer: true,
					unit: 'ms',
					set: (v) => patchLimits({ minSubmitIntervalMs: v })
				})}
				{@render num({
					label: 'Max submits per window',
					value: rules.limits.maxSubmitsPerWindow,
					min: 1,
					max: 200,
					integer: true,
					set: (v) => patchLimits({ maxSubmitsPerWindow: v })
				})}
				{@render num({
					label: 'FFA submit window',
					value: rules.limits.submitWindowMs,
					min: 1000,
					max: 600000,
					integer: true,
					unit: 'ms',
					set: (v) => patchLimits({ submitWindowMs: v })
				})}
			</div>
		</div>
	</details>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
		font-size: 12px;
		color: var(--text);
	}

	.settings.locked {
		opacity: 0.92;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
	}

	.summary {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
		font-size: 10.5px;
		color: var(--muted);
	}

	.chip {
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 1px 5px;
		color: var(--text);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-size: 9px;
	}

	.reset {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--muted);
		border-radius: 5px;
		padding: 3px 8px;
		font-size: 10px;
		cursor: pointer;
	}

	.reset:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.reset:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.lock-note {
		margin: 0;
		border: 1px solid rgba(255, 181, 69, 0.3);
		background: rgba(255, 181, 69, 0.06);
		color: #ffd9a1;
		border-radius: 6px;
		padding: 5px 8px;
		font-size: 10.5px;
	}

	.group {
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--panel);
	}

	.group > summary {
		cursor: pointer;
		padding: 7px 10px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.11em;
		text-transform: uppercase;
		color: var(--muted);
		list-style: none;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.group > summary::-webkit-details-marker {
		display: none;
	}

	.group > summary::before {
		content: '+';
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		color: var(--accent);
		width: 10px;
	}

	.group[open] > summary::before {
		content: '−';
	}

	.group[open] > summary {
		border-bottom: 1px solid var(--line);
		color: var(--text);
	}

	.body {
		padding: 9px 10px 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 7px 9px;
	}

	.grid.three {
		grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
	}

	.num,
	.field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.lab {
		font-size: 9.5px;
		letter-spacing: 0.04em;
		color: var(--muted);
		text-transform: uppercase;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	input[type='number'],
	select {
		background: #0a1019;
		border: 1px solid var(--line);
		color: var(--text);
		border-radius: 5px;
		padding: 3px 5px;
		font-size: 11.5px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
	}

	input[type='number']:focus,
	select:focus {
		outline: 1px solid var(--accent);
		outline-offset: 0;
		border-color: var(--accent);
	}

	input:disabled,
	select:disabled {
		opacity: 0.42;
		cursor: not-allowed;
	}

	select {
		font-family: inherit;
	}

	.unit {
		font-size: 9.5px;
		color: var(--muted);
		white-space: nowrap;
	}

	.hint {
		font-size: 9px;
		line-height: 1.35;
		color: var(--muted);
		opacity: 0.85;
	}

	.num.off {
		opacity: 0.55;
	}

	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 10.5px;
		color: var(--text);
		flex-wrap: wrap;
	}

	.check input[type='checkbox'] {
		accent-color: var(--accent);
		width: 12px;
		height: 12px;
	}

	.check .hint {
		flex-basis: 100%;
		padding-left: 17px;
	}

	.note,
	.formula,
	.precision-note,
	.custom,
	.warn {
		margin: 0;
		font-size: 10px;
		line-height: 1.45;
		color: var(--muted);
	}

	.formula {
		border-left: 2px solid var(--line);
		padding-left: 7px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 9.5px;
	}

	.custom {
		color: #ffd9a1;
		border: 1px solid rgba(255, 181, 69, 0.28);
		background: rgba(255, 181, 69, 0.05);
		border-radius: 5px;
		padding: 4px 7px;
	}

	.warn {
		color: var(--danger);
	}

	.precision-note {
		color: var(--text);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 9.5px;
		border: 1px dashed var(--line);
		border-radius: 5px;
		padding: 4px 6px;
	}

	.time-row {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) minmax(110px, 0.7fr);
		gap: 9px;
		align-items: end;
	}

	.slider {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
		height: 16px;
	}

	.range-ends {
		display: flex;
		justify-content: space-between;
		font-size: 8.5px;
		color: var(--muted);
		opacity: 0.7;
	}

	.grapher {
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 6px 8px 8px;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: rgba(255, 255, 255, 0.012);
	}

	.grapher legend {
		padding: 0 5px;
		display: flex;
		align-items: baseline;
		gap: 6px;
	}

	.gname {
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text);
	}

	.gmode {
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--accent);
		opacity: 0.75;
	}

	@media (max-width: 620px) {
		.time-row {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
