import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Archive, Inbox, Trash2, Calendar, Tag, AlignLeft, CheckSquare, Plus, X,
  Sparkles, Loader2, Check, Link2, CalendarRange, Palette, Clock3, UploadCloud, BookOpen, ExternalLink, BellRing
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import FileAttachmentSection from './FileAttachmentSection';
import CardCommentsSection from './CardCommentsSection';
import ResourceLinkPickerModal from './ResourceLinkPickerModal';
import ResourceDetailModal from '@/components/resources/ResourceDetailModal';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import StandaloneTaskDetailModal from '@/components/tasks/TaskDetailModal';
import {
  createReminderFromCard,
  createReminderFromChecklist,
  getGoogleTasksAppUrl,
  isReminderLinked,
  syncLinkedTasks as syncGoogleLinkedTasks,
  updateTaskWithReminderSync,
} from '@/lib/googleReminderSync';
import { normalizeChecklistItems } from '@/lib/tasks';
import {
  addCardAttachmentMetadata,
  generateCardSubtasks,
  improveCardDescription,
  listCardLinkedTasks,
  syncCardLinkedTasks,
} from '@/lib/projects-api';
import { CardResource, Resource } from '@/lib/resources-api';
import { uploadFileToManagedStorage } from '@/lib/storage-upload';

const legacyCompat = null;

const priorityColors = {
  low: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const LABEL_COLORS = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Rose', value: '#f43f5e' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Slate', value: '#64748b' },
];

