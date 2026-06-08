import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function* walkMdx(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkMdx(path);
			continue;
		}
		if (entry.name.endsWith('.mdx') === true) yield path;
	}
}

async function main() {
	const root = './content/api';
	for await (const file of walkMdx(root)) {
		const before = await readFile(file, 'utf8');
		const after = before.replace(/\.mdx(\)|#)/g, '$1');
		if (after !== before) await writeFile(file, after);
	}
	await writeFile(join(root, '.gitkeep'), '');
}

await main();
