<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { GameRules, MatchState, Vector2 } from '$lib/game/types';
	import type { CurveSegments } from '$lib/math/geometry';
	import { prepareAttack } from '$lib/math/validation';
	import { frameForGrapher } from '$lib/math/transforms';
	import { snapToPlacementGrid } from '$lib/game/rules';
	import { playerVisual } from '$lib/ui/theme';
	import { preferences, prefersReducedMotion } from '$lib/ui/preferences';

	interface PlacementOverlay {
		pending: Vector2[];
		colorIndex: number;
		limit: number;
	}

	let {
		state: match = null,
		rules,
		selfId = null,
		preview = [],
		previewColor = '#46e6ff',
		selectedGrapherId = null,
		historyCount = 3,
		showHitZones = true,
		showGrid = true,
		now = Date.now(),
		placement = null,
		onPlace,
		label = 'Graphing arena'
	}: {
		state?: MatchState | null;
		rules: GameRules;
		selfId?: string | null;
		preview?: CurveSegments;
		previewColor?: string;
		selectedGrapherId?: string | null;
		historyCount?: number;
		showHitZones?: boolean;
		showGrid?: boolean;
		now?: number;
		placement?: PlacementOverlay | null;
		onPlace?: (point: Vector2) => void;
		label?: string;
	} = $props();

	let canvas: HTMLCanvasElement;
	let wrap: HTMLDivElement;
	let cssW = $state(720);
	let cssH = $state(560);
	let cam = $state({ scale: 14, cx: 0, cy: 0 });
	let dragging = false;
	let lastPointer = { x: 0, y: 0 };
	let hover: Vector2 | null = $state(null);
	let fitted = false;
	const reduced = $derived($preferences.reduceMotion || prefersReducedMotion());
	const geomCache = new SvelteMap<string, CurveSegments>();

	const worldHalf = $derived(rules.worldSize / 2);

	function fit(): void {
		const pad = 0.94;
		const scale = Math.min(cssW / rules.worldSize, cssH / rules.worldSize) * pad;
		cam = { scale: Math.max(2, scale), cx: 0, cy: 0 };
		fitted = true;
	}

	function toScreen(p: Vector2): { x: number; y: number } {
		return {
			x: cssW / 2 + (p.x - cam.cx) * cam.scale,
			y: cssH / 2 - (p.y - cam.cy) * cam.scale
		};
	}

	function toWorld(sx: number, sy: number): Vector2 {
		return {
			x: cam.cx + (sx - cssW / 2) / cam.scale,
			y: cam.cy - (sy - cssH / 2) / cam.scale
		};
	}

	function zoomBy(factor: number, anchor?: { x: number; y: number }): void {
		const before = anchor ? toWorld(anchor.x, anchor.y) : { x: cam.cx, y: cam.cy };
		const minScale = Math.min(cssW, cssH) / rules.worldSize / 3;
		const maxScale = Math.min(cssW, cssH) / rules.worldSize * 24;
		const nextScale = Math.max(minScale, Math.min(maxScale, cam.scale * factor));
		const after = anchor ? toWorld(anchor.x, anchor.y) : { x: cam.cx, y: cam.cy };
		cam = {
			scale: nextScale,
			cx: cam.cx + (before.x - after.x),
			cy: cam.cy + (before.y - after.y)
		};
	}

	function eventPos(event: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
		const rect = canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	function handlePointerDown(event: PointerEvent): void {
		if (event.button !== 0 && event.pointerType === 'mouse') return;
		const pos = eventPos(event);
		lastPointer = pos;
		if (placement && onPlace) {
			const snapped = snapPoint(toWorld(pos.x, pos.y));
			onPlace(snapped);
			return;
		}
		dragging = true;
		canvas.setPointerCapture(event.pointerId);
	}

	function snapPoint(p: Vector2): Vector2 {
		return {
			x: Math.max(-worldHalf, Math.min(worldHalf, snapToPlacementGrid(rules, p.x))),
			y: Math.max(-worldHalf, Math.min(worldHalf, snapToPlacementGrid(rules, p.y)))
		};
	}

	function handlePointerMove(event: PointerEvent): void {
		const pos = eventPos(event);
		hover = placement ? snapPoint(toWorld(pos.x, pos.y)) : toWorld(pos.x, pos.y);
		if (!dragging) return;
		const dx = pos.x - lastPointer.x;
		const dy = pos.y - lastPointer.y;
		lastPointer = pos;
		const limit = worldHalf + 6;
		cam = {
			...cam,
			cx: Math.max(-limit, Math.min(limit, cam.cx - dx / cam.scale)),
			cy: Math.max(-limit, Math.min(limit, cam.cy + dy / cam.scale))
		};
	}

	function handlePointerUp(event: PointerEvent): void {
		dragging = false;
		try {
			canvas.releasePointerCapture(event.pointerId);
		} catch {
			// capture may already be released
		}
	}

	function handleWheel(event: WheelEvent): void {
		event.preventDefault();
		const pos = eventPos(event);
		zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, pos);
	}

	function handleKey(event: KeyboardEvent): void {
		const step = 2;
		if (event.key === 'ArrowLeft') cam = { ...cam, cx: cam.cx - step };
		else if (event.key === 'ArrowRight') cam = { ...cam, cx: cam.cx + step };
		else if (event.key === 'ArrowUp') cam = { ...cam, cy: cam.cy + step };
		else if (event.key === 'ArrowDown') cam = { ...cam, cy: cam.cy - step };
		else if (event.key === '+' || event.key === '=') zoomBy(1.2);
		else if (event.key === '-' || event.key === '_') zoomBy(1 / 1.2);
		else if (event.key === 'Home') fit();
		else return;
		event.preventDefault();
	}

	/** Reconstruct world geometry for an accepted attack (cached). */
	function historyGeometry(attackId: string): { segments: CurveSegments; color: string; dash: string }[] {
		if (!match) return [];
		const attack = match.attacks.find((a) => a.id === attackId);
		if (!attack) return [];
		const cached = geomCache.get(attackId);
		const grapher = match.graphers.find((g) => g.id === attack.grapherId);
		const color = playerVisual(match.players.find((p) => p.id === attack.playerId)?.colorIndex ?? 0).color;
		if (cached) return [{ segments: cached, color, dash: dashFor(attack.playerId) }];
		if (!grapher) return [];
		const frame = frameForGrapher(grapher, rules);
		const components = attack.components
			.map((c) => {
				if (c.kind === 'function' && c.expression) return { kind: 'function' as const, expression: c.expression };
				if (c.kind === 'arc' && c.arc) return c.arc;
				return null;
			})
			.filter((c): c is NonNullable<typeof c> => c !== null);
		if (components.length === 0) return [];
		const prepared = prepareAttack(rules, attack.grapherType, frame, components);
		if (!prepared.ok) return [];
		const segments = prepared.components.flatMap((c) => c.world);
		geomCache.set(attackId, segments);
		return [{ segments, color, dash: dashFor(attack.playerId) }];
	}

	function dashFor(playerId: string): string {
		if (!match) return 'solid';
		const player = match.players.find((p) => p.id === playerId);
		return playerVisual(player?.colorIndex ?? 0).lineStyle;
	}

	function applyDash(ctx: CanvasRenderingContext2D, style: string, width: number): void {
		switch (style) {
			case 'dashed':
				ctx.setLineDash([width * 3, width * 2]);
				break;
			case 'dotted':
				ctx.setLineDash([width, width * 2]);
				break;
			case 'dashdot':
				ctx.setLineDash([width * 3, width * 1.5, width, width * 1.5]);
				break;
			default:
				ctx.setLineDash([]);
		}
	}

	function strokeSegments(
		ctx: CanvasRenderingContext2D,
		segments: CurveSegments,
		color: string,
		width: number,
		alpha: number,
		dash = 'solid'
	): void {
		if (segments.length === 0) return;
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		applyDash(ctx, dash, width);
		ctx.beginPath();
		for (const segment of segments) {
			if (segment.length < 2) continue;
			const first = toScreen(segment[0]);
			ctx.moveTo(first.x, first.y);
			for (let i = 1; i < segment.length; i++) {
				const p = toScreen(segment[i]);
				ctx.lineTo(p.x, p.y);
			}
		}
		ctx.stroke();
		ctx.restore();
	}

	function drawGrid(ctx: CanvasRenderingContext2D): void {
		const spacing = rules.coordinates.gridSpacing;
		const targetPx = 14;
		const k = Math.max(1, Math.pow(2, Math.ceil(Math.log2(targetPx / (spacing * cam.scale)))));
		let step = spacing * k;
		while (step * cam.scale < targetPx) step *= 2;
		const major = step * 5;
		const left = toWorld(0, 0);
		const right = toWorld(cssW, cssH);
		const minX = Math.max(-worldHalf, Math.floor(left.x / step) * step);
		const maxX = Math.min(worldHalf, right.x);
		const minY = Math.max(-worldHalf, Math.floor(right.y / step) * step);
		const maxY = Math.min(worldHalf, left.y);

		if (showGrid && rules.coordinates.showGrid) {
			ctx.save();
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'rgba(90, 120, 160, 0.14)';
			ctx.beginPath();
			for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
				const sx = toScreen({ x, y: 0 }).x;
				ctx.moveTo(sx, 0);
				ctx.lineTo(sx, cssH);
			}
			for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
				const sy = toScreen({ x: 0, y }).y;
				ctx.moveTo(0, sy);
				ctx.lineTo(cssW, sy);
			}
			ctx.stroke();

			// Major grid
			ctx.strokeStyle = 'rgba(110, 150, 200, 0.20)';
			ctx.beginPath();
			const startX = Math.ceil(minX / major) * major;
			for (let x = startX; x <= maxX; x += major) {
				const sx = toScreen({ x, y: 0 }).x;
				ctx.moveTo(sx, 0);
				ctx.lineTo(sx, cssH);
			}
			const startY = Math.ceil(minY / major) * major;
			for (let y = startY; y <= maxY; y += major) {
				const sy = toScreen({ x: 0, y }).y;
				ctx.moveTo(0, sy);
				ctx.lineTo(cssW, sy);
			}
			ctx.stroke();
			ctx.restore();
		}

		// World boundary
		const cornerA = toScreen({ x: -worldHalf, y: worldHalf });
		const cornerB = toScreen({ x: worldHalf, y: -worldHalf });
		ctx.save();
		ctx.strokeStyle = 'rgba(140, 170, 210, 0.35)';
		ctx.lineWidth = 1;
		ctx.strokeRect(cornerA.x, cornerA.y, cornerB.x - cornerA.x, cornerB.y - cornerA.y);
		ctx.restore();

		if (rules.coordinates.showAxes) {
			const origin = toScreen({ x: 0, y: 0 });
			ctx.save();
			ctx.strokeStyle = 'rgba(200, 222, 245, 0.55)';
			ctx.lineWidth = 1.4;
			ctx.beginPath();
			ctx.moveTo(0, origin.y);
			ctx.lineTo(cssW, origin.y);
			ctx.moveTo(origin.x, 0);
			ctx.lineTo(origin.x, cssH);
			ctx.stroke();
			ctx.restore();

			if (rules.coordinates.labels) {
				ctx.save();
				ctx.fillStyle = 'rgba(180, 200, 225, 0.75)';
				ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				for (let x = Math.ceil(minX / major) * major; x <= maxX; x += major) {
					if (Math.abs(x) < 1e-9) continue;
					const sx = toScreen({ x, y: 0 }).x;
					ctx.fillText(formatTick(x), sx, Math.min(cssH - 14, origin.y + 4));
				}
				ctx.textAlign = 'right';
				ctx.textBaseline = 'middle';
				for (let y = Math.ceil(minY / major) * major; y <= maxY; y += major) {
					if (Math.abs(y) < 1e-9) continue;
					const sy = toScreen({ x: 0, y }).y;
					ctx.fillText(formatTick(y), Math.max(26, origin.x - 6), sy);
				}
				ctx.restore();
			}
		}
	}

	function formatTick(value: number): string {
		if (Math.abs(value) < 1e-9) return '0';
		if (Math.abs(value) >= 1000) return value.toExponential(0);
		const rounded = Number(value.toFixed(3));
		return String(rounded);
	}

	function pathObstacle(ctx: CanvasRenderingContext2D, shape: import('$lib/game/types').ObstacleShape): void {
		ctx.beginPath();
		if (shape.kind === 'circle') {
			const c = toScreen(shape.center);
			ctx.arc(c.x, c.y, shape.radius * cam.scale, 0, Math.PI * 2);
		} else if (shape.kind === 'roundRect') {
			const a = toScreen({ x: shape.x, y: shape.y + shape.height });
			const b = toScreen({ x: shape.x + shape.width, y: shape.y });
			const r = Math.min(shape.cornerRadius * cam.scale, (b.x - a.x) / 2, (b.y - a.y) / 2);
			if (typeof ctx.roundRect === 'function') {
				ctx.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, Math.max(0, r));
			} else {
				ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
			}
		} else {
			shape.points.forEach((p, i) => {
				const s = toScreen(p);
				if (i === 0) ctx.moveTo(s.x, s.y);
				else ctx.lineTo(s.x, s.y);
			});
			ctx.closePath();
		}
	}

	function drawObstacles(ctx: CanvasRenderingContext2D): void {
		if (!match) return;
		for (const obstacle of match.obstacles) {
			ctx.save();
			// subtle silhouette behind the destructible cells
			pathObstacle(ctx, obstacle.shape);
			ctx.fillStyle = 'rgba(40, 58, 80, 0.55)';
			ctx.fill();
			ctx.restore();

			for (const section of obstacle.sections) {
				if (section.destroyed) continue;
				const ratio = section.maxDurability > 0 ? section.durability / section.maxDurability : 1;
				const topLeft = toScreen({
					x: section.center.x - section.size / 2,
					y: section.center.y + section.size / 2
				});
				const size = section.size * cam.scale;
				const damage = 1 - Math.max(0, Math.min(1, ratio));
				ctx.fillStyle = obstacle.indestructible
					? 'rgba(120, 140, 190, 0.30)'
					: `rgba(${Math.round(58 + 90 * damage)}, ${Math.round(84 - 30 * damage)}, ${Math.round(112 - 30 * damage)}, 0.55)`;
				ctx.fillRect(topLeft.x + 0.5, topLeft.y + 0.5, size - 1, size - 1);
				ctx.strokeStyle = 'rgba(20, 28, 40, 0.5)';
				ctx.lineWidth = 0.6;
				ctx.strokeRect(topLeft.x + 0.5, topLeft.y + 0.5, size - 1, size - 1);
			}

			pathObstacle(ctx, obstacle.shape);
			ctx.strokeStyle = obstacle.indestructible ? 'rgba(160, 180, 255, 0.7)' : 'rgba(130, 158, 195, 0.45)';
			ctx.lineWidth = 1.2;
			ctx.stroke();
		}
	}

	function drawPlacement(ctx: CanvasRenderingContext2D): void {
		if (!placement) return;
		const visual = playerVisual(placement.colorIndex);
		for (let i = 0; i < placement.pending.length; i++) {
			const p = toScreen(placement.pending[i]);
			ctx.save();
			ctx.globalAlpha = 0.9;
			ctx.beginPath();
			ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
			ctx.fillStyle = visual.soft;
			ctx.fill();
			ctx.strokeStyle = visual.color;
			ctx.lineWidth = 1.6;
			ctx.stroke();
			ctx.fillStyle = visual.color;
			ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(String(i + 1), p.x, p.y + 0.5);
			ctx.restore();
		}
		if (hover && placement.pending.length < placement.limit) {
			const p = toScreen(hover);
			ctx.save();
			ctx.globalAlpha = 0.6;
			ctx.setLineDash([3, 3]);
			ctx.strokeStyle = visual.color;
			ctx.beginPath();
			ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
			ctx.stroke();
			ctx.restore();
		}
	}

	function drawGraphers(ctx: CanvasRenderingContext2D): void {
		if (!match) return;
		for (const grapher of match.graphers) {
			const owner = match.players.find((p) => p.id === grapher.ownerId);
			const visual = playerVisual(owner?.colorIndex ?? 0);
			const p = toScreen(grapher.position);
			const isSelf = grapher.ownerId === selfId;
			const selected = grapher.id === selectedGrapherId;
			const cooled = grapher.cooldownUntil !== null && grapher.cooldownUntil > now;
			if (!grapher.alive) {
				ctx.save();
				ctx.globalAlpha = 0.22;
				ctx.strokeStyle = visual.color;
				ctx.lineWidth = 1.4;
				ctx.beginPath();
				ctx.moveTo(p.x - 5, p.y - 5);
				ctx.lineTo(p.x + 5, p.y + 5);
				ctx.moveTo(p.x + 5, p.y - 5);
				ctx.lineTo(p.x - 5, p.y + 5);
				ctx.stroke();
				ctx.restore();
				continue;
			}

			if (showHitZones) {
				ctx.save();
				const radius = rules.targetHitRadius * cam.scale;
				ctx.beginPath();
				ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
				ctx.fillStyle = visual.soft;
				ctx.fill();
				ctx.setLineDash([2, 4]);
				ctx.strokeStyle = visual.color;
				ctx.globalAlpha = 0.5;
				ctx.lineWidth = 1;
				ctx.stroke();
				ctx.restore();
			}

			ctx.save();
			ctx.beginPath();
			ctx.arc(p.x, p.y, selected ? 12 : 10, 0, Math.PI * 2);
			ctx.fillStyle = cooled ? 'rgba(30, 42, 58, 0.95)' : '#0b111a';
			ctx.fill();
			ctx.lineWidth = selected ? 3 : 2;
			ctx.strokeStyle = visual.color;
			ctx.globalAlpha = cooled ? 0.5 : 1;
			ctx.stroke();
			if (selected) {
				ctx.beginPath();
				ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
				ctx.globalAlpha = 0.45;
				ctx.setLineDash([4, 4]);
				ctx.strokeStyle = visual.color;
				ctx.lineWidth = 1;
				ctx.stroke();
			}
			ctx.restore();

			ctx.save();
			ctx.fillStyle = cooled ? 'rgba(190, 205, 225, 0.5)' : '#eaf2fb';
			ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(visual.glyph, p.x, p.y + 0.5);
			ctx.restore();

			if (grapher.maxHealth > 1) {
				ctx.save();
				ctx.beginPath();
				const frac = Math.max(0, Math.min(1, grapher.health / grapher.maxHealth));
				ctx.arc(p.x, p.y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
				ctx.strokeStyle = frac > 0.5 ? '#5ef0a8' : frac > 0.25 ? '#ffb545' : '#ff6b6b';
				ctx.lineWidth = 2;
				ctx.stroke();
				ctx.restore();
			}

			if (rules.precision.showCoordinates) {
				ctx.save();
				ctx.fillStyle = 'rgba(214, 228, 246, 0.82)';
				ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				const text = `${grapher.position.x.toFixed(2)}, ${grapher.position.y.toFixed(2)}`;
				ctx.fillText(text, p.x, p.y + 15);
				ctx.restore();
			}

			if (isSelf) {
				ctx.save();
				ctx.strokeStyle = visual.color;
				ctx.globalAlpha = 0.9;
				ctx.beginPath();
				ctx.moveTo(p.x, p.y - 19);
				ctx.lineTo(p.x - 4, p.y - 24);
				ctx.lineTo(p.x + 4, p.y - 24);
				ctx.closePath();
				ctx.fillStyle = visual.color;
				ctx.fill();
				ctx.restore();
			}
		}
	}

	function draw(ctx: CanvasRenderingContext2D): void {
		ctx.clearRect(0, 0, cssW, cssH);
		ctx.fillStyle = '#070a10';
		ctx.fillRect(0, 0, cssW, cssH);
		drawGrid(ctx);
		drawObstacles(ctx);

		if (match) {
			const current = match;
			const recent = current.attacks.slice(-Math.max(0, historyCount));
			for (const attack of recent) {
				const age = now - attack.submittedAt;
				const isNewest = attack === recent[recent.length - 1];
				const alpha = isNewest ? Math.max(0.25, 1 - age / 2400) : 0.28;
				for (const geom of historyGeometry(attack.id)) {
					strokeSegments(ctx, geom.segments, geom.color, isNewest ? 2.1 : 1.2, alpha, geom.dash);
				}
				if (isNewest && !reduced && age < 1400) {
					for (const component of attack.components) {
						for (const hit of component.targetsHit) {
							const target = current.graphers.find((g) => g.id === hit.targetId);
							if (!target) continue;
							const p = toScreen(target.position);
							ctx.save();
							ctx.globalAlpha = Math.max(0, 0.9 - age / 1400);
							ctx.strokeStyle = '#ffb545';
							ctx.lineWidth = 2;
							ctx.beginPath();
							ctx.arc(p.x, p.y, 12 + (age / 1400) * 18, 0, Math.PI * 2);
							ctx.stroke();
							ctx.fillStyle = '#ffd28f';
							ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
							ctx.textAlign = 'center';
							ctx.fillText(`+${hit.score}`, p.x, p.y - 24);
							ctx.restore();
						}
					}
				}
			}
		}

		strokeSegments(ctx, preview, previewColor, 2, 0.95, 'dashed');
		drawGraphers(ctx);
		drawPlacement(ctx);
	}

	$effect(() => {
		// Establish reactive dependencies explicitly.
		void [match, preview, cam, cssW, cssH, rules, showGrid, showHitZones, historyCount, now, placement, hover, selectedGrapherId];
		if (!canvas) return;
		const dpr = Math.min(3, window.devicePixelRatio || 1);
		if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
			canvas.width = Math.round(cssW * dpr);
			canvas.height = Math.round(cssH * dpr);
		}
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		draw(ctx);
	});

	onMount(() => {
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const { width, height } = entry.contentRect;
				const changed = Math.abs(width - cssW) > 0.5 || Math.abs(height - cssH) > 0.5;
				if (!changed) continue;
				cssW = Math.max(120, width);
				cssH = Math.max(120, height);
				if (!fitted) fit();
			}
		});
		observer.observe(wrap);
		const rect = wrap.getBoundingClientRect();
		cssW = Math.max(120, rect.width);
		cssH = Math.max(120, rect.height);
		fit();
		return () => observer.disconnect();
	});

	let description = $derived.by(() => {
		if (!match) return label;
		const alive = match.graphers.filter((g) => g.alive).length;
		const parts = [`${label}.`, `${alive} of ${match.graphers.length} graphers active.`];
		if (match.obstacles.length > 0) parts.push(`${match.obstacles.length} obstacles.`);
		const mine = match.graphers.filter((g) => g.ownerId === selfId && g.alive);
		if (mine.length > 0 && rules.precision.showCoordinates) {
			parts.push(
				`Your graphers: ${mine
					.map((g) => `${g.type} at ${g.position.x.toFixed(2)}, ${g.position.y.toFixed(2)}`)
					.join('; ')}.`
			);
		}
		return parts.join(' ');
	});
