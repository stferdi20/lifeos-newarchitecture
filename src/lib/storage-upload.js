import { createSignedUpload, signStoredFile } from '@/lib/projects-api';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

function sanitizePathSegment(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function uploadFileToManagedStorage({ file, cardId }) {
  const client = getSupabaseBrowserClient();
  if (!client) {
    throw new Error('Supabase browser client is not configured.');
  }

  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
  const safeName = sanitizePathSegment(file.name.replace(ext, '')) || 'file';
  const uploadPath = `cards/${sanitizePathSegment(cardId)}/${Date.now()}-${safeName}${ext}`;
  const { upload, bucket } = await createSignedUpload(uploadPath);
  const { error } = await client.storage.from(bucket).uploadToSignedUrl(upload.path, upload.token, file);
  if (error) throw error;

  const signedUrl = await signStoredFile(bucket, upload.path, 60 * 60 * 24 * 365);
  return {
    bucket,
    path: upload.path,
    signedUrl,
  };
}
