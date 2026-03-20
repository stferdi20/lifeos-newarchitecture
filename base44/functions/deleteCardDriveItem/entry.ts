import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { trashDriveItem } from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { itemId } = await req.json();
    if (!itemId) return Response.json({ error: 'itemId is required' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    await trashDriveItem(accessToken, itemId);
    return Response.json({ success: true, itemId });
  } catch (error) {
    console.error('deleteCardDriveItem error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
