import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default tseslint.config(
	{
		ignores: [
			'.svelte-kit/**',
			'build/**',
			'.vercel/**',
			'node_modules/**',
			'server/dist/**',
			'static/**'
		]
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			'@typescript-eslint/no-explicit-any': 'off',
			// This project uses static, absolute route strings; resolve() adds no value
			// here and would obscure simple links such as /lobby?mode=solo.
			'svelte/no-navigation-without-resolve': 'off',
			'no-empty': ['error', { allowEmptyCatch: true }]
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: {
				parser: tseslint.parser
			}
		}
	},
	{
		files: ['scripts/**/*.mjs', 'server/**/*.mjs'],
		rules: {
			'@typescript-eslint/no-unused-vars': 'off'
		}
	}
);
