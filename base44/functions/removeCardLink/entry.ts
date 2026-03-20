import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { getCardContext, removeCardAttachmentMetadata, syncCardLinksManifest } from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { cardId, taskId, attachmentId } = await req.json();
    const resolvedCardId = cardId || taskId;
    if (!resolvedCardId || !attachmentId) return Response.json({ error: 'cardId and attachmentId are required' }, { status: 400 });

    const context = await getCardContext(base44, resolvedCardId);
    if (!context?.card) return Response.json({ error: 'Card not found' }, { status: 404 });

    const attachedFiles = await removeCardAttachmentMetadata(base44, context.entity, context.card.id, attachmentId);
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    await syncCardLinksManifest(base44, accessToken, context, attachedFiles).catch(() => null);
    return Response.json({ success: true, attachedFiles, attachmentId });
  } catch (error) {
    console.error('removeCardLink error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
