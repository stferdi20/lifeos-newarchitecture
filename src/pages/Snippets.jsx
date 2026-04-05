import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, LayoutGrid, List, Scissors, Sparkles, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PageActionRow, PageHeader } from '@/components/layout/page-header';
import { listBoardWorkspaces } from '@/lib/projects-api';
import { Snippet, trackSnippetCopy } from '@/lib/snippets-api';
import { getSnippetDisplayTitle } from '@/lib/snippet-display';
import { uploadFileToManagedStorage } from '@/lib/storage-upload';
import SnippetFilters from '@/components/snippets/SnippetFilters';
import SnippetEditorDialog from '@/components/snippets/SnippetEditorDialog';
import SnippetCard from '@/components/snippets/SnippetCard';

async function copyImageSnippet(snippet) {
  if (!snippet?.image_url) {
    throw new Error('This image snippet does not have a usable image URL.');
  }

  if (typeof window === 'undefined' || !navigator?.clipboard) {
    throw new Error('Clipboard access is not available in this browser.');
  }

  if (typeof navigator.clipboard.write === 'function' && typeof window.ClipboardItem !== 'undefined') {
    const response = await fetch(snippet.image_url);
    if (!response.ok) {
      throw new Error('Could not load the image to copy.');
    }
    const blob = await response.blob();
    await navigator.clipboard.write([new window.ClipboardItem({ [blob.type || snippet.mime_type || 'image/png']: blob })]);
    return 'image';
  }

  await navigator.clipboard.writeText(snippet.image_url);
  return 'url';
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

export default function Snippets() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [favoriteFilter, setFavoriteFilter] = useState('all');
  const [workspaceFilter, setWorkspaceFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('-last_copied_at');
  const [viewMode, setViewMode] = useState('grid');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState(null);
  const fileInputRef = useRef(null);

  const { data: snippets = [], isLoading } = useQuery({
    queryKey: ['snippets'],
    queryFn: () => Snippet.list('-updated_date', 500),
  });

  const { data: workspaces = [] } = useQuery({
    queryKey: ['snippet-workspaces'],
    queryFn: () => listBoardWorkspaces(),
  });

  const workspaceNameById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name || workspace.title || 'Untitled workspace'])),
    [workspaces],
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        if (activeTag === 'input' || activeTag === 'textarea') return;
        event.preventDefault();
        document.getElementById('snippet-search-input')?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const filteredSnippets = useMemo(() => {
    const searchTerms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const filtered = snippets.filter((snippet) => {
      if (typeFilter !== 'all' && snippet.snippet_type !== typeFilter) return false;
      if (favoriteFilter === 'favorites' && !snippet.is_favorite) return false;
      if (workspaceFilter === 'none' && snippet.workspace_id) return false;
      if (workspaceFilter !== 'all' && workspaceFilter !== 'none' && snippet.workspace_id !== workspaceFilter) return false;

      if (!searchTerms.length) return true;

      const haystack = [
        snippet.title,
        snippet.body_text,
        snippet.plain_text_preview,
        ...(Array.isArray(snippet.tags) ? snippet.tags : []),
      ].filter(Boolean).join(' ').toLowerCase();

      return searchTerms.every((term) => haystack.includes(term));
    });

    return [...filtered].sort((left, right) => {
      if (sortOrder === 'title') {
        return String(left.title || '').localeCompare(String(right.title || ''));
      }

      const field = sortOrder.replace(/^-/, '');
      const descending = sortOrder.startsWith('-');
      const leftValue = left?.[field] ?? null;
      const rightValue = right?.[field] ?? null;

      const leftTimestamp = leftValue ? Date.parse(leftValue) : Number.NaN;
      const rightTimestamp = rightValue ? Date.parse(rightValue) : Number.NaN;
      let compared = 0;

      if (Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp)) {
        compared = leftTimestamp - rightTimestamp;
      } else if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        compared = leftValue - rightValue;
      } else {
        compared = String(leftValue || '').localeCompare(String(rightValue || ''));
      }

      return descending ? -compared : compared;
    });
  }, [favoriteFilter, search, snippets, sortOrder, typeFilter, workspaceFilter]);

  const invalidateSnippets = () => queryClient.invalidateQueries({ queryKey: ['snippets'] });

  const createMutation = useMutation({
    mutationFn: (payload) => Snippet.create(payload),
    onSuccess: () => {
      invalidateSnippets();
      toast.success('Snippet created.');
    },
    onError: (error) => toast.error(error?.message || 'Failed to create snippet.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => Snippet.update(id, payload),
    onSuccess: () => {
      invalidateSnippets();
      toast.success('Snippet updated.');
    },
    onError: (error) => toast.error(error?.message || 'Failed to update snippet.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (snippetId) => Snippet.delete(snippetId),
    onSuccess: () => {
      invalidateSnippets();
      toast.success('Snippet deleted.');
    },
    onError: (error) => toast.error(error?.message || 'Failed to delete snippet.'),
  });

  const copyMutation = useMutation({
    mutationFn: (snippetId) => trackSnippetCopy(snippetId),
    onSuccess: (updatedSnippet) => {
      queryClient.setQueryData(['snippets'], (current = []) => (
        current.map((snippet) => (snippet.id === updatedSnippet?.id ? { ...snippet, ...updatedSnippet } : snippet))
      ));
      invalidateSnippets();
    },
  });

  const isQuickCreating = createMutation.isPending;
  const isUploadingImage = createMutation.isPending || updateMutation.isPending;
  const isClipboardBusy = createMutation.isPending || copyMutation.isPending;
  const hasActiveFilters = Boolean(search.trim())
    || typeFilter !== 'all'
    || favoriteFilter !== 'all'
    || workspaceFilter !== 'all';

  const handleSave = async (payload) => {
    if (editingSnippet?.id) {
      await updateMutation.mutateAsync({ id: editingSnippet.id, payload });
    } else {
      await createMutation.mutateAsync(payload);
    }
  };

  const handleCopy = async (snippet) => {
    try {
      if (snippet.snippet_type === 'image') {
        const mode = await copyImageSnippet(snippet);
        toast.success(mode === 'image' ? 'Image copied to clipboard.' : 'Image link copied to clipboard.');
      } else {
        await navigator.clipboard.writeText(snippet.body_text || '');
        toast.success(`Copied "${getSnippetDisplayTitle(snippet)}".`);
      }
      copyMutation.mutate(snippet.id);
    } catch (error) {
      toast.error(error?.message || 'Failed to copy snippet.');
    }
  };

  const handleCopySecondary = async (snippet) => {
    try {
      await navigator.clipboard.writeText(snippet.image_url || '');
      toast.success('Image link copied to clipboard.');
      copyMutation.mutate(snippet.id);
    } catch (error) {
      toast.error(error?.message || 'Failed to copy image link.');
    }
  };

  const handleToggleFavorite = async (snippet) => {
    await updateMutation.mutateAsync({
      id: snippet.id,
      payload: { is_favorite: !snippet.is_favorite },
    });
  };

  const handleQuickPasteCreate = async () => {
    if (isQuickCreating) return;
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((type) => type.startsWith('image/'));
          if (!imageType) continue;
          const blob = await item.getType(imageType);
          const file = new File([blob], `snippet-${Date.now()}.${imageType.split('/').pop() || 'png'}`, { type: imageType });
          await handleQuickCreateImage(file);
          return;
        }
      }

      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        toast.error('Clipboard is empty right now.');
        return;
      }

      await createMutation.mutateAsync({
        snippet_type: 'text',
        title: '',
        body_text: text,
        tags: [],
        workspace_id: null,
        is_favorite: false,
      });
      toast.success(`Saved "${getSnippetDisplayTitle({ title: '', body_text: text, snippet_type: 'text' })}".`);
    } catch (error) {
      toast.error(error?.message || 'Clipboard is not available.');
    }
  };

  const handleQuickCreateImage = async (file) => {
    try {
      if (!String(file?.type || '').startsWith('image/')) {
        toast.error('Only image files can be used for image snippets.');
        return;
      }

      const upload = await uploadFileToManagedStorage({
        file,
        pathPrefix: 'snippets',
        entityId: 'library',
      });
      const dimensions = await readImageDimensions(upload.signedUrl);

      await createMutation.mutateAsync({
        snippet_type: 'image',
        title: '',
        body_text: null,
        image_url: upload.signedUrl,
        storage_bucket: upload.bucket,
        storage_path: upload.path,
        mime_type: file.type || 'image/png',
        width: dimensions.width,
        height: dimensions.height,
        tags: [],
        workspace_id: null,
        is_favorite: false,
      });
      toast.success('Image snippet saved.');
    } catch (error) {
      toast.error(error?.message || 'Failed to save image snippet.');
    }
  };

  const handleQuickUploadImage = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Scissors}
        title="Snippets"
        description="A fast personal library for reusable text and image snippets across the webapp and menubar."
        actions={(
          <PageActionRow className="sm:flex-nowrap sm:overflow-x-auto sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="shrink-0 gap-2 border-white/10 bg-transparent whitespace-nowrap"
              onClick={() => {
                setEditingSnippet(null);
                setIsEditorOpen(true);
              }}
            >
              <Sparkles className="h-4 w-4" />
              New snippet
            </Button>
            <Button type="button" variant="outline" className="shrink-0 gap-2 border-white/10 bg-transparent whitespace-nowrap" onClick={() => setViewMode((current) => current === 'grid' ? 'list' : 'grid')}>
              {viewMode === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              {viewMode === 'grid' ? 'List view' : 'Grid view'}
            </Button>
            <Button type="button" className="shrink-0 gap-2 whitespace-nowrap" onClick={handleQuickPasteCreate} disabled={isClipboardBusy}>
              <ClipboardPaste className="h-4 w-4" />
              {isQuickCreating ? 'Saving...' : 'Paste snippet'}
            </Button>
            <Button type="button" variant="outline" className="shrink-0 gap-2 border-white/10 bg-transparent whitespace-nowrap" onClick={handleQuickUploadImage} disabled={isUploadingImage}>
              <Upload className="h-4 w-4" />
              {isUploadingImage ? 'Uploading...' : 'Upload image'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                handleQuickCreateImage(file);
                event.target.value = '';
              }}
            />
          </PageActionRow>
        )}
      />

      <div className="space-y-4">
        <SnippetFilters
          searchInputId="snippet-search-input"
          search={search}
          onSearchChange={setSearch}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          favoriteFilter={favoriteFilter}
          onFavoriteFilterChange={setFavoriteFilter}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
          workspaceFilter={workspaceFilter}
          onWorkspaceFilterChange={setWorkspaceFilter}
          workspaces={workspaces}
          onReset={() => {
            setSearch('');
            setTypeFilter('all');
            setFavoriteFilter('all');
            setWorkspaceFilter('all');
            setSortOrder('-last_copied_at');
          }}
        />
      </div>

      {isLoading ? (
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-muted-foreground">
          Loading snippets...
        </div>
      ) : filteredSnippets.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
          <h2 className="text-lg font-semibold">{hasActiveFilters ? 'No snippets match these filters' : 'No snippets yet'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasActiveFilters
              ? 'Try clearing a filter or broadening your search to bring snippets back into view.'
              : 'Create a text or image snippet and it will show up here for quick copying.'}
          </p>
          {hasActiveFilters ? (
            <Button
              className="mt-4 gap-2"
              variant="outline"
              onClick={() => {
                setSearch('');
                setTypeFilter('all');
                setFavoriteFilter('all');
                setWorkspaceFilter('all');
                setSortOrder('-last_copied_at');
              }}
            >
              Reset filters
            </Button>
          ) : (
            <Button className="mt-4 gap-2" onClick={handleQuickPasteCreate} disabled={isClipboardBusy}>
              <ClipboardPaste className="h-4 w-4" />
              Paste your first snippet
            </Button>
          )}
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'grid gap-4 xl:grid-cols-2' : 'space-y-4'}>
          {filteredSnippets.map((snippet) => (
            <SnippetCard
              key={snippet.id}
              snippet={snippet}
              viewMode={viewMode}
              workspaceName={snippet.workspace_id ? workspaceNameById.get(snippet.workspace_id) : null}
              onCopy={handleCopy}
              onCopySecondary={handleCopySecondary}
              onToggleFavorite={handleToggleFavorite}
              onEdit={(item) => {
                setEditingSnippet(item);
                setIsEditorOpen(true);
              }}
              onDelete={(item) => deleteMutation.mutate(item.id)}
            />
          ))}
        </div>
      )}

      <SnippetEditorDialog
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        snippet={editingSnippet}
        workspaces={workspaces}
        onSave={handleSave}
      />
    </div>
  );
}
