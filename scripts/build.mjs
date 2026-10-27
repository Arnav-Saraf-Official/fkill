/**
 * Cross-platform production build helper.
 *
 *   node scripts/build.mjs static
 *   node scripts/build.mjs vercel
 *   node scripts/build.mjs cloudflare
 *   node scripts/build.mjs node
 *
 * Sets FKILL_ADAPTER for vite.config.ts without relying on shell-specific env
 * syntax, so the same commands work in bash, cmd.exe and CI.
 */
import { spawnSync } from 'node:child_process';

const adapter = process.argv[2];
const allowed = new Set(['static', 'vercel', 'cloudflare', 'node', 'auto']);

if (!adapter || !allowed.has(adapter)) {
	console.error(`Usage: node scripts/build.mjs <${[...allowed].join('|')}>`);
	process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['run', 'build'], {
	stdio: 'inherit',
	// npm on Windows is a .cmd shim, which Node only resolves through a shell.
	shell: process.platform === 'win32',
	env: { ...process.env, FKILL_ADAPTER: adapter === 'auto' ? '' : adapter }
});

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}
process.exit(result.status ?? 1);
