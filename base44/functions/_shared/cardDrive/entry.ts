const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const GOOGLE_DOCS_API = 'https://docs.googleapis.com/v1/documents';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT_FOLDER = 'Life OS';
const PROJECTS_FOLDER = 'Projects';

export const GOOGLE_MIME_TYPES = {
  docs: 'application/vnd.google-apps.document',
  sheets: 'application/vnd.google-apps.spreadsheet',
  slides: 'application/vnd.google-apps.presentation',
};

export const GOOGLE_FILE_LINKS = {
  docs: (id: string) => `https://docs.google.com/document/d/${id}/edit`,
  sheets: (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`,
  slides: (id: string) => `https://docs.google.com/presentation/d/${id}/edit`,
};

export const GOOGLE_FILE_TYPES = {
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
};

export const DOC_TEMPLATES = {
  project_brief: {
    label: 'Project Brief',
    prompt: (task: any, project: any) => `Write a professional project brief document for the following:\nProject: ${project?.name || 'N/A'}\nTask: ${task.title}\nDescription: ${task.description || 'N/A'}\n\nInclude these sections: Executive Summary, Objectives, Scope, Timeline, Key Deliverables, and Next Steps.\nWrite in a clear, professional tone. Use markdown headers (# for h1, ## for h2) for section titles.`,
  },
  meeting_notes: {
    label: 'Meeting Notes',
    prompt: (task: any, project: any) => `Create a meeting notes template document for:\nProject: ${project?.name || 'N/A'}\nTopic: ${task.title}\nContext: ${task.description || 'N/A'}\n\nInclude these sections: Meeting Details (Date, Attendees, Duration), Agenda Items, Discussion Points, Decisions Made, Action Items, and Next Meeting.\nPre-fill relevant context from the task info. Use markdown headers.`,
  },
  research_doc: {
    label: 'Research Document',
    prompt: (task: any, project: any) => `Create a research document for:\nProject: ${project?.name || 'N/A'}\nTopic: ${task.title}\nContext: ${task.description || 'N/A'}\n\nInclude these sections: Research Objective, Background, Key Findings, Analysis, Conclusions, and References.\nPre-fill with relevant structure based on the task. Use markdown headers.`,
  },
  task_plan: {
    label: 'Task Plan',
    prompt: (task: any, project: any) => `Create a detailed task execution plan for:\nProject: ${project?.name || 'N/A'}\nTask: ${task.title}\nDescription: ${task.description || 'N/A'}\nPriority: ${task.priority || 'medium'}\nDue Date: ${task.due_date || 'Not set'}\n\nInclude: Overview, Requirements, Step-by-step Plan, Resources Needed, Risk Assessment, and Success Criteria.\nUse markdown headers.`,
  },
};

export function escapeDrive(value: string) {
  return String(value || '').replace(/'/g, "\\'");
}

export function mapFileType(fileName = '', mimeType = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === GOOGLE_MIME_TYPES.docs) return 'gdoc';
  if (mimeType === GOOGLE_MIME_TYPES.sheets) return 'gsheet';
  if (mimeType === GOOGLE_MIME_TYPES.slides) return 'gslide';
  const ext = String(fileName).split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: 'pdf',
    doc: 'docx',
    docx: 'docx',
    xls: 'xlsx',
    xlsx: 'xlsx',
    ppt: 'pptx',
    pptx: 'pptx',
  };
  return map[ext || ''] || 'file';
}

export async function driveRequest(accessToken: string, path = '', init: RequestInit = {}) {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body instanceof Blob || init.body instanceof Uint8Array ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers || {}),
    },
  });

  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`Drive API error ${res.status}: ${body}`);
  }

  if (res.status === 404 || res.status === 204) return null;
  return res.json();
}

export async function driveRaw(accessToken: string, url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });
}

