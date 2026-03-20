import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSupabaseAdminClient,
  deterministicUuid,
  isUuid,
  loadLocalEnv,
  parseArgs,
  readJson,
} from './core-migration-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.resolve(__dirname, '../migration-data/base44-domain-export.json');

function normalizeRow(entityName, row = {}) {
  const now = new Date().toISOString();
  const next = {
    ...row,
    id: row.id || crypto.randomUUID(),
    created_date: row.created_date || row.created_at || now,
    updated_date: row.updated_date || row.updated_at || now,
  };

  if (entityName === 'ProjectResource' && next.project_id) {
    next.project_id = deterministicUuid('workspace', next.project_id);
  }

  if (entityName === 'CardResource' && next.card_id) {
    next.card_id = deterministicUuid('card', next.card_id);
  }

  return next;
}

async function upsertCompatRows(admin, rows) {
  if (!rows.length) return;
  const result = await admin
    .from('legacy_entity_records')
    .upsert(rows, { onConflict: 'entity_type,owner_user_id,record_id' });

  if (result.error) {
    throw new Error(`Failed to import compat rows: ${result.error.message}`);
  }
}

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const input = path.resolve(process.cwd(), args.input || DEFAULT_INPUT);
  const payload = await readJson(input);
  const userId = args['user-id'] || process.env.LIFEOS_MIGRATION_USER_ID || process.env.LIFEOS_DEV_USER_ID || '';

  if (!userId) {
    throw new Error('Missing --user-id, LIFEOS_MIGRATION_USER_ID, or LIFEOS_DEV_USER_ID for the import owner.');
  }
  if (!isUuid(userId)) {
    throw new Error('Import owner must be a valid Supabase auth user UUID.');
  }

  const admin = createSupabaseAdminClient();
  const imported = {};

  for (const [entityName, rows] of Object.entries(payload.entities || {})) {
    const compatRows = (Array.isArray(rows) ? rows : []).map((row) => {
      const normalized = normalizeRow(entityName, row);
      return {
        entity_type: entityName,
        owner_user_id: userId,
        record_id: normalized.id,
        data: normalized,
        updated_at: normalized.updated_date,
      };
    });

    await upsertCompatRows(admin, compatRows);
    imported[entityName] = compatRows.length;
  }

  console.log(JSON.stringify({ input, userId, imported }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
