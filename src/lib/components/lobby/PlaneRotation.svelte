<script lang="ts">
	import type { PlayerConfig } from '$lib/game/types';
	import { playerVisual, GRAPHER_GLYPH } from '$lib/ui/theme';

	let {
		players,
		rotations = $bindable({}),
		disabled = false
	}: {
		players: PlayerConfig[];
		rotations: Record<string, number[]>;
		disabled?: boolean;
	} = $props();

	function degrees(radians: number | undefined): number {
		return Math.round(((radians ?? 0) * 180) / Math.PI);
	}

	function setAngle(playerId: string, index: number, value: number): void {
		if (disabled || !Number.isFinite(value)) return;
		const clamped = Math.max(-180, Math.min(180, value));
		const list = [...(rotations[playerId] ?? [])];
		while (list.length < index) list.push(0);
		list[index] = (clamped * Math.PI) / 180;
		rotations = { ...rotations, [playerId]: list };
	}

	function setAll(playerId: string, count: number, value: number): void {
		if (disabled || !Number.isFinite(value)) return;
		const radians = (Math.max(-180, Math.min(180, value)) * Math.PI) / 180;
		rotations = { ...rotations, [playerId]: Array.from({ length: count }, () => radians) };
	}
</script>

<section class="rotation" aria-labelledby="rotation-title">
	<header>
		<div>
			<h2 id="rotation-title">Local plane rotation</h2>
			<p>
				Each grapher's local axes are rotated by this angle. Equations, sampling, cover and hit
				detection all use the same rigid transform; the angle is not merely a display setting.
			</p>
		</div>
		<span class="mode-tag">local mode</span>
	</header>

	<div class="players">
		{#each players as player (player.id)}
			{@const visual = playerVisual(player.colorIndex)}
			<div class="player" style="--c:{visual.color}">
				<div class="who">
					<span aria-hidden="true">{visual.glyph}</span>
					<strong>{player.name}</strong>
				</div>
				<div class="angles">
					{#each player.loadout as type, index (index)}
						<label title={`${player.name} grapher ${index + 1}: ${type}`}>
							<span class="glyph" aria-hidden="true">{GRAPHER_GLYPH[type]}</span>
							<span class="sr-only">{player.name} grapher {index + 1} rotation in degrees</span>
							<input
								type="number"
								min="-180"
								max="180"
								step="5"
								value={degrees(rotations[player.id]?.[index])}
								disabled={disabled}
								onchange={(e) =>
									setAngle(
										player.id,
										index,
										Number((e.currentTarget as HTMLInputElement).value)
									)}
							/>
							<span class="deg">°</span>
						</label>
					{/each}
				</div>
				<label class="all">
					<span>All</span>
					<input
						type="number"
						min="-180"
						max="180"
						step="15"
						value={degrees(rotations[player.id]?.[0])}
						disabled={disabled || player.loadout.length === 0}
						onchange={(e) =>
							setAll(
								player.id,
								player.loadout.length,
								Number((e.currentTarget as HTMLInputElement).value)
							)}
					/>
					<span class="deg">°</span>
				</label>
			</div>
		{/each}
	</div>
	<p class="hint">
		Angles are counter-clockwise, 0° aligning with the world +x axis. In shared-plane mode rotation is
		ignored — switch the coordinate mode to use it.
	</p>
</section>

<style>
	.rotation {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--panel);
		padding: 11px 12px;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		margin-bottom: 8px;
	}

	h2 {
		margin: 0 0 3px;
		font-size: 12.5px;
	}

	header p {
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
		color: var(--muted);
		max-width: 72ch;
	}

	.mode-tag {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--accent);
		border: 1px solid rgba(70, 230, 255, 0.3);
		border-radius: 3px;
		padding: 2px 5px;
		white-space: nowrap;
	}

	.players {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.player {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		border-left: 2px solid var(--c);
		padding: 3px 0 3px 7px;
	}

	.who {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 116px;
		font-size: 11px;
	}

	.who > span {
		color: var(--c);
	}

	.angles {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}

	.angles label,
	.all {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		background: var(--bg-soft);
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 1px 4px;
	}

	.angles .glyph {
		font-family: var(--math);
		font-size: 10px;
		color: var(--muted);
	}

	input {
		width: 44px;
		background: transparent;
		border: 0;
		color: var(--text);
		font-family: var(--mono);
		font-size: 10px;
		padding: 2px 0;
		text-align: right;
	}

	input:focus {
		outline: none;
	}

	label:focus-within {
		border-color: var(--accent);
	}

	.deg {
		font-size: 9px;
		color: var(--faint);
	}

	.all {
		margin-left: auto;
		color: var(--faint);
		font-size: 8.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.hint {
		margin: 8px 0 0;
		font-size: 9px;
		color: var(--faint);
		border-top: 1px solid var(--line);
		padding-top: 6px;
	}
</style>