export async function getDriveItem(accessToken: string, itemId: string) {
  if (!itemId) return null;
  return driveRequest(accessToken, `/${itemId}?fields=id,name,mimeType,parents,trashed,webViewLink,webContentLink,size,modifiedTime,iconLink,thumbnailLink&supportsAllDrives=true`);
}

export async function findFolder(accessToken: string, name: string, parentId?: string) {
  const predicates = [`name='${escapeDrive(name)}'`, `mimeType='${FOLDER_MIME}'`, 'trashed=false'];
  if (parentId) predicates.push(`'${parentId}' in parents`);
  const query = encodeURIComponent(predicates.join(' and '));
  const data = await driveRequest(accessToken, `?q=${query}&fields=files(id,name,parents,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return data?.files?.[0] || null;
}

export async function createFolder(accessToken: string, name: string, parentId?: string) {
  return driveRequest(accessToken, '?supportsAllDrives=true&fields=id,name,mimeType,parents,webViewLink', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
}

export async function ensureFolder(accessToken: string, name: string, parentId?: string, existingId?: string | null) {
  if (existingId) {
    const existing = await getDriveItem(accessToken, existingId).catch(() => null);
    if (existing && !existing.trashed) return existing;
  }
  const found = await findFolder(accessToken, name, parentId);
  if (found) return found;
  return createFolder(accessToken, name, parentId);
}

export async function findFile(accessToken: string, name: string, parentId?: string) {
  const predicates = [`name='${escapeDrive(name)}'`, `mimeType!='${FOLDER_MIME}'`, 'trashed=false'];
  if (parentId) predicates.push(`'${parentId}' in parents`);
  const query = encodeURIComponent(predicates.join(' and '));
  const data = await driveRequest(accessToken, `?q=${query}&fields=files(id,name,mimeType,parents,webViewLink,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return data?.files?.[0] || null;
}

export function getListEntityName(base44: any) {
  if (base44.entities?.WorkspaceList?.get) return 'WorkspaceList';
  if (base44.entities?.List?.get) return 'List';
  return null;
}

export async function getCardRecord(base44: any, cardId: string) {
  let entity = 'Card';
  let card = await base44.entities?.Card?.get?.(cardId).catch(() => null);
  if (!card) {
    entity = 'Task';
    card = await base44.entities?.Task?.get?.(cardId).catch(() => null);
  }
  if (!card) return null;
  return { entity, card };
}

export async function getCardContext(base44: any, cardIdOrCard: string | any) {
  const resolved = typeof cardIdOrCard === 'string'
    ? await getCardRecord(base44, cardIdOrCard)
    : { entity: base44.entities?.Card?.get ? 'Card' : 'Task', card: cardIdOrCard };

  if (!resolved?.card) return null;

  const { entity, card } = resolved;
  const listEntity = getListEntityName(base44);
  const list = card.list_id && listEntity ? await base44.entities[listEntity].get(card.list_id).catch(() => null) : null;

  const workspace = card.workspace_id && base44.entities?.Workspace?.get
    ? await base44.entities.Workspace.get(card.workspace_id).catch(() => null)
    : (list?.workspace_id && base44.entities?.Workspace?.get
      ? await base44.entities.Workspace.get(list.workspace_id).catch(() => null)
      : null);

  const project = card.project_id && base44.entities?.Project?.get
    ? await base44.entities.Project.get(card.project_id).catch(() => null)
    : null;

  const workspaceRecord = workspace || project || null;
  const workspaceEntity = workspace ? 'Workspace' : (project ? 'Project' : null);
  const workspaceName = workspace?.name || project?.name || card.workspace_name || 'Workspace';
  const listName = list?.name || null;
  const cardName = card.title || card.name || `Card ${card.id}`;

  return {
    entity,
    card,
    listEntity,
    list,
    workspaceEntity,
    workspaceRecord,
    project,
    workspaceName,
    listName,
    cardName,
  };
}

export async function ensureCardDriveFolder(base44: any, accessToken: string, cardIdOrContext: string | any) {
  const context = typeof cardIdOrContext === 'string' || !cardIdOrContext?.card
    ? await getCardContext(base44, cardIdOrContext)
    : cardIdOrContext;

  if (!context?.card) throw new Error('Card not found');

  const lifeOS = await ensureFolder(accessToken, ROOT_FOLDER);
  const projects = await ensureFolder(accessToken, PROJECTS_FOLDER, lifeOS.id);
  const workspaceFolder = await ensureFolder(
    accessToken,
    context.workspaceName,
    projects.id,
    context.workspaceRecord?.drive_folder_id || null,
  );

  let listFolder = null;
  if (context.listName) {
    listFolder = await ensureFolder(
      accessToken,
      context.listName,
      workspaceFolder.id,
      context.list?.drive_folder_id || null,
    );
  }

  const cardFolder = await ensureFolder(
    accessToken,
    context.cardName,
    listFolder?.id || workspaceFolder.id,
    context.card.drive_folder_id || null,
  );

  if (context.entity === 'Card' && base44.entities?.Card?.update) {
    await base44.entities.Card.update(context.card.id, { drive_folder_id: cardFolder.id }).catch(() => null);
  } else if (base44.entities?.Task?.update) {
    await base44.entities.Task.update(context.card.id, { drive_folder_id: cardFolder.id }).catch(() => null);
  }

  if (listFolder && context.list?.id && context.listEntity && base44.entities?.[context.listEntity]?.update) {
    await base44.entities[context.listEntity].update(context.list.id, { drive_folder_id: listFolder.id }).catch(() => null);
  }

  if (context.workspaceRecord?.id && context.workspaceEntity && base44.entities?.[context.workspaceEntity]?.update) {
    if (context.workspaceRecord.drive_folder_id !== workspaceFolder.id) {
      await base44.entities[context.workspaceEntity].update(context.workspaceRecord.id, { drive_folder_id: workspaceFolder.id }).catch(() => null);
    }
  }

  return {
    folderId: cardFolder.id,
    folderLabel: [context.workspaceName, context.listName, context.cardName].filter(Boolean).join(' / '),
    folderUrl: `https://drive.google.com/drive/folders/${cardFolder.id}`,
    workspaceFolderId: workspaceFolder.id,
    listFolderId: listFolder?.id || null,
  };
}

export async function listDriveFolderChildren(accessToken: string, parentId: string) {
  const query = encodeURIComponent(`'${parentId}' in parents and trashed=false`);
  const data = await driveRequest(
    accessToken,
    `?q=${query}&fields=files(id,name,mimeType,size,modifiedTime,parents,webViewLink,webContentLink,iconLink,thumbnailLink)&orderBy=folder,name_natural&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=200`,
  );
  return data?.files || [];
}

export function normalizeDriveItem(item: any, parentId: string | null = null) {
  const isFolder = item.mimeType === FOLDER_MIME;
  const url = isFolder
    ? `https://drive.google.com/drive/folders/${item.id}`
    : item.webViewLink || item.webContentLink || `https://drive.google.com/file/d/${item.id}/view`;

  return {
    id: item.id,
    driveId: item.id,
    kind: isFolder ? 'drive_folder' : 'drive_file',
    name: item.name,
    url,
    mimeType: item.mimeType,
    size: item.size != null ? Number(item.size) : null,
    modifiedAt: item.modifiedTime || null,
    parentId,
    children: [],
    provider: 'google_drive',
    isExternalLink: false,
    iconLink: item.iconLink || null,
    thumbnailLink: item.thumbnailLink || null,
    webViewLink: item.webViewLink || url,
  };
}

export function normalizeAttachmentLink(attachment: any) {
  return {
    id: attachment.id || `link-${crypto.randomUUID()}`,
    driveId: attachment.drive_file_id || null,
    kind: attachment.drive_file_id ? 'drive_file' : 'link',
    name: attachment.name || attachment.url || 'Untitled attachment',
    url: attachment.webViewLink || attachment.url,
    mimeType: attachment.mimeType || null,
    size: attachment.size ?? null,
    modifiedAt: attachment.updated_at || attachment.created_at || attachment.created_date || null,
    parentId: null,
    children: [],
    provider: attachment.provider || (attachment.type === 'link' ? 'link' : 'google_drive'),
    isExternalLink: !attachment.drive_file_id,
    file_type: attachment.file_type || null,
    folder_id: attachment.folder_id || null,
    folder_label: attachment.folder_label || null,
    webViewLink: attachment.webViewLink || attachment.url || null,
    isLegacyMetadata: true,
  };
}

export function sortNormalizedItems(items: any[]) {
  return [...items].sort((a, b) => {
    const rank = { drive_folder: 0, drive_file: 1, link: 2 };
    const rankDiff = (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

export async function buildDriveTree(accessToken: string, folderId: string, parentId: string | null = null) {
  const items = await listDriveFolderChildren(accessToken, folderId);
  const nodes = [];
  const driveIds = new Set<string>();

  for (const item of items) {
    const node = normalizeDriveItem(item, parentId);
    driveIds.add(item.id);
    if (node.kind === 'drive_folder') {
      const subtree = await buildDriveTree(accessToken, item.id, item.id);
      node.children = subtree.itemsTree;
      subtree.driveIds.forEach((id) => driveIds.add(id));
    }
    nodes.push(node);
  }

  return { itemsTree: sortNormalizedItems(nodes), driveIds };
}

export function flattenTree(items: any[]) {
  const flat: any[] = [];
  for (const item of items || []) {
    flat.push(item);
    if (item.children?.length) flat.push(...flattenTree(item.children));
  }
  return flat;
}

export async function getCardAttachmentMetadata(base44: any, entity: string, cardId: string) {
  const fresh = entity === 'Card'
    ? await base44.entities.Card.get(cardId).catch(() => null)
    : await base44.entities.Task.get(cardId).catch(() => null);
  return fresh?.attached_files || [];
}

export async function saveCardAttachmentMetadata(base44: any, entity: string, cardId: string, attachedFiles: any[]) {
  if (entity === 'Card' && base44.entities?.Card?.update) {
    await base44.entities.Card.update(cardId, { attached_files: attachedFiles });
  } else if (base44.entities?.Task?.update) {
    await base44.entities.Task.update(cardId, { attached_files: attachedFiles });
  }
}

export async function appendCardAttachmentMetadata(base44: any, entity: string, cardId: string, attachment: any) {
  const current = await getCardAttachmentMetadata(base44, entity, cardId);
  const next = [...current, attachment];
  await saveCardAttachmentMetadata(base44, entity, cardId, next);
  return next;
}

export async function removeCardAttachmentMetadata(base44: any, entity: string, cardId: string, attachmentId: string) {
  const current = await getCardAttachmentMetadata(base44, entity, cardId);
  const next = current.filter((item: any) => item.id !== attachmentId && item.drive_file_id !== attachmentId);
  await saveCardAttachmentMetadata(base44, entity, cardId, next);
  return next;
}

export async function listCardDriveContents(base44: any, accessToken: string, cardId: string) {
  const context = await getCardContext(base44, cardId);
  if (!context?.card) throw new Error('Card not found');

  const folder = await ensureCardDriveFolder(base44, accessToken, context);
  const tree = await buildDriveTree(accessToken, folder.folderId, folder.folderId);
  const metadata = await getCardAttachmentMetadata(base44, context.entity, context.card.id);
  const driveIds = tree.driveIds;

  const links = [];
  const fallbackDriveItems = [];

  for (const attachment of metadata) {
    if (attachment?.type === 'link' || attachment?.file_type === 'link' || (!attachment?.drive_file_id && attachment?.url)) {
      links.push(normalizeAttachmentLink(attachment));
      continue;
    }

    if (attachment?.drive_file_id && !driveIds.has(attachment.drive_file_id)) {
      fallbackDriveItems.push(normalizeAttachmentLink(attachment));
    }
  }

  return {
    folder,
    itemsTree: tree.itemsTree,
    links: sortNormalizedItems(links),
    legacyItems: sortNormalizedItems(fallbackDriveItems),
    mergedItems: sortNormalizedItems([...tree.itemsTree, ...fallbackDriveItems, ...links]),
    attachedFiles: metadata,
    card: context.card,
    entity: context.entity,
  };
}

export async function uploadFileToDriveFolder(accessToken: string, folderId: string, fileName: string, mimeType: string, fileBuffer: ArrayBuffer) {
  const boundary = `boundary-${crypto.randomUUID()}`;
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: fileName, parents: [folderId] })}\r\n`;
  const mediaPartHeader = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--`;

  const body = new Blob([metadataPart, mediaPartHeader, new Uint8Array(fileBuffer), footer]);

  const res = await driveRaw(accessToken, `${DRIVE_UPLOAD_API}?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,modifiedTime,iconLink,thumbnailLink`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const data = await res.json();
  if (!res.ok || !data?.id) {
    throw new Error(`Failed to upload file to Drive: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function createGoogleDriveFile(accessToken: string, folderId: string, name: string, fileType: keyof typeof GOOGLE_MIME_TYPES) {
  const res = await driveRaw(accessToken, `${DRIVE_API}?supportsAllDrives=true&fields=id,name,mimeType,parents,webViewLink,modifiedTime,iconLink,thumbnailLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: GOOGLE_MIME_TYPES[fileType], parents: [folderId] }),
  });
  const data = await res.json();
  if (!res.ok || !data?.id) {
    throw new Error(`Failed to create file: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function upsertTextFileInFolder(
  accessToken: string,
  folderId: string,
  name: string,
  content: string,
  mimeType = 'text/markdown',
) {
  const existing = await findFile(accessToken, name, folderId);
  const boundary = `boundary-${crypto.randomUUID()}`;
  const metadata = {
    name,
    mimeType,
    parents: [folderId],
  };
  const metadataPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const mediaPartHeader = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--`;
  const body = new Blob([metadataPart, mediaPartHeader, content, footer]);

  const url = existing
    ? `${DRIVE_UPLOAD_API}/${existing.id}?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents,webViewLink,modifiedTime`
    : `${DRIVE_UPLOAD_API}?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents,webViewLink,modifiedTime`;
  const method = existing ? 'PATCH' : 'POST';

  const res = await driveRaw(accessToken, url, {
    method,
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  const data = await res.json();
  if (!res.ok || !data?.id) {
    throw new Error(`Failed to upsert text file: ${JSON.stringify(data)}`);
  }
  return data;
}

export function markdownToGoogleDocsRequests(text: string) {
  const requests = [];
  const lines = String(text || '').split('\n');
  const segments = [] as Array<{ text: string; heading: string | null }>;

  for (const line of lines) {
    let heading: string | null = null;
    let cleanLine = line;

    if (line.startsWith('### ')) {
      heading = 'HEADING_3';
      cleanLine = line.slice(4);
    } else if (line.startsWith('## ')) {
      heading = 'HEADING_2';
      cleanLine = line.slice(3);
    } else if (line.startsWith('# ')) {
      heading = 'HEADING_1';
      cleanLine = line.slice(2);
    }

    if (cleanLine.trim() === '' && !heading) {
      segments.push({ text: '\n', heading: null });
    } else {
      segments.push({ text: `${cleanLine}\n`, heading });
    }
  }

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const seg = segments[i];
    requests.push({ insertText: { location: { index: 1 }, text: seg.text } });
  }

  let index = 1;
  for (const seg of segments) {
    if (seg.heading) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: index + seg.text.length },
          paragraphStyle: { namedStyleType: seg.heading },
          fields: 'namedStyleType',
        },
      });
    }
    index += seg.text.length;
  }

  return requests;
}

