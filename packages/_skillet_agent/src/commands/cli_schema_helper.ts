// node imports
import Fs from 'node:fs';
import Path from 'node:path';
import { fileURLToPath } from 'node:url';

// npm imports
import { z as Zod } from 'zod';
import Chalk from 'chalk';

// local imports
import { SkilledCrewYamlConfigZod } from '../config/skilled_crew_yaml/skilled_crew_yaml_zod';

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

const __filename = fileURLToPath(import.meta.url);
const __dirname = Path.dirname(__filename);
const PACKAGE_ROOT = Path.resolve(__dirname, '..', '..');

type SchemaTarget = {
	sourceName: string;
	zodSchema: Zod.ZodType;
	outputPath: string;
};

const SCHEMA_TARGETS: SchemaTarget[] = [
	{
		sourceName: 'SkilledCrewYamlConfigZod',
		zodSchema: SkilledCrewYamlConfigZod,
		outputPath: Path.join(PACKAGE_ROOT, 'data', 'schemas', 'skilled_crew.schema.json'),
	},
];

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

export class CliSchemaHelper {

	static async generate(): Promise<void> {
		for (const target of SCHEMA_TARGETS) {
			const serialized = CliSchemaHelper.serializeSchema(target.zodSchema);
			const relativeOutputPath = Path.relative(process.cwd(), target.outputPath);

			await Fs.promises.mkdir(Path.dirname(target.outputPath), { recursive: true });
			await Fs.promises.writeFile(target.outputPath, serialized, 'utf8');

			console.log(`[${Chalk.cyan('schema_generate')}] wrote JSON schema to ${Chalk.gray(relativeOutputPath)}`);
		}
	}

	static async check(): Promise<void> {
		for (const target of SCHEMA_TARGETS) {
			await CliSchemaHelper.checkTarget(target);
		}
	}

	private static async checkTarget(target: SchemaTarget): Promise<void> {
		const expected = CliSchemaHelper.serializeSchema(target.zodSchema);
		const relativeOutputPath = Path.relative(process.cwd(), target.outputPath);

		let actual: string;
		try {
			actual = await Fs.promises.readFile(target.outputPath, 'utf8');
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				console.error(`[${Chalk.red('schema_check')}] schema file is missing at ${relativeOutputPath}`);
				console.error(`[${Chalk.red('schema_check')}] run ${Chalk.cyan('npm run schema:generate')} to create it`);
				process.exitCode = 1;
				return;
			}
			throw error;
		}

		if (actual === expected) {
			console.log(`[${Chalk.cyan('schema_check')}] ${Chalk.green('ok')} - ${relativeOutputPath} is in sync with ${target.sourceName}`);
			return;
		}

		console.error(`[${Chalk.red('schema_check')}] ${relativeOutputPath} is out of sync with ${target.sourceName}`);
		console.error(`[${Chalk.red('schema_check')}] run ${Chalk.cyan('npm run schema:generate')} and commit the result`);
		process.exitCode = 1;
	}

	private static serializeSchema(zodSchema: Zod.ZodType): string {
		// io: 'input' so fields with .default() are treated as optional in the JSON schema
		// (matches what an author writes in the YAML — defaults are filled in by the runtime)
		const jsonSchema = Zod.toJSONSchema(zodSchema, { io: 'input' });
		return JSON.stringify(jsonSchema, null, '\t') + '\n';
	}
}
