import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSupabaseAdminClient,
  inferLegacyListKey,
  isStandaloneTaskRecord,
  isUuid,
  loadLocalEnv,
  parseArgs,
  readJson,
} from './core-migration-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.resolve(__dirname, '../migration-data/base44-core-export.json');

function resolveMode(payload, requestedMode) {
  if (requestedMode && requestedMode !== 'auto') return requestedMode;
  const hasModernData = Boolean(
    payload?.modern?.workspaces?.length
    || payload?.modern?.lists?.length
    || payload?.modern?.cards?.length,
  );
  return hasModernData ? 'modern' : 'legacy';
}

async function fetchCount(admin, table, configure = (query) => query) {
  const query = configure(
    admin
      .from(table)
      .select('*', { count: 'exact', head: true }),
  );
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count || 0;
}

async function fetchWorkspaceIds(admin, userId) {
  const { data, error } = await admin
    .from('workspaces')
    .select('id')
    .eq('owner_user_id', userId);

  if (error) {
    throw new Error(error.message);
  }

  return (data || []).map((row) => row.id);
}

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const input = path.resolve(process.cwd(), args.input || DEFAULT_INPUT);
  const payload = await readJson(input);
  const mode = resolveMode(payload, args.mode || 'auto');
  const userId = args['user-id'] || process.env.LIFEOS_MIGRATION_USER_ID || process.env.LIFEOS_DEV_USER_ID || '';

  if (!userId) {
    throw new Error('Missing --user-id, LIFEOS_MIGRATION_USER_ID, or LIFEOS_DEV_USER_ID for verification.');
  }
  if (!isUuid(userId)) {
    throw new Error('Verification user id must be a valid Supabase auth user UUID.');
  }

  const admin = createSupabaseAdminClient();
  const workspaceIds = await fetchWorkspaceIds(admin, userId);
  const workspaceScope = workspaceIds.length
    ? workspaceIds
    : ['00000000-0000-0000-0000-000000000000'];

  const expected = mode === 'modern'
    ? {
      workspaces: payload.modern?.workspaces?.length || 0,
      lists: payload.modern?.lists?.length || 0,
      cards: payload.modern?.cards?.length || 0,
      tasks: (payload.modern?.tasks || []).filter(isStandaloneTaskRecord).length,
      comments: payload.modern?.comments?.length || 0,
    }
    : {
      workspaces: payload.legacy?.projects?.length || 0,
      lists: (payload.legacy?.projects?.length || 0) * 4,
      cards: (payload.legacy?.tasks || []).filter((task) => Boolean(task.project_id || task.workspace_id)).length,
      tasks: 0,
      comments: 0,
    };

  const actual = {
    workspaces: await fetchCount(admin, 'workspaces', (query) => query.eq('owner_user_id', userId)),
    lists: await fetchCount(
      admin,
      'lists',
      (query) => query.in('workspace_id', workspaceScope),
    ),
    cards: await fetchCount(
      admin,
      'cards',
      (query) => query.in('workspace_id', workspaceScope),
    ),
    tasks: await fetchCount(admin, 'tasks', (query) => query.eq('owner_user_id', userId)),
    comments: await fetchCount(
      admin,
      'comments',
      (query) => query.in('workspace_id', workspaceScope),
    ),
  };

  const legacyDistribution = mode === 'legacy'
    ? Object.fromEntries(
      ['todo', 'doing', 'done', 'archived'].map((status) => [
        status,
        (payload.legacy?.tasks || []).filter((task) => inferLegacyListKey(task) === status).length,
      ]),
    )
    : null;

  console.log(JSON.stringify({
    input,
    mode,
    userId,
    expected,
    actual,
    delta: {
      workspaces: actual.workspaces - expected.workspaces,
      lists: actual.lists - expected.lists,
      cards: actual.cards - expected.cards,
      tasks: actual.tasks - expected.tasks,
      comments: actual.comments - expected.comments,
    },
    legacyDistribution,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
