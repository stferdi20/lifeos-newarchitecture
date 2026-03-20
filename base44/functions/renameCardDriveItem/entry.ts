import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { normalizeDriveItem, renameDriveItem } from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { itemId, name, parentId } = await req.json();
    if (!itemId || !name?.trim()) return Response.json({ error: 'itemId and name are required' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const item = await renameDriveItem(accessToken, itemId, name.trim());
    return Response.json({ success: true, item: normalizeDriveItem(item, parentId || null) });
  } catch (error) {
    console.error('renameCardDriveItem error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
