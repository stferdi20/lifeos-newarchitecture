import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSupabaseAdminClient,
  isUuid,
  loadLocalEnv,
  parseArgs,
  readJson,
} from './core-migration-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.resolve(__dirname, '../migration-data/base44-domain-export.json');

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const input = path.resolve(process.cwd(), args.input || DEFAULT_INPUT);
  const payload = await readJson(input);
  const userId = args['user-id'] || process.env.LIFEOS_MIGRATION_USER_ID || process.env.LIFEOS_DEV_USER_ID || '';

  if (!userId) {
    throw new Error('Missing --user-id, LIFEOS_MIGRATION_USER_ID, or LIFEOS_DEV_USER_ID for verification.');
  }
  if (!isUuid(userId)) {
    throw new Error('Verification owner must be a valid Supabase auth user UUID.');
  }

  const admin = createSupabaseAdminClient();
  const verification = {};

  for (const [entityName, rows] of Object.entries(payload.entities || {})) {
    const expected = Array.isArray(rows) ? rows.length : 0;
    const result = await admin
      .from('legacy_entity_records')
      .select('*', { count: 'exact', head: true })
      .eq('owner_user_id', userId)
      .eq('entity_type', entityName);

    if (result.error) {
      throw new Error(`Failed to verify ${entityName}: ${result.error.message}`);
    }

    verification[entityName] = {
      expected,
      actual: result.count || 0,
      matches: expected === (result.count || 0),
    };
  }

  console.log(JSON.stringify({ input, userId, verification }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
