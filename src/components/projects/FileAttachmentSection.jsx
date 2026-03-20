import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image,
  Link2,
  Loader2,
  MoreHorizontal,
  Paperclip,
  Pencil,
  RefreshCw,
  Sheet,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import BackendFileAttachmentSection from './BackendFileAttachmentSection';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ACTIVITY_TYPES, logCardActivity } from './activityEvents';

const legacyCompat = null;

const DOC_TEMPLATES = [
  { key: 'project_brief', label: 'Project Brief', description: 'Objectives, scope, and deliverables' },
  { key: 'meeting_notes', label: 'Meeting Notes', description: 'Agenda, decisions, and actions' },
  { key: 'research_doc', label: 'Research Document', description: 'Findings, analysis, and references' },
  { key: 'task_plan', label: 'Task Plan', description: 'Step-by-step execution plan' },
];

const FILE_TYPE_CONFIG = {
  drive_folder: { icon: Folder, accent: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
  link: { icon: Link2, accent: 'text-sky-300 bg-sky-500/10 border-sky-500/20' },
  gdoc: { icon: FileText, accent: 'text-blue-300 bg-blue-500/10 border-blue-500/20' },
  gsheet: { icon: Sheet, accent: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20' },
  gslide: { icon: Sparkles, accent: 'text-orange-300 bg-orange-500/10 border-orange-500/20' },
  pdf: { icon: FileText, accent: 'text-red-300 bg-red-500/10 border-red-500/20' },
  image: { icon: Image, accent: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/20' },
  file: { icon: File, accent: 'text-zinc-300 bg-zinc-500/10 border-zinc-500/20' },
};

function getItemConfig(item) {
  if (item.kind === 'drive_folder') return FILE_TYPE_CONFIG.drive_folder;
  if (item.kind === 'link') return FILE_TYPE_CONFIG.link;
  if (item.file_type && FILE_TYPE_CONFIG[item.file_type]) return FILE_TYPE_CONFIG[item.file_type];
  if (item.mimeType?.startsWith('image/')) return FILE_TYPE_CONFIG.image;
  return FILE_TYPE_CONFIG.file;
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatModified(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}

function buildFolderOptions(items, depth = 0, options = []) {
  for (const item of items || []) {
    if (item.kind !== 'drive_folder') continue;
    options.push({ id: item.id, name: item.name, depth });
    if (item.children?.length) buildFolderOptions(item.children, depth + 1, options);
  }
  return options;
}

async function invokeFunction(name, payload) {
  const res = await legacyCompat.functions.invoke(name, payload);
  return res?.data || res;
}

function isNotFoundError(error) {
  const message = error?.message || '';
  return String(message).includes('404');
}

async function updateCardAttachments(taskId, nextAttachments) {
  try {
    await legacyCompat.entities.Card.update(taskId, { attached_files: nextAttachments });
    return true;
  } catch {
    await legacyCompat.entities.Task.update(taskId, { attached_files: nextAttachments });
    return false;
  }
}

function normalizeLegacyAttachment(attachment) {
  const kind = attachment?.type === 'link' || attachment?.file_type === 'link' ? 'link' : (attachment?.drive_file_id ? 'drive_file' : 'link');
  return {
    id: attachment.id || attachment.drive_file_id || crypto.randomUUID(),
    kind,
    name: attachment.name || attachment.url || 'Untitled attachment',
    url: attachment.webViewLink || attachment.url,
    mimeType: attachment.mimeType || null,
    size: attachment.size ?? null,
    modifiedAt: attachment.updated_at || attachment.created_at || attachment.created_date || null,
    parentId: null,
    children: [],
    provider: attachment.provider || (kind === 'link' ? 'link' : 'google_drive'),
    isExternalLink: kind === 'link',
    file_type: attachment.file_type || null,
    folder_id: attachment.folder_id || null,
    folder_label: attachment.folder_label || null,
    webViewLink: attachment.webViewLink || attachment.url || null,
    isLegacyMetadata: true,
  };
}

function buildLegacyPayload(task) {
  const attachedFiles = task?.attached_files || [];
  const links = attachedFiles
    .filter((attachment) => attachment?.type === 'link' || attachment?.file_type === 'link' || (!attachment?.drive_file_id && attachment?.url))
    .map(normalizeLegacyAttachment);
  const legacyItems = attachedFiles
    .filter((attachment) => !links.some((link) => link.id === (attachment.id || attachment.drive_file_id)))
    .map(normalizeLegacyAttachment);

  return {
    success: true,
    folder: task?.drive_folder_id ? {
      folderId: task.drive_folder_id,
      folderLabel: task.title || task.name || 'Card',
      folderUrl: `https://drive.google.com/drive/folders/${task.drive_folder_id}`,
    } : null,
    itemsTree: [],
    links,
    legacyItems,
    mergedItems: [...legacyItems, ...links],
    attachedFiles,
  };
}

function LegacyFileAttachmentSection({ task, onUpdate }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkName, setLinkName] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [dropTargetFolderId, setDropTargetFolderId] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());

  const folderQuery = useQuery({
    queryKey: ['card-drive-folder', task?.id],
    enabled: !!task?.id,
    queryFn: async () => {
      try {
        return await invokeFunction('ensureCardDriveFolder', { cardId: task.id });
      } catch (error) {
        if (isNotFoundError(error)) {
          return task?.drive_folder_id ? {
            success: true,
            folder: {
              folderId: task.drive_folder_id,
              folderLabel: task.title || task.name || 'Card',
              folderUrl: `https://drive.google.com/drive/folders/${task.drive_folder_id}`,
            },
          } : { success: false, folder: null };
        }
        throw error;
      }
    },
    staleTime: 60 * 1000,
    initialData: null,
  });

  const driveQuery = useQuery({
    queryKey: ['card-drive-contents', task?.id],
    enabled: !!task?.id,
    queryFn: async () => {
      try {
        return await invokeFunction('listCardDriveContents', { cardId: task.id });
      } catch (error) {
        if (isNotFoundError(error)) {
          return buildLegacyPayload(task);
        }
        throw error;
      }
    },
    staleTime: 15 * 1000,
    initialData: null,
  });

  useEffect(() => {
    const folderIds = new Set();
    for (const item of driveQuery.data?.itemsTree || []) {
      if (item.kind === 'drive_folder') folderIds.add(item.id);
    }
    if (folderIds.size) {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        folderIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }, [driveQuery.data?.itemsTree]);

  useEffect(() => {
    if (!driveQuery.data) return;
    onUpdate?.({
      attached_files: driveQuery.data.attachedFiles || [],
      drive_folder_id: driveQuery.data.folder?.folderId || folderQuery.data?.folder?.folderId || task?.drive_folder_id || '',
    });
  }, [driveQuery.data, folderQuery.data?.folder?.folderId, onUpdate, task?.drive_folder_id]);

  useEffect(() => {
    if (!folderQuery.data?.folder?.folderId) return;
    onUpdate?.({
      drive_folder_id: folderQuery.data.folder.folderId,
    });
  }, [folderQuery.data?.folder?.folderId, onUpdate]);

  const folderOptions = useMemo(() => {
    const options = [{ id: (driveQuery.data?.folder?.folderId || folderQuery.data?.folder?.folderId || 'root'), name: 'Card root', depth: 0 }];
    return options.concat(buildFolderOptions(driveQuery.data?.itemsTree || []));
  }, [driveQuery.data, folderQuery.data?.folder?.folderId]);

  const resolvedFolder = driveQuery.data?.folder || folderQuery.data?.folder || null;
  const rootFolderId = resolvedFolder?.folderId || null;
  const hasItems = (driveQuery.data?.itemsTree?.length || 0) > 0 || (driveQuery.data?.legacyItems?.length || 0) > 0 || (driveQuery.data?.links?.length || 0) > 0;
  const attachmentCount = (driveQuery.data?.mergedItems?.length || 0) + countNestedChildren(driveQuery.data?.itemsTree || []);
  const dropZoneIsCompact = hasItems;

  const invalidateCardQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['card-drive-contents', task?.id] });
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey?.[0] === 'cards' });
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey?.[0] === 'tasks' });
  };

  const refreshContents = async () => {
    setErrorMessage('');
    const result = await driveQuery.refetch();
    invalidateCardQueries();
    return result?.data;
  };

  const runAction = async (key, action, successMessage) => {
    try {
      setBusyKey(key);
      setErrorMessage('');
      const data = await action();
      await refreshContents();
      if (successMessage) toast.success(successMessage);
      return data;
    } catch (error) {
      const message = error?.message || 'Attachment action failed.';
      setErrorMessage(message);
      toast.error(message);
      throw error;
    } finally {
      setBusyKey('');
    }
  };

  const openNativePicker = (folderId = null) => {
    setUploadTargetFolderId(folderId);
    fileInputRef.current?.click();
  };

  const uploadFileCompat = async (file, parentFolderId = null) => {
    const uploadRes = await legacyCompat.integrations.Core.UploadFile({ file });
    const tempFileUrl =
      uploadRes?.file_url
      || uploadRes?.fileUrl
      || uploadRes?.url
      || uploadRes?.data?.file_url
      || uploadRes?.data?.fileUrl
      || uploadRes?.data?.url;

    if (!tempFileUrl) {
      throw new Error('Upload succeeded but no temporary file URL was returned.');
    }

    try {
      const data = await invokeFunction('uploadCardDriveFile', {
        cardId: task.id,
        parentFolderId: parentFolderId || undefined,
        file: {
          name: file.name,
          mimeType: file.type,
          size: file.size,
          sourceUrl: tempFileUrl,
        },
      });
      if (!data?.success) {
        throw new Error(data?.error || `Failed to attach ${file.name}`);
      }
      return data;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;

      const data = await invokeFunction('attachFileToTask', {
        cardId: task.id,
        file: {
          name: file.name,
          mimeType: file.type,
          size: file.size,
          sourceUrl: tempFileUrl,
        },
      });
      if (!data?.success) {
        throw new Error(data?.error || `Failed to attach ${file.name}`);
      }
      onUpdate?.({
        attached_files: data.attachedFiles || [...(task?.attached_files || []), data.attachment].filter(Boolean),
        drive_folder_id: data.folder?.folderId || resolvedFolder?.folderId || task?.drive_folder_id || '',
      });
      return data;
    }
  };

  const uploadFiles = async (files, parentFolderId = null) => {
    const uploadList = Array.from(files || []).filter(Boolean);
    if (!uploadList.length || !task?.id) return;

    await runAction(parentFolderId ? `upload-${parentFolderId}` : 'upload-root', async () => {
      for (const file of uploadList) {
        await uploadFileCompat(file, parentFolderId);
        await logCardActivity({
          card_id: task.id,
          type: ACTIVITY_TYPES.attachmentAdded,
          metadata: { attachment_name: file.name },
        });
      }
    }, uploadList.length > 1 ? `${uploadList.length} files added to Drive` : `Added ${uploadList[0].name} to Drive`);
  };

  const handlePickerChange = async (event) => {
    const files = event.target.files;
    await uploadFiles(files, uploadTargetFolderId);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setUploadTargetFolderId(null);
  };

  const handleCreateDocument = async (fileType, templateKey = null, parentFolderId = null) => {
    const data = await runAction(`create-${fileType}`, async () => {
      let result;
      try {
        result = await invokeFunction('createCardDriveDocument', {
          cardId: task.id,
          parentFolderId: parentFolderId || undefined,
          fileType,
          templateKey,
        });
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        result = await invokeFunction('createProjectDocument', {
          taskId: task.id,
          parentFolderId: parentFolderId || undefined,
          fileType,
          templateKey,
        });
      }
      if (!result?.success || !result?.fileUrl) {
        throw new Error(result?.error || 'Document creation did not return a file URL.');
      }
      await logCardActivity({
        card_id: task.id,
        type: ACTIVITY_TYPES.attachmentAdded,
        metadata: { attachment_name: result.fileName },
      });
      return result;
    }, 'Document created');

    if (data?.fileUrl) window.open(data.fileUrl, '_blank');
  };

  const handleCreateFolder = async (parentFolderId = null) => {
    const name = window.prompt('Folder name');
    if (!name?.trim()) return;
    await runAction(`folder-${parentFolderId || 'root'}`, async () => {
      const result = await invokeFunction('createCardDriveFolder', {
        cardId: task.id,
        parentFolderId: parentFolderId || undefined,
        name,
      });
      if (!result?.success) throw new Error(result?.error || 'Failed to create folder.');
      if (result?.item?.id) {
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          if (parentFolderId) next.add(parentFolderId);
          next.add(result.item.id);
          return next;
        });
      }
      return result;
    }, 'Folder created');
  };

  const handleAddLink = async () => {
    if (!linkInput.trim()) return;
    await runAction('add-link', async () => {
      let result;
      try {
        result = await invokeFunction('attachCardLink', {
          cardId: task.id,
          name: linkName,
          url: linkInput.trim(),
        });
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        let resolvedName = linkName?.trim();
        if (!resolvedName) {
          try {
            resolvedName = new URL(linkInput.trim()).hostname.replace('www.', '');
          } catch {
            resolvedName = linkInput.trim();
          }
        }
        const attachment = {
          id: crypto.randomUUID(),
          name: resolvedName,
          url: linkInput.trim(),
          type: 'link',
          file_type: 'link',
          provider: 'link',
          created_at: new Date().toISOString(),
        };
        const nextAttachments = [...(task?.attached_files || []), attachment];
        await updateCardAttachments(task.id, nextAttachments);
        result = {
          success: true,
          attachment,
          attachedFiles: nextAttachments,
        };
      }
      if (!result?.success) throw new Error(result?.error || 'Failed to add link.');
      await logCardActivity({
        card_id: task.id,
        type: ACTIVITY_TYPES.attachmentAdded,
        metadata: { attachment_name: result?.attachment?.name || linkName || linkInput },
      });
      onUpdate?.({ attached_files: result.attachedFiles || task?.attached_files || [] });
      setLinkInput('');
      setLinkName('');
      setShowLinkForm(false);
      return result;
    }, 'Link added');
  };

  const handleDeleteItem = async (item) => {
    const label = item.kind === 'link' ? 'remove this link' : 'move this item to Drive trash';
    if (!window.confirm(`Are you sure you want to ${label}?`)) return;

    if (item.kind === 'link') {
      await runAction(`delete-${item.id}`, async () => {
        let result;
        try {
          result = await invokeFunction('removeCardLink', { cardId: task.id, attachmentId: item.id });
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
          const nextAttachments = (task?.attached_files || []).filter((attachment) => attachment.id !== item.id);
          await updateCardAttachments(task.id, nextAttachments);
          result = { success: true, attachedFiles: nextAttachments };
        }
        if (!result?.success) throw new Error(result?.error || 'Failed to remove link.');
        onUpdate?.({ attached_files: result.attachedFiles || task?.attached_files || [] });
        return result;
      }, 'Link removed');
      return;
    }

    if (item.isLegacyMetadata) {
      await runAction(`delete-${item.id}`, async () => {
        let result;
        try {
          result = await invokeFunction('removeCardLink', { cardId: task.id, attachmentId: item.id });
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
          const nextAttachments = (task?.attached_files || []).filter((attachment) => attachment.id !== item.id);
          await updateCardAttachments(task.id, nextAttachments);
          result = { success: true, attachedFiles: nextAttachments };
        }
        if (!result?.success) throw new Error(result?.error || 'Failed to remove saved reference.');
        onUpdate?.({ attached_files: result.attachedFiles || task?.attached_files || [] });
        return result;
      }, 'Reference removed');
      return;
    }

    await runAction(`delete-${item.id}`, async () => {
      const result = await invokeFunction('deleteCardDriveItem', { itemId: item.id });
      if (!result?.success) throw new Error(result?.error || 'Failed to move item to trash.');
      return result;
    }, 'Moved to Drive trash');
  };

  const handleRenameItem = async (item) => {
    if (item.kind === 'link' || item.isLegacyMetadata) return;
    const name = window.prompt('Rename item', item.name);
    if (!name?.trim() || name.trim() === item.name) return;
    await runAction(`rename-${item.id}`, async () => {
      const result = await invokeFunction('renameCardDriveItem', { itemId: item.id, name: name.trim(), parentId: item.parentId || rootFolderId });
      if (!result?.success) throw new Error(result?.error || 'Failed to rename item.');
      return result;
    }, 'Item renamed');
  };

  const handleMoveItem = async (item, destinationFolderId) => {
    if (!destinationFolderId || destinationFolderId === item.parentId || item.kind === 'link' || item.isLegacyMetadata) return;
    await runAction(`move-${item.id}`, async () => {
      const result = await invokeFunction('moveCardDriveItem', { itemId: item.id, destinationFolderId });
      if (!result?.success) throw new Error(result?.error || 'Failed to move item.');
      return result;
    }, 'Item moved');
  };

  const handleRootDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    setDropTargetFolderId(null);
    await uploadFiles(event.dataTransfer?.files, null);
  };

  const toggleFolder = (folderId) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
          <Paperclip className="w-3 h-3" /> Attachments
          <span className="text-foreground/60 normal-case tracking-normal">{attachmentCount || 0}</span>
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => refreshContents()}
            disabled={driveQuery.isFetching}
            className="flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/30 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3 h-3', driveQuery.isFetching && 'animate-spin')} /> Refresh
          </button>

          <button
            onClick={() => resolvedFolder?.folderUrl && window.open(resolvedFolder.folderUrl, '_blank')}
            disabled={!resolvedFolder?.folderUrl}
            className="flex items-center gap-1 rounded-lg border border-border/60 bg-secondary/30 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground disabled:opacity-50"
          >
            <FolderOpen className="w-3 h-3" /> Open Folder
          </button>
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handlePickerChange} />

      {errorMessage && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {errorMessage}
        </div>
      )}

      {showLinkForm && (
        <div className="rounded-xl border border-border/50 bg-secondary/20 p-3 space-y-2">
          <input
            type="url"
            value={linkInput}
            onChange={(event) => setLinkInput(event.target.value)}
            placeholder="Paste a URL to keep with this card"
            className="w-full rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <input
            type="text"
            value={linkName}
            onChange={(event) => setLinkName(event.target.value)}
            placeholder="Display name (optional)"
            className="w-full rounded-lg border border-border/50 bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setShowLinkForm(false);
                setLinkInput('');
                setLinkName('');
              }}
              className="rounded-lg px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <button
              onClick={handleAddLink}
              disabled={!linkInput.trim() || busyKey === 'add-link'}
              className="rounded-lg bg-sky-600 px-3 py-1 text-xs text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
            >
              {busyKey === 'add-link' ? 'Adding...' : 'Add Link'}
            </button>
          </div>
        </div>
      )}

      <div
        className={cn(
          'rounded-2xl border border-border/50 bg-[#13161d] overflow-hidden transition-all',
          isDragActive && 'border-emerald-400/50 shadow-[0_0_0_1px_rgba(52,211,153,0.25)]',
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current += 1;
          setIsDragActive(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDropTargetFolderId(null);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) {
            setIsDragActive(false);
            setDropTargetFolderId(null);
          }
        }}
        onDrop={handleRootDrop}
      >
        <div className="border-b border-border/40 px-3 py-2.5 flex items-center justify-between gap-3 bg-secondary/10">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-foreground">
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-emerald-300">
                {resolvedFolder?.folderId ? 'Folder ready' : 'Preparing folder'}
              </span>
              <span className="truncate">{resolvedFolder?.folderLabel || task?.title || task?.name || 'Card folder'}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Files and folders in this card's Drive folder are the source of truth here. Links stay alongside them as saved references and sync into a shared `Links.md` file in the folder.
            </p>
          </div>
          {(busyKey || folderQuery.isLoading || driveQuery.isFetching) && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1 shrink-0">
              <Loader2 className="w-3 h-3 animate-spin" />
              {busyKey || driveQuery.isFetching ? 'Syncing contents...' : 'Preparing folder...'}
            </div>
          )}
        </div>

        <div
          className={cn(
            'mx-3 mt-3 mb-2 rounded-xl border border-dashed px-3 transition-all',
            dropZoneIsCompact ? 'py-2.5' : 'py-5',
            isDragActive
              ? 'border-emerald-400/60 bg-emerald-500/10'
              : 'border-border/50 bg-secondary/10 hover:border-emerald-400/30 hover:bg-secondary/20',
          )}
          onClick={() => openNativePicker(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openNativePicker(null);
            }
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-foreground">Drop files here or click Upload</p>
              <p className="text-[11px] text-muted-foreground">
                {dropZoneIsCompact ? 'Always ready for quick upload.' : 'This stays ready even after the folder fills up.'}
              </p>
            </div>
            <div className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300 shrink-0">
              <UploadCloud className="w-3 h-3" /> Quick upload
            </div>
          </div>
        </div>

        <div className="px-3 pb-2">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Folder contents</p>
            <p className="text-[10px] text-muted-foreground">{attachmentCount || 0} items</p>
          </div>
        </div>

        <ScrollArea className="max-h-[300px] border-t border-border/20">
          <div className="p-3">
            {driveQuery.isLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-secondary/10 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Syncing Drive contents...
              </div>
            ) : !hasItems ? (
              <div className="rounded-xl border border-dashed border-border/50 bg-secondary/5 px-4 py-8 text-center">
                <UploadCloud className="w-8 h-8 mx-auto text-muted-foreground/60 mb-3" />
                <p className="text-sm text-foreground">This card folder is ready for attachments.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Drag files here, create a doc, add a link, or open the Drive folder directly.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {(driveQuery.data?.itemsTree || []).length > 0 && (
                  <div className="space-y-1.5">
                    {(driveQuery.data?.itemsTree || []).map((item) => (
                      <AttachmentTreeItem
                        key={item.id}
                        item={item}
                        rootFolderId={rootFolderId}
                        folderOptions={folderOptions}
                        expandedFolders={expandedFolders}
                        toggleFolder={toggleFolder}
                        onOpenFolder={openNativePicker}
                        onCreateFolder={handleCreateFolder}
                        onDelete={handleDeleteItem}
                        onMove={handleMoveItem}
                        onRename={handleRenameItem}
                        onFolderDrop={uploadFiles}
                        dropTargetFolderId={dropTargetFolderId}
                        setDropTargetFolderId={setDropTargetFolderId}
                        isDragActive={isDragActive}
                        busyKey={busyKey}
                      />
                    ))}
                  </div>
                )}

                {(driveQuery.data?.legacyItems || []).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Saved references</p>
                    {driveQuery.data.legacyItems.map((item) => (
                      <AttachmentRow
                        key={item.id}
                        item={item}
                        depth={0}
                        rootFolderId={rootFolderId}
                        folderOptions={folderOptions}
                        expanded={false}
                        onToggle={() => {}}
                        onOpenFolder={openNativePicker}
                        onCreateFolder={handleCreateFolder}
                        onDelete={handleDeleteItem}
                        onMove={handleMoveItem}
                        onRename={handleRenameItem}
                        onFolderDrop={uploadFiles}
                        dropTargetFolderId={dropTargetFolderId}
                        setDropTargetFolderId={setDropTargetFolderId}
                        isDragActive={isDragActive}
                        busyKey={busyKey}
                      />
                    ))}
                  </div>
                )}

                {(driveQuery.data?.links || []).length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-border/30">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Saved links</p>
                    {driveQuery.data.links.map((item) => (
                      <AttachmentRow
                        key={item.id}
                        item={item}
                        depth={0}
                        rootFolderId={rootFolderId}
                        folderOptions={folderOptions}
                        expanded={false}
                        onToggle={() => {}}
                        onOpenFolder={openNativePicker}
                        onCreateFolder={handleCreateFolder}
                        onDelete={handleDeleteItem}
                        onMove={handleMoveItem}
                        onRename={handleRenameItem}
                        onFolderDrop={uploadFiles}
                        dropTargetFolderId={dropTargetFolderId}
                        setDropTargetFolderId={setDropTargetFolderId}
                        isDragActive={isDragActive}
                        busyKey={busyKey}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border/20 px-3 py-2.5 flex flex-wrap items-center gap-1.5 bg-secondary/10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 rounded-lg border border-blue-500/20 bg-blue-500/10 px-2 py-1 text-[10px] text-blue-300 transition-colors hover:bg-blue-500/20">
                <Sparkles className="w-3 h-3" /> Create Doc
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 border-border/50 bg-[#1a1d25] text-foreground">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-muted-foreground">Create in Drive</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FileText className="w-4 h-4 text-blue-300" /> Google Docs
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-72 border-border/50 bg-[#1a1d25] text-foreground">
                  {DOC_TEMPLATES.map((template) => (
                    <DropdownMenuItem key={template.key} onSelect={() => handleCreateDocument('docs', template.key)}>
                      <div className="flex flex-col gap-0.5">
                        <span>{template.label}</span>
                        <span className="text-[10px] text-muted-foreground">{template.description}</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => handleCreateDocument('docs')}>
                    <div className="flex flex-col gap-0.5">
                      <span>Empty Document</span>
                      <span className="text-[10px] text-muted-foreground">Start from a blank doc</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => handleCreateDocument('sheets')}>
                <Sheet className="w-4 h-4 text-emerald-300" /> Google Sheets
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleCreateDocument('slides')}>
                <Sparkles className="w-4 h-4 text-orange-300" /> Google Slides
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={() => setShowLinkForm((value) => !value)}
            className="flex items-center gap-1 rounded-lg border border-sky-500/20 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-300 transition-colors hover:bg-sky-500/20"
          >
            <Link2 className="w-3 h-3" /> Add Link
          </button>

          <button
            onClick={() => handleCreateFolder(null)}
            disabled={Boolean(busyKey)}
            className="flex items-center gap-1 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          >
            <FolderPlus className="w-3 h-3" /> New Folder
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FileAttachmentSection(props) {
  return <BackendFileAttachmentSection {...props} />;
}

function AttachmentTreeItem(props) {
  const { item, expandedFolders, toggleFolder } = props;
  const expanded = expandedFolders.has(item.id);

  return (
    <div className="space-y-1">
      <AttachmentRow {...props} item={item} expanded={expanded} onToggle={() => toggleFolder(item.id)} />
      {item.kind === 'drive_folder' && expanded && item.children?.length > 0 && (
        <div className="space-y-1">
          {item.children.map((child) => (
            <AttachmentTreeItem key={child.id} {...props} item={child} depth={(props.depth || 0) + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentRow({
  item,
  depth = 0,
  expanded,
  onToggle,
  rootFolderId,
  onOpenFolder,
  onCreateFolder,
  onDelete,
  onMove,
  onRename,
  onFolderDrop,
  dropTargetFolderId,
  setDropTargetFolderId,
  isDragActive,
  folderOptions,
  busyKey,
}) {
  const { icon: Icon, accent } = getItemConfig(item);
  const isFolder = item.kind === 'drive_folder';
  const canManageDriveItem = item.kind !== 'link' && !item.isLegacyMetadata;
  const isBusy = busyKey.includes(item.id);
  const blockedFolderIds = useMemo(() => new Set(isFolder ? collectDescendantIds(item) : []), [isFolder, item]);

  return (
    <div
      className={cn(
        'group rounded-xl border border-transparent bg-secondary/10 px-2 py-2 transition-colors hover:border-border/50 hover:bg-secondary/20',
        isFolder && dropTargetFolderId === item.id && isDragActive && 'border-emerald-400/50 bg-emerald-500/10',
      )}
      style={{ marginLeft: depth * 14 }}
      onDragOver={isFolder ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropTargetFolderId(item.id);
      } : undefined}
      onDrop={isFolder ? async (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropTargetFolderId(null);
        await onFolderDrop(event.dataTransfer?.files, item.id);
      } : undefined}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={isFolder ? onToggle : undefined}
          className={cn('flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors', isFolder ? 'hover:bg-secondary/60 hover:text-foreground' : 'opacity-0 pointer-events-none')}
        >
          {isFolder ? (expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </button>

        <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl border', accent)}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm text-foreground transition-colors hover:text-primary"
            >
              {item.name}
            </a>
            {item.isLegacyMetadata && (
              <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">Saved reference</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {item.provider === 'google_drive' && <span>Google Drive</span>}
            {item.kind === 'link' && <span>External link</span>}
            {formatBytes(item.size) && <span>{formatBytes(item.size)}</span>}
            {formatModified(item.modifiedAt) && <span>{formatModified(item.modifiedAt)}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            title="Open"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground" disabled={isBusy}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreHorizontal className="w-3.5 h-3.5" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-border/50 bg-[#1a1d25] text-foreground">
              <DropdownMenuLabel>{item.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {isFolder && (
                <>
                  <DropdownMenuItem onSelect={() => onOpenFolder(item.id)}>
                    <UploadCloud className="w-4 h-4" /> Upload here
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onCreateFolder(item.id)}>
                    <FolderPlus className="w-4 h-4" /> New subfolder
                  </DropdownMenuItem>
                </>
              )}
              {canManageDriveItem && (
                <DropdownMenuItem onSelect={() => onRename(item)}>
                  <Pencil className="w-4 h-4" /> Rename
                </DropdownMenuItem>
              )}
              {canManageDriveItem && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderOpen className="w-4 h-4" /> Move to
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56 border-border/50 bg-[#1a1d25] text-foreground max-h-72 overflow-auto">
                    {folderOptions.filter((folder) => folder.id !== item.id && !blockedFolderIds.has(folder.id)).map((folder) => (
                      <DropdownMenuItem
                        key={`${item.id}-${folder.id}`}
                        onSelect={() => onMove(item, folder.id === 'root' ? rootFolderId : folder.id)}
                      >
                        <span className="truncate">{`${folder.depth > 0 ? '· '.repeat(folder.depth) : ''}${folder.name}`}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onDelete(item)} className="text-red-300 focus:text-red-200">
                <Trash2 className="w-4 h-4" /> {item.kind === 'link' || item.isLegacyMetadata ? 'Remove' : 'Move to trash'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

function countNestedChildren(items) {
  return (items || []).reduce((count, item) => count + (item.children?.length || 0) + countNestedChildren(item.children || []), 0);
}

function collectDescendantIds(item) {
  const ids = [];
  for (const child of item.children || []) {
    ids.push(child.id);
    ids.push(...collectDescendantIds(child));
  }
  return ids;
}
