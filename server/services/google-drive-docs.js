import { HttpError } from '../lib/http.js';
import { getGoogleAccessToken } from './google.js';

const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DOCS_API = 'https://docs.googleapis.com/v1';

const WORKSPACE_FILE_TYPES = {
  docs: {
    service: 'docs',
    mimeType: 'application/vnd.google-apps.document',
    provider: 'google_docs',
  },
  sheets: {
    service: 'drive',
    mimeType: 'application/vnd.google-apps.spreadsheet',
    provider: 'google_sheets',
  },
  slides: {
    service: 'drive',
    mimeType: 'application/vnd.google-apps.presentation',
    provider: 'google_slides',
  },
};

function resolveFileType(fileType) {
  const resolved = WORKSPACE_FILE_TYPES[fileType || 'docs'];
  if (!resolved) {
    throw new HttpError(400, `Unsupported Google Workspace file type "${fileType}".`);
  }
  return resolved;
}

function buildOpenUrl(fileType, fileId) {
  if (fileType === 'sheets') {
    return `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
  }
  if (fileType === 'slides') {
    return `https://docs.google.com/presentation/d/${fileId}/edit`;
  }
  return `https://docs.google.com/document/d/${fileId}/edit`;
}

async function createGoogleFile(accessToken, { title, mimeType }) {
  const response = await fetch(`${GOOGLE_DRIVE_API}/files?supportsAllDrives=false`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: title,
      mimeType,
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.id) {
    throw new HttpError(502, 'Failed to create Google Workspace file.', { details: payload });
  }

  return payload;
}

async function seedGoogleDoc(accessToken, documentId, content) {
  if (!content.trim()) return;

  const response = await fetch(`${GOOGLE_DOCS_API}/documents/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: content,
          },
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(502, 'Failed to populate Google Doc.', { details: payload });
  }
}

export function buildTemplateContent({ title, templateKey, card } = {}) {
  const cardTitle = card?.title || title || 'Untitled';
  const cardDescription = card?.description?.trim() || '';

  const templates = {
    project_brief: [
      `# ${cardTitle}`,
      '',
      '## Objective',
      cardDescription || 'Define the goal of this project.',
      '',
      '## Scope',
      '- In scope:',
      '- Out of scope:',
      '',
      '## Deliverables',
      '-',
      '',
      '## Timeline',
      '- Start:',
      '- Due:',
      '',
      '## Risks / Notes',
      '-',
    ],
    meeting_notes: [
      `# ${cardTitle} - Meeting Notes`,
      '',
      '## Agenda',
      '-',
      '',
      '## Key Discussion Points',
      '-',
      '',
      '## Decisions',
      '-',
      '',
      '## Action Items',
      '-',
    ],
    research_doc: [
      `# ${cardTitle} - Research Notes`,
      '',
      '## Question / Goal',
      cardDescription || '-',
      '',
      '## Findings',
      '-',
      '',
      '## Insights',
      '-',
      '',
      '## References',
      '-',
    ],
    task_plan: [
      `# ${cardTitle} - Execution Plan`,
      '',
      '## Desired Outcome',
      cardDescription || '-',
      '',
      '## Milestones',
      '-',
      '',
      '## Checklist',
      '-',
      '',
      '## Dependencies',
      '-',
    ],
  };

  if (!templateKey || !templates[templateKey]) {
    return '';
  }

  return templates[templateKey].join('\n');
}

export async function createGoogleWorkspaceDocument(userId, payload = {}) {
  const title = String(payload.title || '').trim();
  if (!title) {
    throw new HttpError(400, 'Document title is required.');
  }

  const fileType = payload.fileType || 'docs';
  const config = resolveFileType(fileType);
  const accessToken = await getGoogleAccessToken(userId, config.service);
  const file = await createGoogleFile(accessToken, {
    title,
    mimeType: config.mimeType,
  });

  if (fileType === 'docs') {
    await seedGoogleDoc(accessToken, file.id, payload.content || '');
  }

  return {
    documentId: file.id,
    url: buildOpenUrl(fileType, file.id),
    title,
    provider: config.provider,
    fileType,
  };
}
