<script lang="ts">
	import type {
		GameRules,
		Grapher,
		MatchState,
		PlayerConfig,
		Vector2
	} from '$lib/game/types';
	import { createRng } from '$lib/game/rng';
	import { createObstacles } from '$lib/game/obstacles';
	import { distanceToObstacle, generatePlacements } from '$lib/game/placement';
	import { playerVisual } from '$lib/ui/theme';
	import GraphCanvas from '../graph/GraphCanvas.svelte';

	let {
		rules,
		players,
		seed,
		rotations = {},
		manualPlacements = $bindable({}),
		disabled = false
	}: {
		rules: GameRules;
		players: PlayerConfig[];
		seed: string;
		rotations?: Record<string, number[]>;
		manualPlacements: Record<string, Vector2[]>;
		disabled?: boolean;
	} = $props();

	let activePlayerId = $state<string | null>(null);
	let message = $state('');

	const obstacles = $derived(createObstacles(rules, seed, createRng(`${seed}:match`).fork('obstacles')));
	const active = $derived(
		players.find((p) => p.id === activePlayerId) ?? players[0] ?? null
	);
	const placed = $derived(active ? (manualPlacements[active.id] ?? []) : []);
	const complete = $derived(Boolean(active && placed.length >= active.loadout.length));

	function fallbackPosition(playerIndex: number, grapherIndex: number): Vector2 {
		const angle = -Math.PI / 2 + (Math.PI * 2 * playerIndex) / Math.max(1, players.length);
		const radius = 12;
		return {
			x: Math.cos(angle) * radius + Math.cos(grapherIndex * 1.7) * 2.2,
			y: Math.sin(angle) * radius + Math.sin(grapherIndex * 1.7) * 2.2
		};
	}

	/**
	 * A light synthetic MatchState so the arena renders obstacles, graphers and
	 * the current placement state with the same canvas used in a real match.
	 * Not authoritative: positions come from the editor.
	 */
	const previewState = $derived.by((): MatchState => {
		const statePlayers = players.map((p) => ({
			id: p.id,
			name: p.name,
			kind: p.kind,
			colorIndex: p.colorIndex,
			cpuDifficulty: p.cpuDifficulty,
			score: 0,
			hits: 0,
			shots: 0,
			damageDealt: 0,
			graphersDestroyed: 0,
			obstacleSectionsDestroyed: 0,
			alive: true,
			connected: true
		}));
		const graphers: Grapher[] = [];
		players.forEach((p, playerIndex) => {
			const list = manualPlacements[p.id] ?? [];
			p.loadout.forEach((type, index) => {
				graphers.push({
					id: `preview_${p.id}_${index}`,
					ownerId: p.id,
					type,
					position: list[index] ?? fallbackPosition(playerIndex, index),
					rotation: rotations[p.id]?.[index] ?? 0,
					health: rules.grapherHealth,
					maxHealth: rules.grapherHealth,
					alive: true,
					cooldownUntil: null
				});
			});
		});
		return {
			id: 'placement-preview',
			seed,
			phase: 'running',
			rules,
			players: statePlayers,
			graphers,
			obstacles,
			turn: {
				mode: rules.turns.mode,
				activePlayerIds: active ? [active.id] : [],
				batchNumber: 0,
				batchStartedAt: 0,
				endsAt: null,
				actedPlayerIds: [],
				bag: [],
				randomState: 0
			},
			attacks: [],
			events: [],
			stats: { startedAt: 0, finishedAt: null, batchCount: 0, attacks: 0 },
			winnerIds: [],
			now: 0,
			nextEventId: 1,
			nextAttackId: 1,
			autoSelectionCursor: {},
			recentSubmits: {}
		};
	});

	function distanceToEdges(p: Vector2): number {
		return Math.min(
			...obstacles.map((o) => {
				if (!o.shape) return Infinity;
				return distanceToObstacle(p, [o]);
			}),
			Infinity
		);
	}

	function legal(point: Vector2, ignoreIndex = -1): string {
		const half = rules.worldSize / 2 - 1;
		if (Math.abs(point.x) > half || Math.abs(point.y) > half) {
			return 'That position is outside the playable margin.';
		}
		const list = placed.filter((_, i) => i !== ignoreIndex);
		for (const other of list) {
			if (Math.hypot(point.x - other.x, point.y - other.y) < 1) {
				return 'Graphers must be at least 1 unit apart.';
			}
		}
		if (obstacles.length > 0 && distanceToEdges(point) < 1.5) {
			return 'That position is inside or too close to cover (1.5 units clearance).';
		}
		if (!active) return 'Select a player first.';
		for (const [playerId, positions] of Object.entries(manualPlacements)) {
			if (playerId === active.id) continue;
			for (const other of positions) {
				if (Math.hypot(point.x - other.x, point.y - other.y) < 1) {
					return 'Another player already occupies that position.';
				}
			}
		}
		return '';
	}

	function place(point: Vector2): void {
		if (disabled || !active) return;
		if (placed.length >= active.loadout.length) {
			message = 'This loadout is fully placed. Undo a position or select another player.';
			return;
		}
		const problem = legal(point);
		if (problem) {
			message = problem;
			return;
		}
		manualPlacements = {
			...manualPlacements,
			[active.id]: [...placed, { x: point.x, y: point.y }]
		};
		message = '';
		// Advance to the next player who still needs positions.
		if (placed.length + 1 >= active.loadout.length) {
			const next = players.find(
				(p) => p.id !== active.id && (manualPlacements[p.id] ?? []).length < p.loadout.length
			);
			if (next) activePlayerId = next.id;
		}
	}

	function undo(): void {
		if (!active || placed.length === 0) return;
		manualPlacements = { ...manualPlacements, [active.id]: placed.slice(0, -1) };
		message = '';
	}

	function clearPlayer(): void {
		if (!active) return;
		const copy = { ...manualPlacements };
		delete copy[active.id];
		manualPlacements = copy;
		message = '';
	}

	function randomiseAll(): void {
		if (disabled) return;
		const { positions } = generatePlacements(
			rules,
			players.map((p) => ({ playerId: p.id, count: p.loadout.length })),
			obstacles,
			createRng(`${seed}:placement:manual`).fork('placement')
		);
		manualPlacements = positions;
		message = 'Generated a complete legal layout. You can still adjust it by clicking.';
	}

	const snapped = (n: number): string => Number(n.toFixed(4)).toString();
