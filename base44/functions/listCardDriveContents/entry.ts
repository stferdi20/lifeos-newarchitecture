import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { listCardDriveContents } from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { cardId, taskId } = await req.json();
    const resolvedCardId = cardId || taskId;
    if (!resolvedCardId) return Response.json({ error: 'cardId is required' }, { status: 400 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const payload = await listCardDriveContents(base44, accessToken, resolvedCardId);

    return Response.json({
      success: true,
      folder: payload.folder,
      itemsTree: payload.itemsTree,
      links: payload.links,
      legacyItems: payload.legacyItems,
      mergedItems: payload.mergedItems,
      attachedFiles: payload.attachedFiles,
    });
  } catch (error) {
    console.error('listCardDriveContents error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
