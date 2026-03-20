import React, { useMemo, useRef, useState } from 'react';
import { Link2, Loader2, Paperclip, Trash2, UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { addCardAttachmentMetadata, removeCardAttachmentMetadata } from '@/lib/projects-api';
import { uploadFileToManagedStorage } from '@/lib/storage-upload';
import CreateDocumentButton from './CreateDocumentButton';

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

export default function BackendFileAttachmentSection({ task, onUpdate }) {
  const fileInputRef = useRef(null);
  const [linkInput, setLinkInput] = useState('');
  const [linkName, setLinkName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [addingLink, setAddingLink] = useState(false);
  const attachments = useMemo(() => Array.isArray(task?.attached_files) ? task.attached_files : [], [task?.attached_files]);

  const persistAttachment = async (attachment) => {
    const result = await addCardAttachmentMetadata(task.id, attachment);
    onUpdate?.({ attached_files: result?.card?.attached_files || [] });
    return result?.attachment;
  };

  const handleUpload = async (files) => {
    const fileList = Array.from(files || []).filter(Boolean);
    if (!fileList.length || !task?.id) return;

    setUploading(true);
    try {
      for (const file of fileList) {
        const uploaded = await uploadFileToManagedStorage({ file, cardId: task.id });
        await persistAttachment({
          name: file.name,
          url: uploaded.signedUrl,
          webViewLink: uploaded.signedUrl,
          mimeType: file.type,
          size: file.size,
          provider: 'supabase_storage',
          file_type: file.type.startsWith('image/') ? 'image' : (file.type === 'application/pdf' ? 'pdf' : 'file'),
          storage_bucket: uploaded.bucket,
          storage_path: uploaded.path,
        });
      }
      toast.success(fileList.length > 1 ? `${fileList.length} attachments uploaded.` : `${fileList[0].name} uploaded.`);
    } catch (error) {
      toast.error(error?.message || 'Failed to upload attachment.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddLink = async () => {
    if (!linkInput.trim() || !task?.id) return;

    setAddingLink(true);
    try {
      let resolvedName = linkName.trim();
      if (!resolvedName) {
        try {
          resolvedName = new URL(linkInput.trim()).hostname.replace(/^www\./, '');
        } catch {
          resolvedName = linkInput.trim();
        }
      }

      await persistAttachment({
        name: resolvedName,
        url: linkInput.trim(),
        webViewLink: linkInput.trim(),
        provider: 'link',
        file_type: 'link',
      });
      setLinkInput('');
      setLinkName('');
      toast.success('Link added.');
    } catch (error) {
      toast.error(error?.message || 'Failed to save link.');
    } finally {
      setAddingLink(false);
    }
  };

  const handleRemove = async (attachmentId) => {
    try {
      const result = await removeCardAttachmentMetadata(task.id, attachmentId);
      onUpdate?.({ attached_files: result?.card?.attached_files || [] });
      toast.success('Attachment removed.');
    } catch (error) {
      toast.error(error?.message || 'Failed to remove attachment.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
          <Paperclip className="w-3 h-3" /> Attachments
          <span className="text-foreground/60 normal-case tracking-normal">{attachments.length}</span>
        </label>
        <span className="text-[11px] text-muted-foreground">Attachments and Google Docs links are now stored through the backend.</span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => handleUpload(event.target.files)}
      />

      <div className="rounded-2xl border border-border/50 bg-[#13161d] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
            Upload Files
          </Button>
          <CreateDocumentButton
            taskId={task?.id}
            task={task}
            onCreated={(attached_files) => onUpdate?.({ attached_files })}
          />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto]">
          <input
            type="url"
            value={linkInput}
            onChange={(event) => setLinkInput(event.target.value)}
            placeholder="Paste a link"
            className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={linkName}
            onChange={(event) => setLinkName(event.target.value)}
            placeholder="Display name (optional)"
            className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm"
          />
          <Button type="button" size="sm" onClick={handleAddLink} disabled={addingLink || !linkInput.trim()}>
            {addingLink ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {attachments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/40 px-3 py-4 text-sm text-muted-foreground">
            No attachments yet. Upload files or save links here.
          </div>
        ) : (
          attachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-secondary/20 px-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{attachment.name}</p>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  <span>{attachment.file_type || 'file'}</span>
                  {attachment.size ? <span>{formatBytes(attachment.size)}</span> : null}
                </div>
              </div>
              {attachment.webViewLink || attachment.url ? (
                <a
                  href={attachment.webViewLink || attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg px-2 py-1 text-xs text-sky-300 hover:bg-sky-500/10"
                >
                  Open
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => handleRemove(attachment.id)}
                className="rounded-lg p-2 text-muted-foreground hover:bg-red-500/10 hover:text-red-300"
                title="Remove attachment"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
