import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import {
  GOOGLE_FILE_LINKS,
  GOOGLE_FILE_TYPES,
  GOOGLE_MIME_TYPES,
  appendCardAttachmentMetadata,
  createDriveAttachmentRecord,
  createGoogleDriveFile,
  ensureCardDriveFolder,
  getCardContext,
  insertTemplateIntoDoc,
} from './_shared/cardDrive.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { cardId, taskId, parentFolderId, fileType, templateKey } = await req.json();
    const resolvedCardId = cardId || taskId;

    if (!resolvedCardId || !fileType || !GOOGLE_MIME_TYPES[fileType]) {
      return Response.json({ error: 'Invalid parameters' }, { status: 400 });
    }

    const context = await getCardContext(base44, resolvedCardId);
    if (!context?.card) return Response.json({ error: 'Card not found' }, { status: 404 });

    const prefix = { docs: 'Doc', sheets: 'Sheet', slides: 'Slides' }[fileType] || 'Doc';
    const title = `${prefix} - ${context.card.title || context.card.name || 'Untitled'}`;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    const folder = await ensureCardDriveFolder(base44, accessToken, context);
    const destinationFolderId = parentFolderId || folder.folderId;

    const createdFile = await createGoogleDriveFile(accessToken, destinationFolderId, title, fileType);
    if (fileType === 'docs' && templateKey) {
      await insertTemplateIntoDoc(base44, createdFile.id, templateKey, context.card, context.project);
    }

    const attachment = createDriveAttachmentRecord({
      driveFile: createdFile,
      folder: {
        folderId: destinationFolderId,
        folderLabel: folder.folderLabel,
      },
      fileName: title,
      mimeType: GOOGLE_MIME_TYPES[fileType],
      userId: user.id,
      fileType: GOOGLE_FILE_TYPES[fileType],
    });

    const attachedFiles = await appendCardAttachmentMetadata(base44, context.entity, context.card.id, attachment);
    const fileUrl = GOOGLE_FILE_LINKS[fileType](createdFile.id);

    return Response.json({
      success: true,
      fileId: createdFile.id,
      fileUrl,
      fileName: title,
      item: {
        id: createdFile.id,
        kind: 'drive_file',
        name: title,
        url: fileUrl,
        mimeType: GOOGLE_MIME_TYPES[fileType],
        size: null,
        modifiedAt: createdFile.modifiedTime || new Date().toISOString(),
        parentId: destinationFolderId,
        children: [],
        provider: 'google_drive',
        isExternalLink: false,
      },
      attachment: { ...attachment, url: fileUrl, webViewLink: fileUrl },
      attachedFiles,
      folder: {
        ...folder,
        folderId: destinationFolderId,
        folderUrl: `https://drive.google.com/drive/folders/${destinationFolderId}`,
      },
    });
  } catch (error) {
    console.error('createCardDriveDocument error:', error);
    return Response.json({ error: error.message || 'Unexpected error' }, { status: 500 });
  }
});
