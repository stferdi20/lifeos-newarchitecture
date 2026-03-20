const STATUS_TO_LIST = {
  todo: 'To Do',
  doing: 'Doing',
  done: 'Done',
  archived: 'Archived',
};

const MIGRATION_VERSION = 'kanban_v2_migration_v1';

const countAttachments = (items = []) =>
  (items || []).reduce((acc, item) => acc + ((item.attached_files || []).length), 0);

const byId = (items = []) => Object.fromEntries((items || []).map(item => [item.id, item]));

const normalizeStatus = (status) => STATUS_TO_LIST[status] ? status : 'todo';

const getMigrationState = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(MIGRATION_VERSION);
};

const setMigrationState = (state) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MIGRATION_VERSION, state);
};

const workspaceKeyForCategory = (categoryId) => `category:${categoryId}`;
const workspaceKeyForProject = (projectId) => `project:${projectId}`;

const deriveWorkspaceCandidates = ({ task, project }) => {
  if (project?.category_id) return [workspaceKeyForCategory(project.category_id), workspaceKeyForProject(project.id)];
  if (project?.id) return [workspaceKeyForProject(project.id)];
  return ['uncategorized'];
};

const workspaceNameForKey = (workspaceKey, categoriesById, projectsById) => {
  if (workspaceKey.startsWith('category:')) {
    const categoryId = workspaceKey.replace('category:', '');
    return categoriesById[categoryId]?.name || 'Imported Category';
  }
  if (workspaceKey.startsWith('project:')) {
    const projectId = workspaceKey.replace('project:', '');
    return projectsById[projectId]?.name || 'Imported Project';
  }
  return 'General Workspace';
};

const workspaceDriveFolderForKey = (workspaceKey, categoriesById, projectsById) => {
  if (workspaceKey.startsWith('category:')) {
    const categoryId = workspaceKey.replace('category:', '');
    return categoriesById[categoryId]?.drive_folder_id || '';
  }
  if (workspaceKey.startsWith('project:')) {
    const projectId = workspaceKey.replace('project:', '');
    return projectsById[projectId]?.drive_folder_id || '';
  }
  return '';
};

