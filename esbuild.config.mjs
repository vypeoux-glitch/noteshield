import esbuild from 'esbuild';
import process from 'node:process';
import { builtinModules } from 'node:module';

const production = process.argv[2] === 'production';

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
	format: 'cjs',
	target: 'es2022',
	logLevel: 'info',
	sourcemap: production ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: production,
});

if (production) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