const COVER_COLORS = ['#0f766e', '#1d4ed8', '#7c3aed', '#be123c', '#92400e', '#374151'];
const MAX_COVER_UPLOAD_SIZE = 2 * 1024 * 1024;
const COVER_PRESETS = [
  { id: 'forest', label: 'Forest', url: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80' },
  { id: 'workspace', label: 'Workspace', url: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80' },
  { id: 'mountains', label: 'Mountains', url: 'https://images.unsplash.com/photo-1511497584788-876760111969?auto=format&fit=crop&w=1200&q=80' },
  { id: 'sunset', label: 'Sunset', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80' },
  { id: 'ocean', label: 'Ocean', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80' },
  { id: 'city', label: 'City', url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80' },
];

function getAttachmentImageUrl(attachment) {
  return attachment?.webViewLink || attachment?.url || '';
}

async function invokeFunction(name, payload) {
  const res = await legacyCompat.functions.invoke(name, payload);
  return res?.data || res;
}

function normalizeListName(value) {
  return String(value || '').trim().toLowerCase();
}

export function CardDetailModal({ open, onClose, task, allTasks, lists = [], onSave, onDelete, onMoveToList }) {
  const queryClient = useQueryClient();
  const backendMode = true;
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium', start_date: new Date().toISOString().slice(0, 10), due_date: '', dependencies: [] });
  const [checklist, setChecklist] = useState([]);
  const [currentTask, setCurrentTask] = useState(task);
  const [newLabel, setNewLabel] = useState('');
  const [labelColor, setLabelColor] = useState(LABEL_COLORS[0].value);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [descriptionAiLoading, setDescriptionAiLoading] = useState(false);
  const [coverUploadLoading, setCoverUploadLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  const [showResourcePicker, setShowResourcePicker] = useState(false);
  const [resourcePickerTab, setResourcePickerTab] = useState('browse');
  const [selectedResource, setSelectedResource] = useState(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingStandaloneTask, setEditingStandaloneTask] = useState(null);
  const [taskDraft, setTaskDraft] = useState(null);
  const autoSaveTimer = useRef(null);
  const coverFileInputRef = useRef(null);
  const isExisting = !!task?.id;

  useEffect(() => {
    if (task) {
      setCurrentTask(task);
      setForm({
        title: task.title || '',
        description: task.description || '',
        priority: task.priority || 'medium',
        start_date: task.start_date || '',
        due_date: task.due_date || '',
        dependencies: task.dependencies || [],
        labels: task.labels || [],
        estimate: task.estimate || '',
        cover: task.cover || null,
      });
      setChecklist(normalizeChecklistItems(task.checklist || []));
      setNewLabel('');
      setLabelColor((task.labels && task.labels[0]?.color) || LABEL_COLORS[0].value);
      setSaveStatus('idle');
    } else {
      setCurrentTask(null);
      setForm({ title: '', description: '', priority: 'medium', start_date: new Date().toISOString().slice(0, 10), due_date: '', dependencies: [], labels: [], estimate: '', cover: null });
      setChecklist([]);
      setNewLabel('');
      setLabelColor(LABEL_COLORS[0].value);
      setSaveStatus('idle');
    }
  }, [task, open]);

  useEffect(() => {
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, []);

  const triggerAutoSave = useCallback((newForm, newChecklist) => {
    if (!isExisting) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setSaveStatus('idle');
    autoSaveTimer.current = setTimeout(() => {
      if (!newForm.title.trim()) return;
      setSaveStatus('saving');
      onSave({ ...newForm, checklist: newChecklist });
      setTimeout(() => setSaveStatus('saved'), 300);
      setTimeout(() => setSaveStatus('idle'), 2000);
    }, 800);
  }, [isExisting, onSave]);

  const update = (field, value) => {
    const newForm = { ...form, [field]: value };
    setForm(newForm);
    triggerAutoSave(newForm, checklist);
  };

  const addCheckItem = () => {
    if (!newCheckItem.trim()) return;
    const newChecklist = [...checklist, normalizeChecklistItems([{ text: newCheckItem.trim(), done: false }])[0]];
    setChecklist(newChecklist);
    setNewCheckItem('');
    triggerAutoSave(form, newChecklist);
  };

  const addLabel = () => {
    if (!newLabel.trim()) return;
    const nextLabels = [...(form.labels || []), { id: crypto.randomUUID(), text: newLabel.trim(), color: labelColor }];
    setNewLabel('');
    update('labels', nextLabels);
  };

  const removeLabel = (id) => {
    update('labels', (form.labels || []).filter((label) => label.id !== id));
  };

  const toggleCheckItem = async (i) => {
    const item = checklist[i];
    if (!item) return;

    const nextDone = !item.done;
    const newChecklist = checklist.map((entry, idx) => idx === i ? { ...entry, done: nextDone } : entry);
    setChecklist(newChecklist);
    triggerAutoSave(form, newChecklist);

    if (!item.linked_task_id) return;

    const linkedTask = linkedTasks.find((entry) => entry.id === item.linked_task_id);
    if (!linkedTask) return;

    try {
      await updateTaskWithReminderSync(linkedTask, { status: nextDone ? 'done' : 'todo' });
      queryClient.invalidateQueries({ queryKey: ['linked-tasks', cardId] });
      queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
    } catch (error) {
      toast.error(error?.message || 'Failed to update linked reminder task.');
    }
  };

  const removeCheckItem = (i) => {
    const newChecklist = checklist.filter((_, idx) => idx !== i);
    setChecklist(newChecklist);
    triggerAutoSave(form, newChecklist);
  };

  const generateSubtasks = async () => {
    if (!form.title) return;
    setAiLoading(true);
    try {
      const res = backendMode
        ? await generateCardSubtasks({
          title: form.title,
          description: form.description || '',
        })
        : await legacyCompat.integrations.Core.InvokeLLM({
          prompt: `Break down this task into 3-5 actionable subtasks: "${form.title}". ${form.description ? 'Context: ' + form.description : ''}`,
          response_json_schema: {
            type: 'object',
            properties: {
              subtasks: { type: 'array', items: { type: 'string' } },
            },
          },
        });
      const newItems = normalizeChecklistItems((res?.subtasks || []).map((entry) => ({ text: entry, done: false })));
      const newChecklist = [...checklist, ...newItems];
      setChecklist(newChecklist);
      triggerAutoSave(form, newChecklist);
    } catch { }
    setAiLoading(false);
  };

  const enrichDescription = async () => {
    if (!form.title.trim() && !form.description.trim()) return;
    setDescriptionAiLoading(true);
    try {
      const res = backendMode
        ? await improveCardDescription({
          title: form.title || '',
          description: form.description || '',
          priority: form.priority || 'medium',
          start_date: form.start_date || '',
          due_date: form.due_date || '',
        })
        : await legacyCompat.integrations.Core.InvokeLLM({
          prompt: [
            'You are improving a project management card description.',
            'Rewrite the description so it is clearer, more actionable, and better structured.',
            'Keep the original intent. Do not invent facts. If useful, organize into short paragraphs or concise bullets.',
            form.description.trim()
              ? `Current description:\n${form.description.trim()}`
              : 'There is no current description yet, so draft one from the card context.',
            `Title: ${form.title || 'Untitled card'}`,
            `Priority: ${form.priority || 'medium'}`,
            `Start date: ${form.start_date || 'Not set'}`,
            `Due date: ${form.due_date || 'Not set'}`,
            'Return only the improved description text.',
          ].join('\n\n'),
        });

      const nextDescription = String(res?.description || res?.response || res?.text || res || '').trim();
      if (nextDescription) {
        update('description', nextDescription);
      }
    } catch {
      // Keep existing description unchanged on AI failure.
    } finally {
      setDescriptionAiLoading(false);
    }
  };

  const handleCreate = () => {
    if (!form.title.trim()) return;
    onSave({
      ...form,
      checklist,
      ...(currentTask?.list_id ? { list_id: currentTask.list_id } : {}),
      ...(currentTask?.position !== undefined ? { position: currentTask.position } : {}),
    });
  };

  const handleClose = () => {
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      if (isExisting && form.title.trim()) {
        onSave({ ...form, checklist });
      }
    }
    onClose();
  };

  const completedCount = checklist.filter(i => i.done).length;
  const progress = checklist.length > 0 ? Math.round((completedCount / checklist.length) * 100) : 0;
  const modalTask = currentTask || task;
  const cardId = modalTask?.id || '';
  const backlogList = useMemo(
    () => lists.find((list) => normalizeListName(list.name) === 'backlog') || null,
    [lists],
  );
  const archivedList = useMemo(
    () => lists.find((list) => normalizeListName(list.name) === 'archived') || null,
    [lists],
  );
  const isInBacklog = Boolean(backlogList && modalTask?.list_id === backlogList.id);
  const isArchived = Boolean(archivedList && modalTask?.list_id === archivedList.id);
  const imageAttachments = useMemo(
    () => (modalTask?.attached_files || []).filter((attachment) => (
      attachment?.mimeType?.startsWith('image/') || attachment?.file_type === 'image'
    )),
    [modalTask?.attached_files]
  );

  const { data: cardResourceLinks = [] } = useQuery({
    queryKey: ['card-resource-links', cardId],
    enabled: open && !!cardId && !backendMode,
    queryFn: async () => {
      if (!cardId || !legacyCompat?.entities?.CardResource?.filter) return [];
      return legacyCompat.entities.CardResource.filter({ card_id: cardId });
    },
    initialData: [],
  });

  const { data: allResources = [] } = useQuery({
    queryKey: ['resources'],
    enabled: open && !backendMode,
    queryFn: () => Resource.list('-created_date', 250),
    initialData: [],
  });

  const linkedResources = useMemo(() => {
    if (!cardResourceLinks.length || !allResources.length) return [];
    const resourceById = new Map(allResources.map((resource) => [resource.id, resource]));
    return cardResourceLinks
      .map((link) => {
        const resource = resourceById.get(link.resource_id);
        return resource ? { ...resource, _cardResourceLinkId: link.id } : null;
      })
      .filter(Boolean);
  }, [allResources, cardResourceLinks]);

  const linkedResourceIds = useMemo(() => linkedResources.map((resource) => resource.id), [linkedResources]);
  const { data: linkedTasks = [] } = useQuery({
    queryKey: ['linked-tasks', cardId],
    enabled: open && !!cardId,
    queryFn: async () => {
      const rows = backendMode
        ? await listCardLinkedTasks(cardId)
        : await legacyCompat.entities.Task.filter({ card_id: cardId }).catch(() => []);
      const linkedRows = (rows || []).filter((entry) => entry?.task_kind === 'standalone' || entry?.card_id);
      const reminderLinkedIds = linkedRows
        .filter((entry) => entry?.reminder_enabled && entry?.google_task_id)
        .map((entry) => entry.id);

      if (!reminderLinkedIds.length) return linkedRows;

      try {
        const syncedTasks = backendMode
          ? await syncCardLinkedTasks(cardId, reminderLinkedIds)
          : (await syncGoogleLinkedTasks(reminderLinkedIds))?.tasks || [];
        if (!syncedTasks.length) return linkedRows;
        const syncedById = new Map(syncedTasks.map((entry) => [entry.id, entry]));
        return linkedRows.map((entry) => syncedById.get(entry.id) || entry);
      } catch {
        return linkedRows;
      }
    },
    initialData: [],
  });

  useEffect(() => {
    if (!open || !modalTask?.id || !linkedTasks.length || !checklist.length) return;

    const nextChecklist = checklist.map((item) => {
      if (!item.linked_task_id) return item;
      const linkedTask = linkedTasks.find((entry) => entry.id === item.linked_task_id);
      if (!linkedTask) return item;
      return { ...item, done: linkedTask.status === 'done' };
    });

    const hasChanges = nextChecklist.some((item, index) => (
      item.done !== checklist[index]?.done || item.linked_task_id !== checklist[index]?.linked_task_id
    ));

    if (!hasChanges) return;

    setChecklist(nextChecklist);
    triggerAutoSave(form, nextChecklist);
  }, [checklist, form, linkedTasks, modalTask?.id, open, triggerAutoSave]);

  const updateCover = (cover) => {
    update('cover', cover);
    setCurrentTask((prev) => (prev ? { ...prev, cover } : prev));
  };

  const handleModalOpenChange = (nextOpen) => {
    if (!nextOpen) handleClose();
  };

  const handleActionClick = (event, action) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  };

  const handleMoveToList = (list) => {
    if (!modalTask?.id || !list || !onMoveToList) return;
    onMoveToList(modalTask, list);
    setCurrentTask((prev) => (prev ? { ...prev, list_id: list.id } : prev));
  };

  const handleUploadCoverClick = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!modalTask?.id) {
      toast.error('Create the card first, then upload a custom cover image.');
      return;
    }

    coverFileInputRef.current?.click();
  };

  const handleCoverUploadChange = async (event) => {
    const file = event.target.files?.[0];
    if (coverFileInputRef.current) coverFileInputRef.current.value = '';
    if (!file || !modalTask?.id) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Cover upload only supports image files.');
      return;
    }

    if (file.size > MAX_COVER_UPLOAD_SIZE) {
      toast.error('Cover image must be 2 MB or smaller.');
      return;
    }

    setCoverUploadLoading(true);
    try {
      let nextAttachedFiles = [];
      let coverValue = '';

      if (backendMode) {
        const upload = await uploadFileToManagedStorage({ file, cardId: modalTask.id });
        const result = await addCardAttachmentMetadata(modalTask.id, {
          name: file.name,
          url: upload.signedUrl,
          webViewLink: upload.signedUrl,
          mimeType: file.type,
          size: file.size,
          provider: 'supabase_storage',
          file_type: 'image',
          storage_bucket: upload.bucket,
          storage_path: upload.path,
        });

        nextAttachedFiles = result?.card?.attached_files || [];
        coverValue = getAttachmentImageUrl(result?.attachment) || upload.signedUrl;
        setCurrentTask(result?.card || null);
      } else {
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

        const data = await invokeFunction('uploadCardDriveFile', {
          cardId: modalTask.id,
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

        nextAttachedFiles = data.attachedFiles || [...(modalTask?.attached_files || []), data.attachment].filter(Boolean);
        coverValue = getAttachmentImageUrl(data.attachment) || getAttachmentImageUrl(nextAttachedFiles.find((attachment) => (
          attachment?.name === file.name && (attachment?.mimeType?.startsWith('image/') || attachment?.file_type === 'image')
        )));

        setCurrentTask((prev) => ({
          ...(prev || {}),
          attached_files: nextAttachedFiles,
          drive_folder_id: data.folder?.folderId || prev?.drive_folder_id || modalTask?.drive_folder_id || '',
        }));
      }

      if (!coverValue) {
        throw new Error('Image uploaded, but no usable cover URL was returned.');
      }

      updateCover({ type: 'image', value: coverValue, source: 'upload' });
      toast.success(`${file.name} uploaded and set as the card cover.`);
    } catch (error) {
      toast.error(error?.message || 'Failed to upload cover image.');
    } finally {
      setCoverUploadLoading(false);
    }
  };

  const handleUnlinkResource = async (resource) => {
    if (backendMode) return;
    if (!resource?._cardResourceLinkId) return;
    try {
      await CardResource.delete(resource._cardResourceLinkId);
      queryClient.invalidateQueries({ queryKey: ['card-resource-links', cardId] });
      toast.success('Resource unlinked from this card.');
    } catch (error) {
      toast.error(error?.message || 'Failed to unlink resource.');
    }
  };

  const openResourcePicker = (tab = 'browse') => {
    if (backendMode) {
      toast.message('Resource linking comes back in phase 3. The core board cutover is already live.');
      return;
    }
    if (!modalTask?.id) {
      toast.error('Create the card first before linking resources.');
      return;
    }
    setResourcePickerTab(tab);
    setShowResourcePicker(true);
  };

  const openCreateLinkedTask = (draft = {}) => {
    setEditingStandaloneTask(null);
    setTaskDraft({
      title: draft.title || '',
      description: draft.description || '',
      status: draft.status || 'todo',
      priority: draft.priority || form.priority || 'medium',
      workspace_id: modalTask?.workspace_id || modalTask?.project_id || '',
      card_id: modalTask?.id || '',
      source_checklist_item_id: draft.source_checklist_item_id || '',
      due_date: draft.due_date || '',
      due_time: draft.due_time || '',
      card_title: modalTask?.title || '',
    });
    setTaskModalOpen(true);
  };

  const handleTaskCreated = (createdTask) => {
    if (!createdTask?.source_checklist_item_id) return;
    const nextChecklist = checklist.map((item) => (
      item.id === createdTask.source_checklist_item_id
        ? { ...item, linked_task_id: createdTask.id, done: createdTask.status === 'done' }
        : item
    ));
    setChecklist(nextChecklist);
    triggerAutoSave(form, nextChecklist);
  };

  const handleCreateCardReminder = async () => {
    if (!modalTask?.id) {
      toast.error('Create the card first before creating a reminder.');
      return;
    }

    try {
      await createReminderFromCard(modalTask.id);
      queryClient.invalidateQueries({ queryKey: ['linked-tasks', cardId] });
      queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
      toast.success('Google reminder created for this card.');
    } catch (error) {
      toast.error(error?.message || 'Failed to create reminder for this card.');
    }
  };

  const handleCreateChecklistReminder = async (item) => {
    if (!modalTask?.id || !item?.id) return;

    try {
      const result = await createReminderFromChecklist(modalTask.id, item.id);
      const createdTask = result?.task;
      if (createdTask?.source_checklist_item_id) {
        const nextChecklist = checklist.map((entry) => (
          entry.id === createdTask.source_checklist_item_id
            ? { ...entry, linked_task_id: createdTask.id, done: createdTask.status === 'done' }
            : entry
        ));
        setChecklist(nextChecklist);
        triggerAutoSave(form, nextChecklist);
      }
      queryClient.invalidateQueries({ queryKey: ['linked-tasks', cardId] });
      queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
      toast.success('Checklist reminder created in Google Tasks.');
    } catch (error) {
      toast.error(error?.message || 'Failed to create checklist reminder.');
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={handleModalOpenChange}>
      <ResponsiveModalContent className="bg-[#161820] border-border max-w-3xl w-[min(96vw,56rem)] max-h-[90vh] overflow-y-auto overflow-x-hidden p-0" mobileClassName="bg-[#161820] border-border">
        <input
          ref={coverFileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleCoverUploadChange}
        />
        <div className="flex items-center justify-end gap-3 border-b border-border/50 px-4 pb-3 pt-5 sm:px-6">
          <div className="flex min-h-8 items-center gap-2">
            {isExisting && saveStatus === 'saving' && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Saving...
              </span>
            )}
            {isExisting && saveStatus === 'saved' && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
            {modalTask?.id && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleMoveToList(backlogList)}
                disabled={!backlogList || isInBacklog}
                aria-label="Put card in backlog"
                title="Put card in backlog"
                className="h-8 w-8 p-0 text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-35"
              >
                <Inbox className="w-4 h-4" />
              </Button>
            )}
            {modalTask?.id && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleMoveToList(archivedList)}
                disabled={!archivedList || isArchived}
                aria-label="Archive card"
                title="Archive card"
                className="h-8 w-8 p-0 text-muted-foreground hover:bg-secondary/60 hover:text-foreground disabled:opacity-35"
              >
                <Archive className="w-4 h-4" />
              </Button>
            )}
            {modalTask?.id && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDelete(modalTask.id)}
                aria-label="Delete card"
                title="Delete card"
                className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            {!isExisting && (
              <Button type="button" size="sm" onClick={handleCreate} disabled={!form.title.trim()} className="h-8 bg-primary hover:bg-primary/90 text-white text-xs">
                Create
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-5 overflow-x-hidden px-4 py-5 sm:px-6">
          <div className="space-y-3">
            {form.cover && (
              <div
                className="w-full h-28 rounded-2xl border border-border/40 overflow-hidden"
                style={form.cover?.type === 'color' ? { background: form.cover.value } : undefined}
              >
                {form.cover?.type === 'image' && form.cover?.value ? (
                  <img src={form.cover.value} alt="Card cover" className="w-full h-full object-cover" />
                ) : null}
              </div>
            )}
            <input
              value={form.title}
              onChange={e => update('title', e.target.value)}
              placeholder="Task title..."
              className="w-full bg-transparent text-xl font-bold text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 overflow-hidden sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Tag className="w-3 h-3" /> Priority
              </span>
              <div className="flex gap-1">
                {['low', 'medium', 'high'].map(p => (
                  <button key={p} type="button" onClick={() => update('priority', p)}
                    className={cn('text-[10px] px-2 py-1 rounded-lg border font-medium capitalize transition-all',
                      form.priority === p ? priorityColors[p] : 'bg-secondary/30 border-border/30 text-muted-foreground hover:bg-secondary/50'
                    )}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <CalendarRange className="w-3 h-3" /> Start Date
              </span>
              <input
                type="date"
                value={form.start_date}
                onChange={e => update('start_date', e.target.value)}
                className="bg-secondary/40 border border-border/50 rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Due Date
              </span>
              <input
                type="date"
                value={form.due_date}
                onChange={e => update('due_date', e.target.value)}
                className="bg-secondary/40 border border-border/50 rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Clock3 className="w-3 h-3" /> Estimate
              </span>
              <input
                type="text"
                value={form.estimate || ''}
                onChange={e => update('estimate', e.target.value)}
                placeholder="2h, 1d, 5 pts"
                className="bg-secondary/40 border border-border/50 rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Tag className="w-3 h-3" /> Labels
              </label>
            </div>
            {(form.labels || []).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(form.labels || []).map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px]"
                    style={{ backgroundColor: `${label.color}1a`, borderColor: `${label.color}55`, color: label.color }}
                  >
                    {label.text}
                    <button
                      type="button"
                      onClick={(event) => handleActionClick(event, () => removeLabel(label.id))}
                      className="hover:text-red-300"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addLabel()}
                placeholder="Add a label"
                className="min-w-0 flex-1 bg-secondary/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="flex items-center gap-1">
                {LABEL_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={(event) => handleActionClick(event, () => setLabelColor(color.value))}
                    className={cn('w-6 h-6 rounded-full border-2 transition-transform', labelColor === color.value ? 'scale-110 border-white/80' : 'border-transparent')}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={(event) => handleActionClick(event, addLabel)}
                className="px-3 py-1.5 rounded-lg bg-secondary/50 hover:bg-secondary text-sm text-foreground transition-colors"
              >
                Add
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Palette className="w-3 h-3" /> Cover
              </label>
              {form.cover && (
                <button
                  type="button"
                  onClick={(event) => handleActionClick(event, () => updateCover(null))}
                  className="text-[10px] px-2 py-1 rounded-lg bg-secondary/40 text-muted-foreground hover:text-foreground"
                >
                  Clear Cover
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {COVER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={(event) => handleActionClick(event, () => updateCover({ type: 'color', value: color }))}
                  className={cn('w-10 h-10 rounded-xl border transition-transform', form.cover?.type === 'color' && form.cover?.value === color ? 'scale-105 border-white/80' : 'border-border/40')}
                  style={{ background: color }}
                  title="Use color cover"
                />
              ))}
            </div>

            <div className="space-y-2">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Preset Covers</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {COVER_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={(event) => handleActionClick(event, () => updateCover({ type: 'image', value: preset.url, source: 'preset' }))}
                    className={cn(
                      'group overflow-hidden rounded-xl border border-border/40 text-left transition-all hover:border-primary/40',
                      form.cover?.type === 'image' && form.cover?.value === preset.url ? 'ring-2 ring-primary/60' : ''
                    )}
                  >
                    <div className="h-20 w-full overflow-hidden">
                      <img src={preset.url} alt={preset.label} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    </div>
                    <div className="px-2 py-1.5 text-[11px] text-muted-foreground">{preset.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleUploadCoverClick}
                disabled={coverUploadLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-secondary/20 px-3 py-2 text-xs text-foreground hover:bg-secondary/40 disabled:opacity-50"
              >
                {coverUploadLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                Upload Cover Image
              </button>
              <span className="text-[11px] text-muted-foreground">PNG, JPG, WEBP up to 2 MB</span>
            </div>

            {imageAttachments.length > 0 && (
              <div className="space-y-2">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Attachment Images</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {imageAttachments.map((attachment) => {
                    const attachmentUrl = getAttachmentImageUrl(attachment);
                    if (!attachmentUrl) return null;
                    return (
                      <button
                        key={attachment.id || attachmentUrl}
                        type="button"
                        onClick={(event) => handleActionClick(event, () => updateCover({ type: 'image', value: attachmentUrl, source: 'attachment' }))}
                        className={cn(
                          'group overflow-hidden rounded-xl border border-border/40 text-left transition-all hover:border-primary/40',
                          form.cover?.type === 'image' && form.cover?.value === attachmentUrl ? 'ring-2 ring-primary/60' : ''
                        )}
                      >
                        <div className="h-20 w-full overflow-hidden bg-secondary/20">
                          <img src={attachmentUrl} alt={attachment.name || 'Attachment cover'} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        </div>
                        <div className="truncate px-2 py-1.5 text-[11px] text-muted-foreground">
                          {attachment.name || 'Attachment image'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {imageAttachments.length === 0 && (
              <div className="rounded-xl border border-dashed border-border/40 px-3 py-3 text-xs text-muted-foreground">
                Upload a cover image or add image attachments to reuse them here.
              </div>
            )}
          </div>

          {(allTasks || []).length > 0 && (
            <div>
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-2">
                <Link2 className="w-3 h-3" /> Dependencies
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2 max-w-full">
                {(form.dependencies || []).map(depId => {
                  const depTask = (allTasks || []).find(t => t.id === depId);
                  return (
                    <span key={depId} className="flex items-center gap-1 max-w-full text-[11px] px-2 py-1 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20">
                      <span className="truncate max-w-[14rem]">{depTask?.title || depId}</span>
                      <button type="button" onClick={() => update('dependencies', form.dependencies.filter(d => d !== depId))} className="hover:text-red-400">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
              <select
                value=""
                onChange={e => {
                  if (e.target.value && !form.dependencies.includes(e.target.value)) {
                    update('dependencies', [...(form.dependencies || []), e.target.value]);
                  }
                }}
                className="w-full bg-secondary/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="">Add a dependency...</option>
                {(allTasks || []).filter(t => t.id !== modalTask?.id && !(form.dependencies || []).includes(t.id)).map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <AlignLeft className="w-3 h-3" /> Description
              </label>
              <button
                type="button"
                onClick={enrichDescription}
                disabled={descriptionAiLoading || (!form.title.trim() && !form.description.trim())}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition-colors disabled:opacity-40"
              >
                {descriptionAiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                {form.description.trim() ? 'Refine' : 'Enrich'}
              </button>
            </div>
            <Textarea
              value={form.description}
              onChange={e => update('description', e.target.value)}
              placeholder="Add a more detailed description, then use AI to enrich or refine it..."
              className="bg-secondary/30 border-border/50 min-h-[100px] text-sm resize-none focus:ring-primary/50"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <BookOpen className="w-3 h-3" /> Resources
              </label>
              {!backendMode && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openResourcePicker('suggest')}
                    disabled={!modalTask?.id}
                    className="flex items-center gap-1 rounded-lg bg-sky-500/10 px-2 py-1 text-[10px] text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-40"
                  >
                    <Sparkles className="w-3 h-3" />
                    Suggest
                  </button>
                  <button
                    type="button"
                    onClick={() => openResourcePicker('browse')}
                    disabled={!modalTask?.id}
                    className="flex items-center gap-1 rounded-lg bg-violet-500/10 px-2 py-1 text-[10px] text-violet-300 transition-colors hover:bg-violet-500/20 disabled:opacity-40"
                  >
                    <Plus className="w-3 h-3" />
                    Add Resource
                  </button>
                </div>
              )}
            </div>

            {backendMode ? (
              <div className="rounded-xl border border-dashed border-border/40 px-3 py-4 text-sm text-muted-foreground">
                Resource linking is intentionally deferred to the next migration phase so the core board, tasks, comments, reminders, and attachments can stay stable on the new backend first.
              </div>
            ) : linkedResources.length > 0 ? (
              <div className="space-y-2">
                {linkedResources.map((resource) => (
                  <div key={resource._cardResourceLinkId || resource.id} className="rounded-xl border border-border/50 bg-secondary/20 p-3">
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => setSelectedResource(resource)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-medium text-foreground hover:text-primary">
                          {resource.title}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {resource.summary || resource.main_topic || resource.author || 'No summary available yet.'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {resource.resource_type || 'resource'}
                          </span>
                          {(resource.tags || []).slice(0, 3).map((tag) => (
                            <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        {resource.url && (
                          <a
                            href={resource.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                            title="Open source"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => handleUnlinkResource(resource)}
                          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-300"
                          title="Unlink resource"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/40 px-3 py-4 text-sm text-muted-foreground">
                Link saved resources to this card so the context stays reusable and easy to revisit.
              </div>
            )}
          </div>

          {modalTask?.id && (
            <FileAttachmentSection
              task={modalTask}
              onUpdate={(patch) => {
                if (!patch) return;
                setCurrentTask((prev) => ({ ...(prev || {}), ...patch }));
              }}
            />
          )}

          {modalTask?.id && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> Linked Tasks & Reminders
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCreateCardReminder}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors"
                  >
                    <BellRing className="w-3 h-3" />
                    Create Reminder
                  </button>
                  <button
                    type="button"
                    onClick={() => openCreateLinkedTask({ title: `Follow up: ${form.title || modalTask?.title || ''}` })}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Create Linked Task
                  </button>
                </div>
              </div>

              {linkedTasks.length > 0 ? (
                <div className="space-y-2">
                  {linkedTasks.map((linkedTask) => (
                    <button
                      key={linkedTask.id}
                      type="button"
                      onClick={() => {
                        setTaskDraft(null);
                        setEditingStandaloneTask(linkedTask);
                        setTaskModalOpen(true);
                      }}
                      className="w-full rounded-xl border border-border/50 bg-secondary/20 p-3 text-left transition-colors hover:bg-secondary/40"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-foreground">{linkedTask.title}</p>
                        <span className="rounded-full bg-background/60 px-2 py-1 text-[10px] capitalize text-muted-foreground">
                          {linkedTask.status || 'todo'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-background/60 px-2 py-1 capitalize">{linkedTask.priority || 'medium'}</span>
                        {isReminderLinked(linkedTask) ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-sky-300">
                            <BellRing className="h-3 w-3" />
                            Google reminder
                          </span>
                        ) : null}
                        {linkedTask.due_date ? (
                          <span className="rounded-full bg-background/60 px-2 py-1">Due {linkedTask.due_date}</span>
                        ) : (
                          <span className="rounded-full bg-background/60 px-2 py-1">No due date</span>
                        )}
                      </div>
                      {isReminderLinked(linkedTask) ? (
                        <div className="mt-2">
                          <a
                            href={getGoogleTasksAppUrl()}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:underline"
                          >
                            Open in Google Tasks
                          </a>
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/40 px-3 py-4 text-sm text-muted-foreground">
                  Promote checklist items or create linked tasks here when a card step becomes time-relevant work.
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <CheckSquare className="w-3 h-3" /> Checklist
                {checklist.length > 0 && (
                  <span className="ml-2 text-foreground/60 normal-case tracking-normal">
                    {completedCount}/{checklist.length}
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={generateSubtasks}
                disabled={aiLoading || !form.title}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors disabled:opacity-40"
              >
                {aiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                AI Generate
              </button>
            </div>

            {checklist.length > 0 && (
              <div className="h-1.5 bg-secondary/50 rounded-full mb-3 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            )}

            <div className="space-y-1.5">
              {checklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2 group">
                  <button
                    type="button"
                    onClick={() => toggleCheckItem(i)}
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all',
                      item.done ? 'bg-emerald-500 border-emerald-500' : 'border-border hover:border-primary/50'
                    )}
                  >
                    {item.done && <span className="text-white text-[8px]">✓</span>}
                  </button>
                  <span className={cn('text-sm flex-1', item.done && 'line-through text-muted-foreground')}>{item.text}</span>
                  {item.linked_task_id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const linkedTask = linkedTasks.find((entry) => entry.id === item.linked_task_id);
                          if (!linkedTask) return;
                          setTaskDraft(null);
                          setEditingStandaloneTask(linkedTask);
                          setTaskModalOpen(true);
                        }}
                        className="rounded-md px-2 py-1 text-[10px] text-sky-300 hover:bg-sky-500/10"
                      >
                        Open Task
                      </button>
                      {(() => {
                        const linkedTask = linkedTasks.find((entry) => entry.id === item.linked_task_id);
                        if (!isReminderLinked(linkedTask)) return null;
                        return (
                          <a
                            href={getGoogleTasksAppUrl()}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="rounded-md px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-500/10"
                          >
                            Google
                          </a>
                        );
                      })()}
                    </div>
                  ) : (
                    modalTask?.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openCreateLinkedTask({
                            title: item.text,
                            status: item.done ? 'done' : 'todo',
                            source_checklist_item_id: item.id,
                          })}
                          className="rounded-md px-2 py-1 text-[10px] text-sky-300 hover:bg-sky-500/10"
                        >
                          Promote to Task
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCreateChecklistReminder(item)}
                          className="rounded-md px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-500/10"
                        >
                          Create Reminder
                        </button>
                      </div>
                    ) : null
                  )}
                  <button type="button" onClick={() => removeCheckItem(i)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-all">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-2">
              <input
                value={newCheckItem}
                onChange={e => setNewCheckItem(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCheckItem()}
                placeholder="Add an item..."
                className="flex-1 bg-secondary/30 border border-border/50 rounded-lg px-3 py-1.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <button type="button" onClick={addCheckItem} className="px-3 py-1.5 rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {modalTask?.id && <CardCommentsSection cardId={modalTask.id} />}
        </div>
      </ResponsiveModalContent>

      {!backendMode && (
        <ResourceLinkPickerModal
          open={showResourcePicker}
          onClose={() => setShowResourcePicker(false)}
          card={modalTask}
          linkedResourceIds={linkedResourceIds}
          initialTab={resourcePickerTab}
          onLinked={() => {
            queryClient.invalidateQueries({ queryKey: ['card-resource-links', cardId] });
          }}
        />
      )}

      {!backendMode && selectedResource && (
        <ResourceDetailModal
          open={!!selectedResource}
          onClose={() => setSelectedResource(null)}
          resource={selectedResource}
        />
      )}

      <StandaloneTaskDetailModal
        open={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false);
          setEditingStandaloneTask(null);
          setTaskDraft(null);
        }}
        task={editingStandaloneTask}
        initialValues={taskDraft}
        cardContext={modalTask}
        onCreated={handleTaskCreated}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['linked-tasks', cardId] });
          queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
        }}
        onDeleted={() => {
          queryClient.invalidateQueries({ queryKey: ['linked-tasks', cardId] });
          queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
        }}
      />
    </ResponsiveModal>
  );
}

export function TaskDetailModal(props) {
  return <CardDetailModal {...props} />;
}

export default CardDetailModal;
