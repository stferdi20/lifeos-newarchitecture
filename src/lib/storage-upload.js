import { createSignedUpload, signStoredFile } from '@/lib/projects-api';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

function sanitizePathSegment(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function hashFileContent(file) {
  if (typeof file?.arrayBuffer === 'function' && globalThis.crypto?.subtle) {
    const buffer = await file.arrayBuffer();
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  const name = sanitizePathSegment(file?.name || 'file') || 'file';
  const size = Number(file?.size || 0);
  const lastModified = Number(file?.lastModified || 0);
  return `${name}-${size}-${lastModified}`;
}

async function buildUploadPath({ file, pathPrefix = 'cards', entityId = 'library' }) {
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
  const safeName = sanitizePathSegment(file.name.replace(ext, '')) || 'file';
  const scopeKey = sanitizePathSegment(entityId || 'library') || 'library';
  const normalizedPrefix = String(pathPrefix || 'cards').replace(/^\/+|\/+$/g, '');
  const contentHash = await hashFileContent(file);

  return {
    path: `${normalizedPrefix}/${scopeKey}/${contentHash}${ext || ''}`,
    safeName,
    scopeKey,
    normalizedPrefix,
    contentHash,
  };
}

export async function uploadFileToManagedStorage({
  file,
  cardId,
  pathPrefix = 'cards',
  entityId,
}) {
  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error('Supabase browser client is not configured.');
  }

  const { path: uploadPath, contentHash } = await buildUploadPath({
    file,
    pathPrefix,
    entityId: entityId || cardId || 'library',
  });
  const longCacheSeconds = 60 * 60 * 24 * 365;

  const { upload, bucket } = await createSignedUpload(uploadPath);
  try {
    const existingSignedUrl = await signStoredFile(bucket, upload.path, longCacheSeconds);
    return {
      bucket,
      path: upload.path,
      signedUrl: existingSignedUrl,
      url: existingSignedUrl,
      deduped: true,
      contentHash,
    };
  } catch {
    // Continue to a real upload when the content-addressed object does not exist yet.
  }

  const { error } = await client.storage.from(bucket).uploadToSignedUrl(upload.path, upload.token, file, {
    cacheControl: String(longCacheSeconds),
    upsert: false,
  });
  if (error) {
    try {
      const existingSignedUrl = await signStoredFile(bucket, upload.path, longCacheSeconds);
      return {
        bucket,
        path: upload.path,
        signedUrl: existingSignedUrl,
        url: existingSignedUrl,
        deduped: true,
        contentHash,
      };
    } catch {
      throw error;
    }
  }

  const signedUrl = await signStoredFile(bucket, upload.path, longCacheSeconds);
  return {
    bucket,
    path: upload.path,
    signedUrl,
    url: signedUrl,
    deduped: false,
    contentHash,
  };
}