</script>

<section class="placement" aria-labelledby="placement-title">
	<header class="head">
		<div>
			<h3 id="placement-title">Manual placement</h3>
			<p>
				Click the arena to place each grapher. Positions snap to 1/{rules.precision.denominator} unit
				and must respect cover and separation.
			</p>
		</div>
		<div class="head-actions">
			<button type="button" onclick={randomiseAll} disabled={disabled}>Generate layout</button>
			<button type="button" onclick={clearPlayer} disabled={disabled || placed.length === 0}>Clear player</button>
			<button type="button" onclick={undo} disabled={disabled || placed.length === 0}>Undo</button>
		</div>
	</header>

	<div class="board">
		<div class="side">
			<div class="players" role="tablist" aria-label="Player to place">
				{#each players as player (player.id)}
					{@const visual = playerVisual(player.colorIndex)}
					{@const count = (manualPlacements[player.id] ?? []).length}
					<button
						type="button"
						role="tab"
						aria-selected={active?.id === player.id}
						class="ptab"
						class:active={active?.id === player.id}
						style="--c:{visual.color}"
						onclick={() => {
							activePlayerId = player.id;
							message = '';
						}}
					>
						<span aria-hidden="true">{visual.glyph}</span>
						<span class="pname">{player.name}</span>
						<span class="pcount" class:done={count >= player.loadout.length}>{count}/{player.loadout.length}</span>
					</button>
				{/each}
			</div>

			{#if active}
				{@const visual = playerVisual(active.colorIndex)}
				<div class="instructions" style="--c:{visual.color}">
					<p class="eyebrow">Placing</p>
					<strong>{active.name}</strong>
					<ol>
						{#each active.loadout as type, index (index)}
							<li class:filled={index < placed.length}>
								<span>{index + 1}</span>
								{rules.grapherTypes[type].label}
								{#if index < placed.length}
									<code>({snapped(placed[index].x)}, {snapped(placed[index].y)})</code>
								{:else}
									<em>click to place</em>
								{/if}
							</li>
						{/each}
					</ol>
					{#if complete}<p class="done-note">All positions for {active.name} are set.</p>{/if}
				</div>
			{/if}

			{#if message}<p class="message" role="status">{message}</p>{/if}
		</div>

		<div class="canvas-holder">
			<GraphCanvas
				state={previewState}
				{rules}
				selfId={active?.id ?? null}
				preview={[]}
				historyCount={0}
				showHitZones={false}
				showGrid={rules.coordinates.showGrid}
				placement={active ? { pending: placed, colorIndex: active.colorIndex, limit: active.loadout.length } : null}
				onPlace={place}
				label="Placement preview"
			/>
		</div>
	</div>
</section>

<style>
	.placement {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
		padding: 12px;
	}

	.head {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: flex-start;
		margin-bottom: 10px;
		flex-wrap: wrap;
	}

	.head h3 {
		margin: 0 0 3px;
		font-size: 13px;
	}

	.head p {
		margin: 0;
		font-size: 10.5px;
		color: var(--muted);
		max-width: 62ch;
	}

	.head-actions {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
	}

	.head-actions button {
		background: var(--panel-raised);
		border: 1px solid var(--line-bright);
		color: var(--text);
		border-radius: 5px;
		padding: 4px 8px;
		font-size: 10px;
	}

	.head-actions button:hover:not(:disabled) {
		border-color: var(--accent);
	}

	.head-actions button:disabled {
		opacity: 0.45;
	}

	.board {
		display: grid;
		grid-template-columns: 248px minmax(0, 1fr);
		gap: 10px;
		align-items: stretch;
	}

	.side {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	.players {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.ptab {
		display: grid;
		grid-template-columns: 14px minmax(0, 1fr) auto;
		gap: 5px;
		align-items: center;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 5px;
		padding: 4px 6px;
		color: var(--muted);
		font-size: 11px;
		text-align: left;
	}

	.ptab:hover {
		border-color: var(--line-bright);
	}

	.ptab.active {
		border-color: var(--c);
		background: rgba(255, 255, 255, 0.035);
		color: var(--text);
	}

	.ptab > span:first-child {
		color: var(--c);
	}

	.pname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pcount {
		font-family: var(--mono);
		font-size: 9px;
		color: var(--faint);
	}

	.pcount.done {
		color: var(--success);
	}

	.instructions {
		border-top: 1px solid var(--line);
		padding-top: 8px;
		font-size: 11px;
	}

	.instructions .eyebrow {
		margin-bottom: 2px;
	}

	.instructions strong {
		color: var(--c);
		font-size: 12px;
	}

	.instructions ol {
		list-style: none;
		margin: 7px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.instructions li {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr);
		gap: 5px;
		font-size: 10px;
		color: var(--muted);
		line-height: 1.4;
	}

	.instructions li > span {
		font-family: var(--mono);
		color: var(--faint);
	}

	.instructions li code {
		display: block;
		font-size: 9px;
		color: var(--accent);
	}

	.instructions li em {
		font-style: normal;
		font-size: 9px;
		color: var(--faint);
	}

	.instructions li.filled {
		color: var(--text);
	}

	.done-note {
		margin: 7px 0 0;
		font-size: 10px;
		color: var(--success);
	}

	.message {
		margin: 0;
		font-size: 10px;
		line-height: 1.4;
		color: var(--attack);
		border: 1px solid rgba(255, 181, 69, 0.3);
		background: rgba(255, 181, 69, 0.07);
		border-radius: 5px;
		padding: 5px 7px;
	}

	.canvas-holder {
		min-height: 420px;
		min-width: 0;
		display: flex;
	}

	.canvas-holder :global(> *) {
		flex: 1;
	}

	@media (max-width: 900px) {
		.board {
			grid-template-columns: minmax(0, 1fr);
		}
		.canvas-holder {
			min-height: 360px;
		}
	}
</style>
