import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { moveDriveItem, normalizeDriveItem } from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { itemId, destinationFolderId } = await req.json();
    if (!itemId || !destinationFolderId) {
      return Response.json({ error: 'itemId and destinationFolderId are required' }, { status: 400 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const item = await moveDriveItem(accessToken, itemId, destinationFolderId);
    return Response.json({ success: true, item: normalizeDriveItem(item, destinationFolderId) });
  } catch (error) {
    console.error('moveCardDriveItem error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
