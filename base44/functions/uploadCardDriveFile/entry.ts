import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import {
  appendCardAttachmentMetadata,
  createDriveAttachmentRecord,
  ensureCardDriveFolder,
  getCardContext,
  uploadFileToDriveFolder,
} from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { cardId, taskId, parentFolderId, fileName, mimeType, size, sourceUrl, file } = await req.json();
    const resolvedCardId = cardId || taskId;
    const resolvedFileName = file?.name || fileName;
    const resolvedMimeType = file?.mimeType || mimeType || 'application/octet-stream';
    const resolvedSize = file?.size ?? size ?? null;
    const resolvedSourceUrl = file?.sourceUrl || file?.file_url || file?.fileUrl || file?.url || sourceUrl;

    if (!resolvedCardId || !resolvedFileName || !resolvedSourceUrl) {
      return Response.json({ error: 'Missing required fields: cardId, file.name, file.sourceUrl' }, { status: 400 });
    }

    const context = await getCardContext(base44, resolvedCardId);
    if (!context?.card) return Response.json({ error: 'Card not found' }, { status: 404 });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const folder = await ensureCardDriveFolder(base44, accessToken, context);
    const destinationFolderId = parentFolderId || folder.folderId;

    const sourceRes = await fetch(resolvedSourceUrl);
    if (!sourceRes.ok) {
      const details = await sourceRes.text();
      return Response.json({
        error: 'Failed to fetch uploaded file',
        status: sourceRes.status,
        details,
      }, { status: 400 });
    }

    const fileBuffer = await sourceRes.arrayBuffer();
    const uploaded = await uploadFileToDriveFolder(
      accessToken,
      destinationFolderId,
      resolvedFileName,
      resolvedMimeType || sourceRes.headers.get('content-type') || 'application/octet-stream',
      fileBuffer,
    );

    const attachment = createDriveAttachmentRecord({
      driveFile: uploaded,
      folder: {
        folderId: destinationFolderId,
        folderLabel: folder.folderLabel,
      },
      fileName: resolvedFileName,
      mimeType: resolvedMimeType,
      size: resolvedSize,
      userId: user.id,
    });

    const attachedFiles = await appendCardAttachmentMetadata(base44, context.entity, context.card.id, attachment);

    return Response.json({
      success: true,
      item: {
        id: uploaded.id,
        kind: 'drive_file',
        name: uploaded.name,
        url: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
        mimeType: uploaded.mimeType,
        size: uploaded.size != null ? Number(uploaded.size) : resolvedSize,
        modifiedAt: uploaded.modifiedTime || new Date().toISOString(),
        parentId: destinationFolderId,
        children: [],
        provider: 'google_drive',
        isExternalLink: false,
      },
      attachment,
      attachedFiles,
      folder: {
        ...folder,
        folderId: destinationFolderId,
        folderUrl: `https://drive.google.com/drive/folders/${destinationFolderId}`,
      },
    });
  } catch (error) {
    console.error('uploadCardDriveFile error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
