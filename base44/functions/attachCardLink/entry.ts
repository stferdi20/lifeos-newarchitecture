import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import {
  appendCardAttachmentMetadata,
  getCardContext,
  normalizeAttachmentLink,
  syncCardLinksManifest,
} from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { cardId, taskId, name, url } = await req.json();
    const resolvedCardId = cardId || taskId;
    if (!resolvedCardId || !url?.trim()) return Response.json({ error: 'cardId and url are required' }, { status: 400 });

    const context = await getCardContext(base44, resolvedCardId);
    if (!context?.card) return Response.json({ error: 'Card not found' }, { status: 404 });

    let resolvedName = name?.trim();
    if (!resolvedName) {
      try {
        resolvedName = new URL(url).hostname.replace('www.', '');
      } catch {
        resolvedName = url;
      }
    }

    const attachment = {
      id: crypto.randomUUID(),
      name: resolvedName,
      url: url.trim(),
      type: 'link',
      file_type: 'link',
      provider: 'link',
      created_by: user.id,
      created_at: new Date().toISOString(),
    };

    const attachedFiles = await appendCardAttachmentMetadata(base44, context.entity, context.card.id, attachment);
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    await syncCardLinksManifest(base44, accessToken, context, attachedFiles).catch(() => null);

    return Response.json({
      success: true,
      item: normalizeAttachmentLink(attachment),
      attachment,
      attachedFiles,
    });
  } catch (error) {
    console.error('attachCardLink error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