</script>

<div class="graph-shell" bind:this={wrap}>
	<canvas
		bind:this={canvas}
		class:placing={Boolean(placement)}
		style="width: {cssW}px; height: {cssH}px;"
		aria-label={description}
		tabindex="0"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		onwheel={handleWheel}
		onkeydown={handleKey}
	></canvas>

	<div class="controls" aria-hidden="false">
		<button type="button" onclick={() => zoomBy(1.25)} aria-label="Zoom in">+</button>
		<button type="button" onclick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">−</button>
		<button type="button" onclick={fit} aria-label="Fit the arena">⤢</button>
	</div>

	{#if placement}
		<div class="hint">
			Click to place grapher {placement.pending.length + 1} of {placement.limit} · snapped to 1/{rules.precision.denominator}
		</div>
	{/if}
	{#if hover && placement}
		<div class="coords">x {hover.x.toFixed(2)} · y {hover.y.toFixed(2)}</div>
	{/if}
	<span class="visually-hidden">{description}</span>
</div>

<style>
	.graph-shell {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 320px;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 10px;
		overflow: hidden;
	}

	canvas {
		display: block;
		cursor: grab;
		touch-action: none;
		outline: none;
	}

	canvas:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent);
	}

	canvas.placing {
		cursor: crosshair;
	}

	.controls {
		position: absolute;
		top: 10px;
		right: 10px;
		display: flex;
		gap: 4px;
		background: rgba(9, 14, 21, 0.86);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 3px;
	}

	.controls button {
		width: 28px;
		height: 26px;
		border: 1px solid transparent;
		border-radius: 5px;
		background: transparent;
		color: var(--text);
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
	}

	.controls button:hover,
	.controls button:focus-visible {
		border-color: var(--line);
		background: var(--panel-raised);
	}

	.hint,
	.coords {
		position: absolute;
		left: 12px;
		bottom: 12px;
		padding: 5px 9px;
		border-radius: 6px;
		background: rgba(9, 14, 21, 0.86);
		border: 1px solid var(--line);
		color: var(--muted);
		font-size: 11px;
		letter-spacing: 0.01em;
		pointer-events: none;
	}

	.coords {
		left: auto;
		right: 12px;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
