import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { createFolder, ensureCardDriveFolder, getCardContext, normalizeDriveItem } from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { cardId, taskId, parentFolderId, name } = await req.json();
    const resolvedCardId = cardId || taskId;
    if (!resolvedCardId || !name?.trim()) {
      return Response.json({ error: 'cardId and folder name are required' }, { status: 400 });
    }

    const context = await getCardContext(base44, resolvedCardId);
    if (!context?.card) return Response.json({ error: 'Card not found' }, { status: 404 });
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const folder = await ensureCardDriveFolder(base44, accessToken, context);
    const created = await createFolder(accessToken, name.trim(), parentFolderId || folder.folderId);

    return Response.json({
      success: true,
      item: normalizeDriveItem(created, parentFolderId || folder.folderId),
      folder,
    });
  } catch (error) {
    console.error('createCardDriveFolder error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
