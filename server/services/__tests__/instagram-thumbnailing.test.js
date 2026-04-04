import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseInstagramThumbnail } from '../instagram-download-queue.js';
import {
  buildInstagramThumbnailStoragePath,
  uploadInstagramThumbnailToStorage,
} from '../instagram-downloader.js';

test('buildInstagramThumbnailStoragePath keeps the thumbnail path scoped and webp-based', () => {
  const path = buildInstagramThumbnailStoragePath({
    ownerUserId: 'user 123',
    resourceId: 'resource/456',
    filename: 'preview image.jpg',
  });

  assert.match(path, /^user-123\/resource-456\/.+-preview-image\.webp$/);
});

test('uploadInstagramThumbnailToStorage uploads bytes with the expected bucket and public url shape', async () => {
  const calls = [];
  const storageClient = {
    from(bucket) {
      return {
        async upload(path, data, options) {
          calls.push({ bucket, path, size: data.length, options });
          return { error: null, data: { path } };
        },
        getPublicUrl(path) {
          return { data: { publicUrl: `https://example.test/storage/${bucket}/${path}` } };
        },
      };
    },
  };

  const result = await uploadInstagramThumbnailToStorage({
    ownerUserId: 'user-1',
    resourceId: 'resource-1',
    filename: 'thumbnail.webp',
    contentType: 'image/webp',
    dataBase64: Buffer.from('thumbnail-bytes').toString('base64'),
    storageClient,
    bucketName: 'resource-thumbnails',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].bucket, 'resource-thumbnails');
  assert.equal(calls[0].options.contentType, 'image/webp');
  assert.equal(result.bucket, 'resource-thumbnails');
  assert.equal(result.url, result.thumbnail_url);
  assert.match(result.url, /^https:\/\/example\.test\/storage\/resource-thumbnails\//);
});

test('chooseInstagramThumbnail keeps an existing durable thumbnail over drive previews', () => {
  const currentThumbnail = 'https://xyz.supabase.co/storage/v1/object/public/resource-thumbnails/user/resource/thumb.webp';
  const drivePreview = 'https://drive.google.com/uc?export=view&id=drive-file-id';

  const result = chooseInstagramThumbnail(
    {
      thumbnail_url: drivePreview,
      drive_files: [
        { id: 'drive-file-id', name: 'preview.jpg', mime_type: 'image/jpeg', url: drivePreview },
      ],
      media_items: [
        {
          type: 'image',
          thumbnail_url: drivePreview,
          source_url: drivePreview,
        },
      ],
    },
    {
      thumbnail: currentThumbnail,
      drive_files: [],
      instagram_media_items: [],
    },
    {
      thumbnail: currentThumbnail,
      resource_type: 'instagram_reel',
    },
  );

  assert.equal(result, currentThumbnail);
});

test('chooseInstagramThumbnail prefers a fresh incoming thumbnail over drive urls', () => {
  const incoming = 'https://cdn.example.test/thumb.webp';
  const result = chooseInstagramThumbnail(
    {
      thumbnail_url: incoming,
      media_items: [
        {
          type: 'image',
          thumbnail_url: incoming,
          source_url: incoming,
        },
      ],
    },
    {
      thumbnail: '',
      drive_files: [
        { id: 'drive-file-id', name: 'preview.jpg', mime_type: 'image/jpeg', url: 'https://drive.google.com/uc?export=view&id=drive-file-id' },
      ],
    },
    {
      resource_type: 'instagram_carousel',
    },
  );

  assert.equal(result, incoming);
});
