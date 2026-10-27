/**
 * Bundles the shared TypeScript engine into a single ESM file for the relay.
 * Run automatically by `npm run relay` and referenced by docs/DEPLOYMENT.md.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('server/dist', { recursive: true });

await build({
	entryPoints: ['scripts/authority-entry.ts'],
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'esm',
	outfile: 'server/dist/authority.mjs',
	sourcemap: true,
	logLevel: 'info',
	// ws is only used by the relay shell, never by the engine.
	external: ['ws']
});
