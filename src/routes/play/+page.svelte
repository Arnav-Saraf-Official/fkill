<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { AttackComponentInput, MatchState } from '$lib/game/types';
	import {
		soloGame,
		onlineSession,
		type AttackFeedback,
		type OnlineState
	} from '$lib/ui/stores';
	import GameView from '$lib/components/game/GameView.svelte';

	const mode = $derived(page.url.searchParams.get('mode') === 'online' ? 'online' : 'solo');

	const soloStateStore = soloGame.state;
	const soloFeedbackStore = soloGame.feedback;
	const soloState = $derived<MatchState | null>($soloStateStore);
	const soloFeedback = $derived<AttackFeedback | null>($soloFeedbackStore);

	const onlineStore = onlineSession.store;
	const online = $derived<OnlineState>($onlineStore);

	const gameState = $derived<MatchState | null>(
		mode === 'online' ? (online.snapshot?.state ?? null) : soloState
	);

	let nowMs = $state(Date.now());
	$effect(() => {
		const handle = setInterval(() => (nowMs = Date.now()), 200);
		return () => clearInterval(handle);
	});

	function actingHuman(state: MatchState): string {
		const humans = state.players.filter((p) => p.kind === 'human' && p.alive);
		if (state.turn.mode !== 'ffa') {
			const active = state.turn.activePlayerIds.find((id) => humans.some((h) => h.id === id));
			if (active) return active;
		}
		return humans[0]?.id ?? state.players[0]?.id ?? '';
	}

	const selfId = $derived(
		mode === 'online'
			? (online.snapshot?.selfId ?? '')
			: gameState
				? actingHuman(gameState)
				: ''
	);

	const clock = $derived(
		mode === 'online' && online.snapshot
			? online.snapshot.serverTime + Math.max(0, nowMs - online.receivedAt)
			: nowMs
	);

	const isHost = $derived(
		mode === 'online' && Boolean(online.snapshot && online.snapshot.hostId === online.snapshot.selfId)
	);

	const connectionNote = $derived(
		mode === 'online'
			? online.status === 'connected'
				? online.latencyMs > 0
					? `${online.latencyMs} ms`
					: ''
				: online.detail || online.status
			: ''
	);

	let onlineNotice = $state<AttackFeedback | null>(null);
	const onlineFeedback = $derived<AttackFeedback | null>(
		online.error
			? {
					id: -1,
					ok: false,
					message: online.error.message,
					at: nowMs
				}
			: onlineNotice
	);
	const feedback = $derived(mode === 'online' ? onlineFeedback : soloFeedback);

	let redirected = false;
	$effect(() => {
		if (redirected) return;
		if (mode === 'online') {
			const phase = online.snapshot?.phase;
			if (phase === 'lobby' || phase === 'closed') {
				redirected = true;
				void goto('/lobby?mode=online');
			} else if (!online.snapshot && (online.status === 'idle' || online.status === 'closed')) {
				redirected = true;
				void goto('/lobby?mode=online');
			}
		} else if (!soloState) {
			redirected = true;
			void goto('/lobby?mode=solo');
		}
	});

	function attack(components: AttackComponentInput[], grapherId?: string): boolean {
		if (mode === 'online') {
			onlineSession.clearError();
			onlineSession.send({ kind: 'submit-attack', grapherId, components });
			onlineNotice = {
				id: 1,
				ok: true,
				message: 'Attack sent to the authority — the relay will resolve it.',
				at: Date.now()
			};
			// Keep the draft: acceptance arrives as a snapshot, rejection as an error.
			return false;
		}
		const result = soloGame.submit(components, grapherId);
		return result.ok;
	}

	function pass(): void {
		if (mode === 'online') {
			onlineSession.clearError();
			onlineSession.send({ kind: 'pass' });
			return;
		}
		soloGame.pass();
	}

	function rematch(): void {
		if (mode === 'online') {
			onlineSession.send({ kind: 'rematch' });
			return;
		}
		soloGame.rematch();
	}

	function exit(): void {
		if (mode === 'online') {
			onlineSession.leave();
			void goto('/lobby?mode=online');
			return;
		}
		soloGame.clear();
		void goto('/lobby?mode=solo');
	}
</script>

<svelte:head>
	<title>Match — f(kill)</title>
</svelte:head>

{#if mode === 'online' && !online.snapshot?.state}
	<div class="waiting">
		<p class="eyebrow">Online match</p>
		<h1>{online.status === 'connected' ? 'Waiting for the room' : 'Connecting to the relay…'}</h1>
		<p>
			{online.detail ??
				'The match will appear when the authority starts it. If nothing happens, return to the lobby.'}
		</p>
		<a class="back" href="/lobby?mode=online">Back to lobby</a>
	</div>
{:else if gameState}
	<GameView
		state={gameState}
		{selfId}
		now={clock}
		{feedback}
		mode={mode}
		{connectionNote}
		canRematch={mode === 'solo' || isHost}
		onAttack={attack}
		onPass={pass}
		onRematch={rematch}
		onExit={exit}
	/>
{:else}
	<div class="waiting">
		<p class="eyebrow">No match</p>
		<h1>Nothing is running</h1>
		<p>Start a solo match or join an online room to begin.</p>
		<a class="back" href="/lobby?mode=solo">Open match setup</a>
	</div>
{/if}

<style>
	.waiting {
		max-width: 620px;
		margin: 60px auto;
		padding: 0 18px;
		text-align: center;
	}

	.waiting h1 {
		font-size: 28px;
		letter-spacing: -0.02em;
		margin-bottom: 8px;
	}

	.waiting p {
		color: var(--muted);
		font-size: 12.5px;
	}

	.back {
		display: inline-block;
		margin-top: 10px;
		border: 1px solid var(--line-bright);
		border-radius: 6px;
		padding: 6px 12px;
		font-size: 11.5px;
		text-decoration: none;
		color: var(--text);
	}

	.back:hover {
		border-color: var(--accent);
	}
</style>