export async function migrateKanbanV2(options = {}) {
  const { dryRun = false } = options;
  const workspaces = await listBoardWorkspaces();
  const [tasks, categories, nestedLists, nestedCards] = await Promise.all([
    listStandaloneTaskRecords(),
    ProjectCategory.list('sort_order', 500),
    Promise.all(workspaces.map((workspace) => listBoardLists(workspace.id))),
    Promise.all(workspaces.map((workspace) => listBoardCards(workspace.id))),
  ]);

  const projects = [];
  const lists = nestedLists.flat();
  const cards = nestedCards.flat();

  const projectsById = byId(projects);
  const categoriesById = byId(categories);

  const report = {
    dryRun,
    pre: {
      tasks: tasks.length,
      attachments: countAttachments(tasks),
    },
    created: {
      workspaces: 0,
      lists: 0,
      cards: 0,
    },
    checks: {
      cardCountsMatch: false,
      attachmentCountsMatch: false,
      driveFolderConsistency: false,
      all: false,
    },
  };

  const workspaceByLegacyKey = new Map();
  for (const workspace of workspaces) {
    if (workspace.legacy_workspace_key) workspaceByLegacyKey.set(workspace.legacy_workspace_key, workspace);
  }

  const listByWorkspaceAndStatus = new Map();
  for (const list of lists) {
    if (list.workspace_id && list.legacy_status) listByWorkspaceAndStatus.set(`${list.workspace_id}:${list.legacy_status}`, list);
  }

  const cardByLegacyTaskId = new Map();
  for (const card of cards) {
    if (card.legacy_task_id) cardByLegacyTaskId.set(card.legacy_task_id, card);
  }

  const ensureWorkspace = async (legacyWorkspaceKey) => {
    const existing = workspaceByLegacyKey.get(legacyWorkspaceKey);
    if (existing) return existing;

    const payload = {
      name: workspaceNameForKey(legacyWorkspaceKey, categoriesById, projectsById),
      legacy_workspace_key: legacyWorkspaceKey,
      drive_folder_id: workspaceDriveFolderForKey(legacyWorkspaceKey, categoriesById, projectsById),
    };

    if (dryRun) {
      const stub = { ...payload, id: `dry-${legacyWorkspaceKey}` };
      workspaceByLegacyKey.set(legacyWorkspaceKey, stub);
      report.created.workspaces += 1;
      return stub;
    }

    const created = await createBoardWorkspace(payload);
    workspaceByLegacyKey.set(legacyWorkspaceKey, created);
    report.created.workspaces += 1;
    return created;
  };

  const ensureStatusLists = async (workspace) => {
    for (const [status, listName] of Object.entries(STATUS_TO_LIST)) {
      const listKey = `${workspace.id}:${status}`;
      if (listByWorkspaceAndStatus.has(listKey)) continue;

      const payload = {
        workspace_id: workspace.id,
        name: listName,
        legacy_status: status,
      };

      if (dryRun) {
        listByWorkspaceAndStatus.set(listKey, { ...payload, id: `dry-${listKey}` });
        report.created.lists += 1;
        continue;
      }

      const created = await createBoardList(payload);
      listByWorkspaceAndStatus.set(listKey, created);
      report.created.lists += 1;
    }
  };

  // Ensure all categories/projects are migrated even with zero tasks.
  for (const category of categories) {
    const workspace = await ensureWorkspace(workspaceKeyForCategory(category.id));
    await ensureStatusLists(workspace);
  }
  for (const project of projects) {
    const workspace = await ensureWorkspace(workspaceKeyForProject(project.id));
    await ensureStatusLists(workspace);
  }
  const defaultWorkspace = await ensureWorkspace('uncategorized');
  await ensureStatusLists(defaultWorkspace);

  for (const task of tasks) {
    if (cardByLegacyTaskId.has(task.id)) continue;

    const project = task.project_id ? projectsById[task.project_id] : null;
    const [primaryWorkspaceKey] = deriveWorkspaceCandidates({ task, project });
    const workspace = await ensureWorkspace(primaryWorkspaceKey);
    await ensureStatusLists(workspace);

    const taskStatus = normalizeStatus(task.status);
    const list = listByWorkspaceAndStatus.get(`${workspace.id}:${taskStatus}`);

    const payload = {
      title: task.title,
      description: task.description,
      workspace_id: workspace.id,
      list_id: list?.id,
      legacy_task_id: task.id,
      legacy_project_id: task.project_id || '',
      priority: task.priority || 'medium',
      due_date: task.due_date || '',
      start_date: task.start_date || '',
      checklist: task.checklist || [],
      attached_files: task.attached_files || [],
      sort_order: task.sort_order ?? 0,
      drive_folder_id: task.drive_folder_id || project?.drive_folder_id || workspace.drive_folder_id || '',
    };

    if (dryRun) {
      cardByLegacyTaskId.set(task.id, { ...payload, id: `dry-card-${task.id}` });
      report.created.cards += 1;
      continue;
    }

    const created = await createBoardCard(payload);
    cardByLegacyTaskId.set(task.id, created);
    report.created.cards += 1;
  }

  const migratedCards = Array.from(cardByLegacyTaskId.values());
  const postCards = migratedCards.length;
  const postAttachments = countAttachments(migratedCards);

  let driveMatches = 0;
  for (const task of tasks) {
    const migratedCard = cardByLegacyTaskId.get(task.id);
    if (!migratedCard) continue;
    const project = task.project_id ? projectsById[task.project_id] : null;
    const expectedDriveFolderId = task.drive_folder_id || project?.drive_folder_id || '';
    if ((migratedCard.drive_folder_id || '') === expectedDriveFolderId) driveMatches += 1;
  }

  report.post = {
    cards: postCards,
    attachments: postAttachments,
    driveConsistencyMatches: driveMatches,
    driveConsistencyTotal: tasks.length,
  };

  report.checks.cardCountsMatch = report.pre.tasks === report.post.cards;
  report.checks.attachmentCountsMatch = report.pre.attachments === report.post.attachments;
  report.checks.driveFolderConsistency = report.post.driveConsistencyMatches === report.post.driveConsistencyTotal;
  report.checks.all = report.checks.cardCountsMatch && report.checks.attachmentCountsMatch && report.checks.driveFolderConsistency;

  if (!dryRun) {
    setMigrationState(report.checks.all ? 'verified' : 'failed');
  }

  return report;
}

export function getKanbanV2MigrationState() {
  return getMigrationState();
}
import {
  createBoardCard,
  createBoardList,
  createBoardWorkspace,
  listBoardCards,
  listBoardLists,
  listBoardWorkspaces,
} from '@/lib/projects-api';
import { ProjectCategory } from '@/lib/project-categories-api';
import { listStandaloneTaskRecords } from '@/lib/tasks';