export async function insertTemplateIntoDoc(base44: any, createdFileId: string, templateKey: string, task: any, project: any) {
  if (!templateKey || !DOC_TEMPLATES[templateKey]) return;
  const template = DOC_TEMPLATES[templateKey];
  const aiContent = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: template.prompt(task, project),
  });
  const { accessToken: docsToken } = await base44.asServiceRole.connectors.getConnection('googledocs');
  const requests = markdownToGoogleDocsRequests(aiContent);
  const res = await fetch(`${GOOGLE_DOCS_API}/${createdFileId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${docsToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    console.error('Docs batchUpdate failed:', errorBody);
  }
}

export function buildLinksManifestContent(cardName: string, attachments: any[]) {
  const links = (attachments || []).filter((attachment) => (
    attachment?.type === 'link'
    || attachment?.file_type === 'link'
    || (!attachment?.drive_file_id && attachment?.url)
  ));

  const lines = [
    `# ${cardName || 'Card'} Links`,
    '',
  ];

  if (!links.length) {
    lines.push('No saved links yet.');
  } else {
    for (const link of links) {
      const label = link.name || link.url || 'Untitled link';
      const url = link.url || link.webViewLink || '';
      lines.push(`- [${label}](${url})`);
    }
  }

  lines.push('');
  lines.push(`Updated: ${new Date().toISOString()}`);
  return lines.join('\n');
}

