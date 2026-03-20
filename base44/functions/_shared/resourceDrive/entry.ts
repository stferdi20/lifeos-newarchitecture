import {
  ensureFolder,
  uploadFileToDriveFolder,
  upsertTextFileInFolder,
} from './cardDrive.ts';
import type { InstagramMediaItem } from './instagram.ts';

const ROOT_FOLDER = 'Life OS';
const RESOURCES_FOLDER = 'Resources';
const INSTAGRAM_FOLDER = 'Instagram';

function sanitizeFolderName(value: string, fallback: string) {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

function buildFileName(shortcode: string, item: InstagramMediaItem, contentType = '') {
  const extFromContentType = contentType.includes('png')
    ? 'png'
    : contentType.includes('webp')
      ? 'webp'
      : contentType.includes('jpeg') || contentType.includes('jpg')
        ? 'jpg'
        : contentType.includes('gif')
          ? 'gif'
          : contentType.includes('quicktime')
            ? 'mov'
            : item.type === 'video'
              ? 'mp4'
              : 'jpg';

  return `${shortcode || 'instagram'}-${String(item.index + 1).padStart(2, '0')}.${extFromContentType}`;
}

async function downloadMediaItem(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    throw new Error(`Media download failed (${res.status}).`);
  }

  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = await res.arrayBuffer();
  return { buffer, contentType };
}

export async function ensureInstagramResourceDriveFolder(
  accessToken: string,
  title: string,
  shortcode: string,
  existingId?: string | null,
) {
  const lifeOS = await ensureFolder(accessToken, ROOT_FOLDER);
  const resources = await ensureFolder(accessToken, RESOURCES_FOLDER, lifeOS.id);
  const instagram = await ensureFolder(accessToken, INSTAGRAM_FOLDER, resources.id);
  const folderName = sanitizeFolderName(title, shortcode || 'Instagram Resource');
  const folder = await ensureFolder(accessToken, folderName, instagram.id, existingId || null);

  return {
    folderId: folder.id,
    folderLabel: [ROOT_FOLDER, RESOURCES_FOLDER, INSTAGRAM_FOLDER, folderName].join(' / '),
    folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
  };
}

export async function uploadInstagramMediaToDrive(
  accessToken: string,
  folder: { folderId: string; folderLabel: string; folderUrl: string },
  params: {
    title: string;
    sourceUrl: string;
    shortcode: string;
    caption: string;
    transcript: string;
    transcriptError: string;
    mediaItems: InstagramMediaItem[];
    publishedAt: string;
    authorHandle: string;
  },
) {
  const uploadedItems = [];
  const failedItems = [];

  for (const item of params.mediaItems || []) {
    try {
      const { buffer, contentType } = await downloadMediaItem(item.source_url);
      const driveFile = await uploadFileToDriveFolder(
        accessToken,
        folder.folderId,
        buildFileName(params.shortcode, item, contentType),
        contentType,
        buffer,
      );

      uploadedItems.push({
        name: driveFile.name,
        url: driveFile.webViewLink || `https://drive.google.com/file/d/${driveFile.id}/view`,
        type: item.type,
      });
    } catch (error) {
      failedItems.push({
        index: item.index,
        url: item.source_url,
        error: (error as Error)?.message || 'Media upload failed.',
      });
    }
  }

  const metadata = {
    title: params.title,
    source_url: params.sourceUrl,
    shortcode: params.shortcode,
    author_handle: params.authorHandle,
    published_at: params.publishedAt,
    caption: params.caption,
    transcript: params.transcript,
    transcript_error: params.transcriptError,
    media_items: params.mediaItems,
    uploaded_items: uploadedItems,
    failed_items: failedItems,
    uploaded_at: new Date().toISOString(),
  };

  await upsertTextFileInFolder(
    accessToken,
    folder.folderId,
    'metadata.json',
    JSON.stringify(metadata, null, 2),
    'application/json',
  );

  return {
    uploadedItems,
    failedItems,
    downloadStatus: params.mediaItems.length === 0
      ? 'skipped'
      : failedItems.length === params.mediaItems.length
        ? 'failed'
        : failedItems.length > 0
          ? 'completed'
          : 'completed',
  };
}
