import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

type Operation = 'sync_missing' | 'repair_links' | 'cleanup_orphans';

type Summary = {
  operation: Operation;
  hierarchy: string;
  compatibilityMapping: string;
  scanned: number;
  created: number;
  linked: number;
  skipped: number;
  errors: string[];
};

type DriveFile = {
  id: string;
  name: string;
  trashed?: boolean;
};

const activeJobs = new Map<string, number>();
const LOCK_TTL_MS = 10 * 60 * 1000;

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const ROOT_FOLDER_NAME = 'Life OS';
const PROJECTS_FOLDER_NAME = 'Projects';

const resolveOperation = (value: unknown): Operation => {
  if (value === 'repair_links') return 'repair_links';
  if (value === 'cleanup_orphans') return 'cleanup_orphans';
  return 'sync_missing';
};

const normalizeName = (value: string | undefined, fallback: string) => {
  const trimmed = (value || '').trim();
  return trimmed.length ? trimmed : fallback;
};

const encodeDriveQuery = (query: string) => encodeURIComponent(query);

const driveListFolders = async (accessToken: string, query: string): Promise<DriveFile[]> => {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,trashed)&q=${encodeDriveQuery(query)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive search failed (${res.status}): ${body}`);
  }

  const payload = await res.json();
  return payload.files || [];
};

const driveCreateFolder = async (accessToken: string, name: string, parents?: string[]): Promise<DriveFile> => {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME_TYPE,
      ...(parents?.length ? { parents } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive folder create failed (${res.status}): ${body}`);
  }

  return res.json();
};

const driveTrashFile = async (accessToken: string, fileId: string) => {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ trashed: true }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive trash failed (${res.status}): ${body}`);
  }
};

const findOrCreateFolder = async (
  accessToken: string,
  summary: Summary,
  name: string,
  parentId?: string,
) => {
  const query = parentId
    ? `name='${name.replaceAll("'", "\\'")}' and mimeType='${FOLDER_MIME_TYPE}' and '${parentId}' in parents and trashed=false`
    : `name='${name.replaceAll("'", "\\'")}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
  const existing = await driveListFolders(accessToken, query);
  if (existing.length > 0) {
    summary.skipped += 1;
    return existing[0].id;
  }

  const created = await driveCreateFolder(accessToken, name, parentId ? [parentId] : undefined);
  summary.created += 1;
  return created.id;
};