export async function syncCardLinksManifest(base44: any, accessToken: string, context: any, attachments: any[]) {
  const folder = await ensureCardDriveFolder(base44, accessToken, context);
  const content = buildLinksManifestContent(context.cardName, attachments);
  return upsertTextFileInFolder(accessToken, folder.folderId, 'Links.md', content);
}

export async function renameDriveItem(accessToken: string, itemId: string, name: string) {
  return driveRequest(accessToken, `/${itemId}?supportsAllDrives=true&fields=id,name,mimeType,size,modifiedTime,parents,webViewLink,webContentLink,iconLink,thumbnailLink`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function trashDriveItem(accessToken: string, itemId: string) {
  return driveRequest(accessToken, `/${itemId}?supportsAllDrives=true&fields=id,name,trashed`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed: true }),
  });
}

export async function moveDriveItem(accessToken: string, itemId: string, destinationFolderId: string) {
  const current = await getDriveItem(accessToken, itemId);
  const parents = (current?.parents || []).join(',');
  const query = new URLSearchParams({
    addParents: destinationFolderId,
    removeParents: parents,
    supportsAllDrives: 'true',
    fields: 'id,name,mimeType,size,modifiedTime,parents,webViewLink,webContentLink,iconLink,thumbnailLink',
  });
  return driveRequest(accessToken, `/${itemId}?${query.toString()}`, { method: 'PATCH' });
}

export function createDriveAttachmentRecord(params: {
  driveFile: any;
  folder: any;
  fileName?: string;
  mimeType?: string;
  size?: number | null;
  userId?: string | null;
  fileType?: string | null;
}) {
  const { driveFile, folder, fileName, mimeType, size, userId, fileType } = params;
  const effectiveMimeType = driveFile.mimeType || mimeType || 'application/octet-stream';
  return {
    id: crypto.randomUUID(),
    name: driveFile.name || fileName || 'Untitled file',
    url: driveFile.webViewLink || driveFile.webContentLink || `https://drive.google.com/file/d/${driveFile.id}/view`,
    webViewLink: driveFile.webViewLink || driveFile.webContentLink || `https://drive.google.com/file/d/${driveFile.id}/view`,
    drive_file_id: driveFile.id,
    mimeType: effectiveMimeType,
    size: driveFile.size != null ? Number(driveFile.size) : (size ?? null),
    created_by: userId || null,
    created_at: new Date().toISOString(),
    provider: 'google_drive',
    folder_id: folder.folderId,
    folder_label: folder.folderLabel,
    type: 'file',
    file_type: fileType || mapFileType(driveFile.name || fileName || '', effectiveMimeType),
  };
}
