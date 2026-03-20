import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBase44MigrationClient,
  loadLocalEnv,
  parseArgs,
  safeEntityList,
  writeJson,
} from './core-migration-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.resolve(__dirname, '../migration-data/base44-domain-export.json');
const DOMAIN_ENTITIES = [
  'Habit',
  'HabitLog',
  'Resource',
  'LifeArea',
  'ProjectResource',
  'CardResource',
  'PromptTemplate',
  'Investment',
  'MediaEntry',
  'CreatorInspo',
  'Note',
  'Tool',
  'EventTemplate',
  'ProjectCategory',
];

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const output = path.resolve(process.cwd(), args.output || DEFAULT_OUTPUT);
  const client = createBase44MigrationClient();

  const entities = {};
  const counts = {};

  for (const entityName of DOMAIN_ENTITIES) {
    const rows = await safeEntityList(client, entityName, '-created_date', 5000);
    entities[entityName] = rows;
    counts[entityName] = rows.length;
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    entities,
  };

  await writeJson(output, payload);
  console.log(JSON.stringify({ output, counts }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