Deno.serve(async (req) => {
  const now = Date.now();
  let lockKey = '';

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const operation = resolveOperation(body?.operation);
    const workspaceIdFilter = typeof body?.workspaceId === 'string' && body.workspaceId ? body.workspaceId : '';
    const allowCleanup = Boolean(body?.allowCleanup);

    if (operation === 'cleanup_orphans' && !allowCleanup) {
      return Response.json({ error: 'Cleanup requires explicit allowCleanup=true.' }, { status: 400 });
    }

    lockKey = `${user.id}:${workspaceIdFilter || 'all'}`;
    const lockTimestamp = activeJobs.get(lockKey);
    if (lockTimestamp && now - lockTimestamp < LOCK_TTL_MS) {
      return Response.json(
        { error: 'A Drive sync job is already running for this workspace.', code: 'JOB_ALREADY_RUNNING' },
        { status: 409 },
      );
    }

    activeJobs.set(lockKey, now);

    const summary: Summary = {
      operation,
      hierarchy: 'Life OS / Projects / Workspace / List / Card',
      compatibilityMapping:
        'Uses Workspace + WorkspaceList + Card. Falls back to Project + Task if workspace entities are unavailable, mapping Project→Workspace and Task→Card.',
      scanned: 0,
      created: 0,
      linked: 0,
      skipped: 0,
      errors: [],
    };

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const lifeOSFolderId = await findOrCreateFolder(accessToken, summary, ROOT_FOLDER_NAME);
    const projectsFolderId = await findOrCreateFolder(accessToken, summary, PROJECTS_FOLDER_NAME, lifeOSFolderId);

    let workspaces = [] as any[];
    let lists = [] as any[];
    let cards = [] as any[];

    try {
      workspaces = await base44.entities.Workspace.list();
      lists = await base44.entities.WorkspaceList.list();
      cards = await base44.entities.Card.list();
    } catch {
      const projects = await base44.entities.Project.list();
      const tasks = await base44.entities.Task.list();
      workspaces = projects.map((p: any, index: number) => ({
        id: p.id,
        name: p.name,
        position: p.position ?? index,
        drive_folder_id: p.drive_folder_id,
      }));
      lists = [];
      cards = tasks.map((t: any) => ({
        ...t,
        workspace_id: t.project_id,
      }));
    }

    const listsByWorkspace = new Map<string, any[]>();
    const cardsByList = new Map<string, any[]>();
    const cardsByWorkspace = new Map<string, any[]>();

    for (const list of lists) {
      if (!list.workspace_id) continue;
      const current = listsByWorkspace.get(list.workspace_id) || [];
      current.push(list);
      listsByWorkspace.set(list.workspace_id, current);
    }

    for (const card of cards) {
      if (card.list_id) {
        const current = cardsByList.get(card.list_id) || [];
        current.push(card);
        cardsByList.set(card.list_id, current);
      }
      if (card.workspace_id) {
        const current = cardsByWorkspace.get(card.workspace_id) || [];
        current.push(card);
        cardsByWorkspace.set(card.workspace_id, current);
      }
    }

    const targetWorkspaces = workspaceIdFilter
      ? workspaces.filter((workspace: any) => workspace.id === workspaceIdFilter)
      : workspaces;

    for (const workspace of targetWorkspaces) {
      summary.scanned += 1;

      const workspaceName = normalizeName(workspace.name, `Workspace ${workspace.id}`);
      const workspaceFolderId = await findOrCreateFolder(accessToken, summary, workspaceName, projectsFolderId);

      if (!workspace.drive_folder_id || operation === 'repair_links') {
        try {
          if (base44.entities.Workspace?.update) {
            await base44.entities.Workspace.update(workspace.id, { drive_folder_id: workspaceFolderId });
          } else if (base44.entities.Project?.update) {
            await base44.entities.Project.update(workspace.id, { drive_folder_id: workspaceFolderId });
          }
          summary.linked += 1;
        } catch (error) {
          summary.errors.push(`Workspace ${workspaceName}: ${(error as Error).message}`);
        }
      }

      const workspaceLists = (listsByWorkspace.get(workspace.id) || []).sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0)
      );

      if (!workspaceLists.length) {
        const workspaceCards = cardsByWorkspace.get(workspace.id) || [];
        for (const card of workspaceCards) {
          summary.scanned += 1;
          const cardName = normalizeName(card.title || card.name, `Card ${card.id}`);
          const cardFolderId = await findOrCreateFolder(accessToken, summary, cardName, workspaceFolderId);

          if (!card.drive_folder_id || operation === 'repair_links') {
            try {
              if (base44.entities.Card?.update) {
                await base44.entities.Card.update(card.id, { drive_folder_id: cardFolderId });
              } else if (base44.entities.Task?.update) {
                await base44.entities.Task.update(card.id, { drive_folder_id: cardFolderId });
              }
              summary.linked += 1;
            } catch (error) {
              summary.errors.push(`Card ${cardName}: ${(error as Error).message}`);
            }
          }
        }
        continue;
      }

      for (const list of workspaceLists) {
        summary.scanned += 1;

        const listName = normalizeName(list.name, `List ${list.id}`);
        const listFolderId = await findOrCreateFolder(accessToken, summary, listName, workspaceFolderId);

        if ((!list.drive_folder_id || operation === 'repair_links') && base44.entities.WorkspaceList?.update) {
          try {
            await base44.entities.WorkspaceList.update(list.id, { drive_folder_id: listFolderId });
            summary.linked += 1;
          } catch (error) {
            summary.errors.push(`List ${listName}: ${(error as Error).message}`);
          }
        }

        const listCards = (cardsByList.get(list.id) || []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        for (const card of listCards) {
          summary.scanned += 1;

          const cardName = normalizeName(card.title || card.name, `Card ${card.id}`);
          const cardFolderId = await findOrCreateFolder(accessToken, summary, cardName, listFolderId);

          if (!card.drive_folder_id || operation === 'repair_links') {
            try {
              if (base44.entities.Card?.update) {
                await base44.entities.Card.update(card.id, { drive_folder_id: cardFolderId });
              } else if (base44.entities.Task?.update) {
                await base44.entities.Task.update(card.id, { drive_folder_id: cardFolderId });
              }
              summary.linked += 1;
            } catch (error) {
              summary.errors.push(`Card ${cardName}: ${(error as Error).message}`);
            }
          }
        }

        if (operation === 'cleanup_orphans') {
          try {
            const driveFolders = await driveListFolders(
              accessToken,
              `'${listFolderId}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`
            );
            const expectedNames = new Set(listCards.map((card) => normalizeName(card.title || card.name, `Card ${card.id}`)));

            for (const folder of driveFolders) {
              if (!expectedNames.has(folder.name)) {
                await driveTrashFile(accessToken, folder.id);
              }
            }
          } catch (error) {
            summary.errors.push(`Cleanup in list ${listName}: ${(error as Error).message}`);
          }
        }
      }
    }

    return Response.json({
      success: true,
      lifeOSFolderId,
      projectsFolderId,
      summary,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  } finally {
    if (lockKey) activeJobs.delete(lockKey);
  }
});
