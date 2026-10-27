import adapterAuto from '@sveltejs/adapter-auto';
import adapterStatic from '@sveltejs/adapter-static';
import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

/**
 * Deployment targets (see docs/DEPLOYMENT.md):
 *   FKILL_ADAPTER=static      SPA build in `build/` — works on Vercel and Cloudflare Pages
 *   FKILL_ADAPTER=node        Node server (adapter-node)
 *   FKILL_ADAPTER=vercel      Vercel serverless/edge adapter
 *   FKILL_ADAPTER=cloudflare  Cloudflare Pages/Workers adapter
 *   (default: auto)
 *
 * Online multiplayer uses the separate authoritative relay in `server/` and is
 * independent of this adapter choice.
 */
function pickAdapter() {
	switch (process.env.FKILL_ADAPTER) {
		case 'static':
			return adapterStatic({ fallback: '200.html', strict: false });
		case 'node':
			return adapterNode();
		case 'vercel':
			return adapterVercel();
		case 'cloudflare':
			return adapterCloudflare();
		default:
			return adapterAuto();
	}
}

export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib')
		}
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: pickAdapter()
		})
	]
});
