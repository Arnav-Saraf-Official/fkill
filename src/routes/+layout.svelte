<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';

	let { children } = $props();

	const path = $derived(page.url.pathname);
	const nav = [
		{ href: '/lobby?mode=solo', label: 'Solo / setup', match: '/lobby' },
		{ href: '/lobby?mode=online', label: 'Online', match: '/lobby?mode=online' },
		{ href: '/settings', label: 'Settings', match: '/settings' }
	];
</script>

<svelte:head>
	<title>f(kill) — equation combat</title>
	<meta
		name="description"
		content="f(kill): a mathematical graphing arena. Build equations, aim curves and arcs, and destroy your opponents' graphers."
	/>
</svelte:head>

<header class="topbar">
	<a class="brand" href="/" aria-label="f(kill) home">
		<span class="brand-mark" aria-hidden="true">f</span>
		<span class="brand-name">(kill)</span>
		<span class="brand-sub">equation combat</span>
	</a>

	<nav aria-label="Main navigation">
		{#each nav as item (item.href)}
			<a
				href={item.href}
				class:active={path === '/lobby' && item.match.startsWith('/lobby')}
				aria-current={path === item.match ? 'page' : undefined}
			>
				{item.label}
			</a>
		{/each}
	</nav>

	<div class="top-meta">
		<span class="coords" aria-hidden="true">[-25, 25] × [-25, 25]</span>
		<a class="play-link" href="/lobby?mode=solo">New match</a>
	</div>
</header>

<main class="page">
	{@render children()}
</main>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: 22px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--line);
		background: rgba(7, 10, 16, 0.82);
		backdrop-filter: blur(10px);
		position: sticky;
		top: 0;
		z-index: 30;
	}

	.brand {
		display: flex;
		align-items: baseline;
		gap: 1px;
		color: var(--text);
		text-decoration: none;
		font-family: var(--math);
		line-height: 1;
		flex: none;
	}

	.brand:hover {
		text-decoration: none;
	}

	.brand-mark {
		font-size: 25px;
		font-style: italic;
		color: var(--accent);
		letter-spacing: -0.02em;
	}

	.brand-name {
		font-size: 25px;
		font-style: italic;
		letter-spacing: -0.01em;
	}

	.brand-sub {
		font-family: var(--sans);
		font-size: 9px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--faint);
		margin-left: 10px;
		transform: translateY(-2px);
	}

	nav {
		display: flex;
		gap: 2px;
		flex-wrap: wrap;
	}

	nav a {
		display: inline-block;
		padding: 5px 9px;
		border-radius: 5px;
		color: var(--muted);
		font-size: 12px;
		text-decoration: none;
		border: 1px solid transparent;
	}

	nav a:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.03);
		text-decoration: none;
	}

	nav a.active {
		color: var(--accent);
		border-color: rgba(70, 230, 255, 0.25);
		background: var(--accent-dim);
	}

	.top-meta {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.coords {
		font-family: var(--mono);
		font-size: 9.5px;
		color: var(--faint);
		letter-spacing: 0.02em;
	}

	.play-link {
		font-size: 11.5px;
		border: 1px solid rgba(70, 230, 255, 0.35);
		color: var(--accent);
		padding: 5px 11px;
		border-radius: 5px;
		text-decoration: none;
		white-space: nowrap;
	}

	.play-link:hover {
		background: var(--accent-dim);
		text-decoration: none;
	}

	.page {
		max-width: 1560px;
		margin: 0 auto;
		position: relative;
	}

	@media (max-width: 760px) {
		.topbar {
			flex-wrap: wrap;
			gap: 8px 16px;
			padding: 9px 12px;
		}
		.coords {
			display: none;
		}
		nav a {
			font-size: 11px;
			padding: 4px 7px;
		}
		.page {
			max-width: 100%;
		}
	}
</style>
