<script lang="ts">
	import { DEFAULT_GRAPHER_TYPES, GRAPHER_TYPE_ORDER } from '$lib/game/rules';
	import { GRAPHER_GLYPH, GRAPHER_TYPE_ACCENT } from '$lib/ui/theme';

	const types = GRAPHER_TYPE_ORDER.map((id) => DEFAULT_GRAPHER_TYPES[id]);

	const steps = [
		{
			n: '01',
			title: 'Pick a grapher',
			text: 'Every grapher is both a weapon and a target. Its type decides your root budget, range and damage.'
		},
		{
			n: '02',
			title: 'Build the curve',
			text: 'Write y = f(x) or a true circular arc inside the grapher’s coordinate window. Roots are a real, counted resource.'
		},
		{
			n: '03',
			title: 'Read the plane',
			text: 'Coordinates may be hidden, placement is rational, and cover blocks shots. Precision decides your score.'
		},
		{
			n: '04',
			title: 'Fire',
			text: 'The authoritative engine samples the geometry, resolves cover, damages what it touches and checks eliminations.'
		}
	];
</script>

<div class="landing">
	<section class="hero">
		<div class="hero-copy">
			<p class="eyebrow">Mathematical graphing arena</p>
			<h1>
				Graph.<br />
				Aim.<br />
				<span class="accent">Eliminate.</span>
			</h1>
			<p class="lede">
				f(kill) is a turn-based combat game played on a 50 × 50 coordinate plane. Your equations are
				your ammunition: every root, range limit and asymptote is a rule of engagement.
			</p>
			<div class="cta">
				<a class="btn primary" href="/lobby?mode=solo">Start a solo match</a>
				<a class="btn" href="/lobby?mode=online">Create an online room</a>
			</div>
			<dl class="facts">
				<div><dt>Players</dt><dd>2–10</dd></div>
				<div><dt>Graphers</dt><dd>up to 20 each</dd></div>
				<div><dt>Plane</dt><dd>50 × 50 units</dd></div>
				<div><dt>Modes</dt><dd>turns · random · FFA</dd></div>
			</dl>
		</div>

		<div class="hero-figure" aria-hidden="true">
			<div class="figure-head">
				<span>fig. 1 — engagement window</span>
				<span class="live">live geometry</span>
			</div>
			<svg viewBox="0 0 560 440" role="presentation">
				<defs>
					<pattern id="grid-sm" width="20" height="20" patternUnits="userSpaceOnUse">
						<path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(90,120,160,0.13)" stroke-width="1" />
					</pattern>
					<pattern id="grid-lg" width="100" height="100" patternUnits="userSpaceOnUse">
						<rect width="100" height="100" fill="url(#grid-sm)" />
						<path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(100,140,190,0.22)" stroke-width="1" />
					</pattern>
				</defs>

				<rect x="30" y="20" width="500" height="400" fill="url(#grid-lg)" />
				<g stroke="rgba(190,214,240,0.42)" stroke-width="1">
					<line x1="30" y1="220" x2="530" y2="220" />
					<line x1="280" y1="20" x2="280" y2="420" />
				</g>
				<g fill="#61748c" font-family="ui-monospace, monospace" font-size="9">
					<text x="504" y="214">x</text>
					<text x="286" y="34">y</text>
					<text x="284" y="234">0</text>
				</g>

				<!-- Player A curve: cubic passing through two targets. -->
				<path
					d="M 40 350 C 130 120, 210 100, 290 220 S 420 330, 520 140"
					fill="none"
					stroke="#46e6ff"
					stroke-width="2"
				/>
				<!-- Player B curve: dashed, grazing a hit zone. -->
				<path
					d="M 40 120 C 150 300, 250 330, 350 240 S 470 90, 525 210"
					fill="none"
					stroke="#ffb545"
					stroke-width="1.6"
					stroke-dasharray="7 6"
				/>
				<!-- Arc attack. -->
				<path
					d="M 150 330 A 70 70 0 0 1 250 275"
					fill="none"
					stroke="#5ef0a8"
					stroke-width="2"
					stroke-dasharray="2 5"
				/>
				<circle cx="150" cy="330" r="2.5" fill="#5ef0a8" />
				<circle cx="250" cy="275" r="2.5" fill="#5ef0a8" />

				<!-- Hit zones and graphers. -->
				<circle cx="330" cy="196" r="26" fill="rgba(70,230,255,0.07)" stroke="rgba(70,230,255,0.5)" stroke-dasharray="3 4" />
				<circle cx="330" cy="196" r="7" fill="#0d131d" stroke="#46e6ff" stroke-width="2" />
				<text x="330" y="200" text-anchor="middle" fill="#46e6ff" font-size="9" font-family="ui-monospace, monospace">●</text>

				<circle cx="425" cy="250" r="26" fill="rgba(255,181,69,0.06)" stroke="rgba(255,181,69,0.45)" stroke-dasharray="3 4" />
				<circle cx="425" cy="250" r="7" fill="#0d131d" stroke="#ffb545" stroke-width="2" />
				<text x="425" y="254" text-anchor="middle" fill="#ffb545" font-size="9" font-family="ui-monospace, monospace">▲</text>

				<circle cx="196" cy="296" r="26" fill="rgba(185,139,255,0.06)" stroke="rgba(185,139,255,0.4)" stroke-dasharray="3 4" />
				<circle cx="196" cy="296" r="7" fill="#0d131d" stroke="#b98bff" stroke-width="2" />
				<text x="196" y="300" text-anchor="middle" fill="#b98bff" font-size="9" font-family="ui-monospace, monospace">■</text>

				<!-- Cover sections. -->
				<g fill="rgba(147,164,188,0.13)" stroke="rgba(147,164,188,0.35)">
					<rect x="370" y="330" width="60" height="30" />
					<rect x="430" y="330" width="60" height="30" fill="rgba(255,107,107,0.10)" stroke="rgba(255,107,107,0.4)" />
				</g>
				<text x="466" y="349" text-anchor="middle" fill="#ff8f8f" font-size="8" font-family="ui-monospace, monospace">gap</text>

				<!-- Precision marker. -->
				<line x1="330" y1="180" x2="330" y2="168" stroke="#46e6ff" stroke-width="1" />
				<text x="338" y="170" fill="#93a4bc" font-size="8.5" font-family="ui-monospace, monospace">d = 0.4 R</text>
			</svg>
			<div class="figure-foot">
				<span>cyan: direct hit · amber: graze · green: arc</span>
				<span>+14.6 pts</span>
			</div>
		</div>
	</section>

	<section class="registry" aria-labelledby="registry-title">
		<div class="section-head">
			<h2 id="registry-title">Five ways to draw blood</h2>
			<p>One shared rules registry drives the editor, the validator, collision, scoring, CPUs and the relay.</p>
		</div>
		<div class="cards">
			{#each types as def (def.id)}
				<article class="card" style="--type:{GRAPHER_TYPE_ACCENT[def.id]}">
					<header>
						<span class="glyph" aria-hidden="true">{GRAPHER_GLYPH[def.id]}</span>
						<h3>{def.label}</h3>
						<span class="mode">{def.attackMode}</span>
					</header>
					<p>{def.description}</p>
					<dl>
						<div>
							<dt>{def.attackMode === 'arc' ? 'Radius' : 'Roots'}</dt>
							<dd>{def.attackMode === 'arc' ? `≤ ${def.maxArcRadius}` : `≤ ${def.maxRoots}`}</dd>
						</div>
						<div><dt>Window</dt><dd>{def.domainRangeSpan}</dd></div>
						<div><dt>Damage</dt><dd>{def.damageToGraphers}</dd></div>
					</dl>
				</article>
			{/each}
		</div>
	</section>

	<section class="flow" aria-labelledby="flow-title">
		<div class="section-head">
			<h2 id="flow-title">Anatomy of a turn</h2>
			<p>Nothing is cosmetic. The curve you see is the curve that resolves.</p>
		</div>
		<ol>
			{#each steps as step (step.n)}
				<li>
					<span class="n">{step.n}</span>
					<h3>{step.title}</h3>
					<p>{step.text}</p>
				</li>
			{/each}
		</ol>
	</section>

	<section class="principles">
		<div class="principle">
			<h3>Deterministic by construction</h3>
			<p>
				Same seed, state and action means the same result. Random scheduling, CPU targeting and obstacle
				generation are all seeded and reproducible.
			</p>
		</div>
		<div class="principle">
			<h3>Honest CPUs</h3>
			<p>
				Eight difficulty tiers change search budget and aim, never roots, range, health or information.
				Every CPU shot passes the same validator as yours.
			</p>
		</div>
		<div class="principle">
			<h3>Authoritative online play</h3>
			<p>
				Online rooms run on a separate relay that owns the match state. Clients submit intents; the
				server returns snapshots. Solo play works with no server at all.
			</p>
		</div>
	</section>

	<footer class="landing-foot">
		<p>
			Equations are parsed by an allowlisted grammar — no <code>eval</code>, no arbitrary code.
			See <a href="/settings">settings</a> for rules, accessibility and configuration import/export.
		</p>
	</footer>
</div>

<style>
	.landing {
		padding: 28px 22px 44px;
		max-width: 1240px;
		margin: 0 auto;
	}

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
		gap: 46px;
		align-items: center;
		padding: 26px 0 40px;
	}

	h1 {
		font-size: clamp(44px, 6.4vw, 78px);
		line-height: 0.92;
		letter-spacing: -0.035em;
		margin: 0 0 20px;
		font-weight: 650;
	}

	h1 .accent {
		color: var(--accent);
		font-family: var(--math);
		font-style: italic;
		font-weight: 500;
		letter-spacing: -0.02em;
	}

	.lede {
		max-width: 46ch;
		color: #b7c5d8;
		font-size: 15px;
		line-height: 1.65;
		margin-bottom: 24px;
	}

	.cta {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 30px;
	}

	.btn {
		display: inline-block;
		padding: 9px 16px;
		border: 1px solid var(--line-bright);
		border-radius: 6px;
		color: var(--text);
		font-size: 12.5px;
		text-decoration: none;
		background: var(--panel);
	}

	.btn:hover {
		border-color: var(--accent);
		text-decoration: none;
	}

	.btn.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: #041016;
		font-weight: 650;
	}

	.btn.primary:hover {
		background: #7defff;
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
		border-radius: 7px;
		overflow: hidden;
		margin: 0;
	}

	.facts div {
		background: rgba(13, 19, 29, 0.9);
		padding: 8px 10px;
	}

	.facts dt {
		font-size: 8.5px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--faint);
	}

	.facts dd {
		margin: 2px 0 0;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--text);
		white-space: nowrap;
	}

	.hero-figure {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: linear-gradient(180deg, #0b111a, #080c13);
		overflow: hidden;
		box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
	}

	.figure-head,
	.figure-foot {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 11px;
		font-family: var(--mono);
		font-size: 8.5px;
		letter-spacing: 0.06em;
		color: var(--faint);
		text-transform: uppercase;
	}

	.figure-head {
		border-bottom: 1px solid var(--line);
	}

	.figure-foot {
		border-top: 1px solid var(--line);
		text-transform: none;
		letter-spacing: 0;
		font-size: 9px;
	}

	.figure-foot span:last-child {
		color: var(--attack);
	}

	.live {
		color: var(--success);
	}

	.hero-figure svg {
		display: block;
		width: 100%;
		height: auto;
	}

	.section-head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 20px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}

	.section-head h2 {
		font-size: 19px;
		letter-spacing: -0.015em;
		margin: 0;
		font-weight: 600;
	}

	.section-head p {
		margin: 0;
		font-size: 12px;
		color: var(--muted);
		max-width: 52ch;
	}

	.registry {
		padding: 26px 0 30px;
		border-top: 1px solid var(--line);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 8px;
	}

	.card {
		border: 1px solid var(--line);
		border-top: 2px solid var(--type);
		border-radius: 7px;
		background: rgba(13, 19, 29, 0.72);
		padding: 11px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.card header {
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex-wrap: wrap;
	}

	.card .glyph {
		color: var(--type);
		font-family: var(--math);
		font-size: 15px;
	}

	.card h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	.card .mode {
		font-size: 8px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
		margin-left: auto;
	}

	.card p {
		font-size: 10.5px;
		line-height: 1.5;
		color: var(--muted);
		margin: 0;
		flex: 1;
	}

	.card dl {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
		margin: 0;
		border-top: 1px solid var(--line);
		padding-top: 7px;
	}

	.card dt {
		font-size: 7.5px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--faint);
	}

	.card dd {
		margin: 1px 0 0;
		font-family: var(--mono);
		font-size: 10px;
		color: var(--text);
	}

	.flow {
		padding: 26px 0 30px;
		border-top: 1px solid var(--line);
	}

	.flow ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
		border-radius: 8px;
		overflow: hidden;
	}

	.flow li {
		background: rgba(10, 15, 24, 0.94);
		padding: 13px;
	}

	.flow .n {
		font-family: var(--mono);
		font-size: 9px;
		color: var(--accent);
		letter-spacing: 0.1em;
	}

	.flow h3 {
		font-size: 12.5px;
		margin: 6px 0 5px;
	}

	.flow p {
		margin: 0;
		font-size: 10.5px;
		line-height: 1.55;
		color: var(--muted);
	}

	.principles {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		padding: 8px 0 26px;
	}

	.principle {
		border: 1px solid var(--line);
		border-left: 2px solid var(--line-bright);
		border-radius: 0 7px 7px 0;
		padding: 12px 14px;
		background: rgba(13, 19, 29, 0.55);
	}

	.principle h3 {
		font-size: 12px;
		margin: 0 0 5px;
	}

	.principle p {
		margin: 0;
		font-size: 10.5px;
		line-height: 1.55;
		color: var(--muted);
	}

	.landing-foot {
		border-top: 1px solid var(--line);
		padding-top: 14px;
		font-size: 10.5px;
		color: var(--faint);
	}

	.landing-foot p {
		margin: 0;
	}

	@media (max-width: 1040px) {
		.hero {
			grid-template-columns: minmax(0, 1fr);
			gap: 26px;
			padding-bottom: 26px;
		}
		.hero-figure {
			max-width: 660px;
		}
		.cards {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.flow ol {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 700px) {
		.landing {
			padding: 18px 14px 32px;
		}
		.facts {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.cards {
			grid-template-columns: minmax(0, 1fr);
		}
		.flow ol,
		.principles {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
