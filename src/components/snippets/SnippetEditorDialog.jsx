import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, ClipboardPaste, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { uploadFileToManagedStorage } from '@/lib/storage-upload';

const EMPTY_FORM = {
  title: '',
  snippet_type: 'text',
  body_text: '',
  tags: '',
  workspace_id: 'none',
  is_favorite: false,
  image_url: null,
  storage_bucket: null,
  storage_path: null,
  mime_type: null,
  width: null,
  height: null,
};

function normalizeForm(snippet) {
  if (!snippet) return EMPTY_FORM;
  return {
    title: snippet.title || '',
    snippet_type: snippet.snippet_type || 'text',
    body_text: snippet.body_text || '',
    tags: Array.isArray(snippet.tags) ? snippet.tags.join(', ') : '',
    workspace_id: snippet.workspace_id || 'none',
    is_favorite: Boolean(snippet.is_favorite),
    image_url: snippet.image_url || null,
    storage_bucket: snippet.storage_bucket || null,
    storage_path: snippet.storage_path || null,
    mime_type: snippet.mime_type || null,
    width: snippet.width || null,
    height: snippet.height || null,
  };
}

async function readImageDimensions(url) {
  if (typeof window === 'undefined') return { width: null, height: null };

  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null });
    img.onerror = () => resolve({ width: null, height: null });
    img.src = url;
  });
}

export default function SnippetEditorDialog({
  open,
  onOpenChange,
  snippet,
  workspaces = [],
  onSave,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setForm(normalizeForm(snippet));
    }
  }, [open, snippet]);

  const setField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleImageFile = async (file) => {
    if (!file) return;
    if (!String(file.type || '').startsWith('image/')) {
      toast.error('Only image files can be used for image snippets.');
      return;
    }

    setIsUploadingImage(true);
    try {
      const upload = await uploadFileToManagedStorage({
        file,
        pathPrefix: 'snippets',
        entityId: snippet?.id || 'library',
      });
      const dimensions = await readImageDimensions(upload.signedUrl);
      setForm((current) => ({
        ...current,
        snippet_type: 'image',
        image_url: upload.signedUrl,
        storage_bucket: upload.bucket,
        storage_path: upload.path,
        mime_type: file.type || 'image/png',
        width: dimensions.width,
        height: dimensions.height,
        body_text: current.body_text || '',
      }));
      if (!form.title.trim()) {
        setField('title', file.name.replace(/\.[^.]+$/, ''));
      }
      toast.success('Image snippet asset uploaded.');
    } catch (error) {
      toast.error(error?.message || 'Failed to upload image.');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handlePasteText = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error('Clipboard does not contain text right now.');
        return;
      }
      setForm((current) => ({
        ...current,
        snippet_type: 'text',
        body_text: text,
        title: current.title || text.trim().slice(0, 48),
      }));
      toast.success('Text pasted from clipboard.');
    } catch (error) {
      toast.error(error?.message || 'Clipboard text is not available.');
    }
  };

  const handlePasteImage = async () => {
    try {
      if (!navigator.clipboard?.read) {
        toast.error('This browser does not support reading images from the clipboard.');
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const file = new File([blob], `snippet-${Date.now()}.${imageType.split('/').pop() || 'png'}`, { type: imageType });
        await handleImageFile(file);
        return;
      }
      toast.error('Clipboard does not contain an image.');
    } catch (error) {
      toast.error(error?.message || 'Clipboard image is not available.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const payload = {
        title: form.title.trim(),
        snippet_type: form.snippet_type,
        body_text: form.snippet_type === 'text' ? form.body_text : form.body_text || null,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        workspace_id: form.workspace_id === 'none' ? null : form.workspace_id,
        is_favorite: form.is_favorite,
      };

      if (form.snippet_type === 'image') {
        Object.assign(payload, {
          image_url: form.image_url,
          storage_bucket: form.storage_bucket,
          storage_path: form.storage_path,
          mime_type: form.mime_type,
          width: form.width,
          height: form.height,
        });
      }

      await onSave(payload);
      onOpenChange(false);
    } catch (error) {
      toast.error(error?.message || 'Failed to save snippet.');
    } finally {
      setIsSaving(false);
    }
  };

  const isImage = form.snippet_type === 'image';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-white/10 bg-[#111318] text-foreground sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{snippet ? 'Edit snippet' : 'New snippet'}</DialogTitle>
          <DialogDescription>
            Save reusable text or images that you want to copy quickly later.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={form.title}
                onChange={(event) => setField('title', event.target.value)}
                placeholder="Snippet title"
                className="border-white/10 bg-white/[0.04]"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select value={form.snippet_type} onValueChange={(value) => setField('snippet_type', value)}>
                <SelectTrigger className="border-white/10 bg-white/[0.04]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="image">Image</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <Input
                value={form.tags}
                onChange={(event) => setField('tags', event.target.value)}
                placeholder="sales, support, prompt"
                className="border-white/10 bg-white/[0.04]"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace</label>
              <Select value={form.workspace_id} onValueChange={(value) => setField('workspace_id', value)}>
                <SelectTrigger className="border-white/10 bg-white/[0.04]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No workspace</SelectItem>
                  {workspaces.map((workspace) => (
                    <SelectItem key={workspace.id} value={workspace.id}>
                      {workspace.name || workspace.title || 'Untitled workspace'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={form.is_favorite}
              onChange={(event) => setField('is_favorite', event.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-white/[0.04]"
            />
            Mark as favorite
          </label>

          {!isImage ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium">Text content</label>
                <Button type="button" variant="outline" className="gap-2 border-white/10 bg-transparent" onClick={handlePasteText}>
                  <ClipboardPaste className="h-4 w-4" />
                  Paste from clipboard
                </Button>
              </div>
              <Textarea
                value={form.body_text}
                onChange={(event) => setField('body_text', event.target.value)}
                placeholder="Write or paste the text you want to reuse."
                className="min-h-[220px] border-white/10 bg-white/[0.04]"
                required={!isImage}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="gap-2 border-white/10 bg-transparent" onClick={handlePasteImage} disabled={isUploadingImage}>
                  {isUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  Paste image
                </Button>
                <Button type="button" variant="outline" className="gap-2 border-white/10 bg-transparent" onClick={() => fileInputRef.current?.click()} disabled={isUploadingImage}>
                  <Upload className="h-4 w-4" />
                  Upload image
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => handleImageFile(event.target.files?.[0])}
                />
              </div>

              {form.image_url ? (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                  <img src={form.image_url} alt={form.title || 'Snippet preview'} className="max-h-[320px] w-full object-contain" />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-muted-foreground">
                  Paste or upload an image to finish this snippet.
                </div>
              )}

              <Textarea
                value={form.body_text}
                onChange={(event) => setField('body_text', event.target.value)}
                placeholder="Optional note or caption for search."
                className="min-h-[110px] border-white/10 bg-white/[0.04]"
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" className="border-white/10 bg-transparent" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || isUploadingImage}>
              {isSaving ? 'Saving...' : (snippet ? 'Save changes' : 'Create snippet')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
