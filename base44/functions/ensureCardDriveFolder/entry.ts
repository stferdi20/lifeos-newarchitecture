import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { ensureCardDriveFolder, getCardContext } from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { cardId, taskId } = await req.json();
    const resolvedCardId = cardId || taskId;
    if (!resolvedCardId) return Response.json({ error: 'cardId is required' }, { status: 400 });

    const context = await getCardContext(base44, resolvedCardId);
    if (!context?.card) return Response.json({ error: 'Card not found' }, { status: 404 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const folder = await ensureCardDriveFolder(base44, accessToken, context);

    return Response.json({ success: true, folder });
  } catch (error) {
    console.error('ensureCardDriveFolder error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
