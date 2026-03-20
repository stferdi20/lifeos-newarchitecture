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
const DEFAULT_OUTPUT = path.resolve(__dirname, '../migration-data/base44-core-export.json');

async function main() {
  await loadLocalEnv();
  const args = parseArgs();
  const output = path.resolve(process.cwd(), args.output || DEFAULT_OUTPUT);
  const client = createBase44MigrationClient();

  const modernWorkspaces = await safeEntityList(client, 'Workspace', 'position', 1000);
  let modernLists = await safeEntityList(client, 'WorkspaceList', 'position', 2000);
  if (!modernLists.length) {
    modernLists = await safeEntityList(client, 'List', 'position', 2000);
  }

  const modernCards = await safeEntityList(client, 'Card', '-created_date', 5000);
  const allTasks = await safeEntityList(client, 'Task', '-created_date', 5000);
  const modernComments = await safeEntityList(client, 'CardComment', '-created_date', 5000);
  const legacyProjects = await safeEntityList(client, 'Project', 'position', 1000);

  const payload = {
    exportedAt: new Date().toISOString(),
    modern: {
      workspaces: modernWorkspaces,
      lists: modernLists,
      cards: modernCards,
      tasks: allTasks,
      comments: modernComments,
    },
    legacy: {
      projects: legacyProjects,
      tasks: allTasks,
    },
  };

  await writeJson(output, payload);

  console.log(JSON.stringify({
    output,
    modern: {
      workspaces: modernWorkspaces.length,
      lists: modernLists.length,
      cards: modernCards.length,
      tasks: allTasks.length,
      comments: modernComments.length,
    },
    legacy: {
      projects: legacyProjects.length,
      tasks: allTasks.length,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
