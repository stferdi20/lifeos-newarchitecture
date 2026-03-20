import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Clock3, Link2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import {
  createReminderForTask,
  disconnectReminderForTask,
  getGoogleTasksAppUrl,
  isReminderLinked,
  syncReminderForTask,
  updateReminderForTask,
} from '@/lib/googleReminderSync';
import {
  createStandaloneTaskRecord,
  deleteStandaloneTaskRecord,
  sanitizeTaskPayload,
  updateStandaloneTaskRecord,
} from '@/lib/tasks';

const EMPTY_FORM = {
  title: '',
  status: 'todo',
  priority: 'medium',
  due_date: '',
  due_time: '',
  description: '',
  workspace_id: '',
  card_id: '',
  source_checklist_item_id: '',
  google_task_id: '',
  google_task_list_id: '',
  google_sync_status: '',
  google_last_synced_at: '',
  reminder_enabled: false,
  reminder_source: 'task',
};

export default function TaskDetailModal({
  open,
  onClose,
  task = null,
  initialValues = null,
  cardContext = null,
  onCreated,
  onSaved,
  onDeleted,
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const isExisting = Boolean(task?.id);

  useEffect(() => {
    if (!open) return;

    const source = task || initialValues || EMPTY_FORM;
    setForm({
      title: source.title || '',
      status: source.status || 'todo',
      priority: source.priority || 'medium',
      due_date: source.due_date || '',
      due_time: source.due_time || '',
      description: source.description || '',
      workspace_id: source.workspace_id || '',
      card_id: source.card_id || '',
      source_checklist_item_id: source.source_checklist_item_id || '',
      google_task_id: source.google_task_id || '',
      google_task_list_id: source.google_task_list_id || '',
      google_sync_status: source.google_sync_status || '',
      google_last_synced_at: source.google_last_synced_at || '',
      reminder_enabled: Boolean(source.reminder_enabled),
      reminder_source: source.reminder_source || (source.source_checklist_item_id ? 'checklist' : 'task'),
    });
  }, [open, task, initialValues]);

  const resolvedCardTitle = cardContext?.title || task?.card_title || initialValues?.card_title || '';
  const resolvedCardDueDate = cardContext?.due_date || '';
  const hasSourceChecklist = Boolean(form.source_checklist_item_id);
  const canSave = form.title.trim().length > 0;
  const reminderLinked = isReminderLinked(task || form);
  const reminderStatus = (task?.google_sync_status || form.google_sync_status || '').trim();

  const saveLabel = useMemo(() => {
    if (isExisting) return 'Save Task';
    return hasSourceChecklist ? 'Create Linked Task' : 'Create Task';
  }, [hasSourceChecklist, isExisting]);

  const invalidateTaskQueries = (cardId) => {
    queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['task-cards'] });
    queryClient.invalidateQueries({ queryKey: ['task-workspaces'] });
    if (cardId) queryClient.invalidateQueries({ queryKey: ['linked-tasks', cardId] });
  };

  const handleSave = async () => {
    if (!canSave) return;

    try {
      const payload = sanitizeTaskPayload(form);
      const savedTask = isExisting
        ? await updateStandaloneTaskRecord(task.id, payload)
        : await createStandaloneTaskRecord(payload);
      const finalTask = isExisting && isReminderLinked(savedTask)
        ? await updateReminderForTask(savedTask.id).then((res) => res?.task || savedTask).catch(() => savedTask)
        : savedTask;

      invalidateTaskQueries(finalTask.card_id || payload.card_id);
      toast.success(isExisting ? 'Task updated.' : 'Task created.');
      if (isExisting) onSaved?.(finalTask);
      else onCreated?.(finalTask);
      onClose?.();
    } catch (error) {
      toast.error(error?.message || 'Failed to save task.');
    }
  };

  const handleDelete = async () => {
    if (!task?.id) return;
    try {
      await deleteStandaloneTaskRecord(task.id);
      invalidateTaskQueries(task.card_id);
      toast.success('Task deleted.');
      onDeleted?.(task);
      onClose?.();
    } catch (error) {
      toast.error(error?.message || 'Failed to delete task.');
    }
  };

  const handleCreateReminder = async () => {
    if (!task?.id) {
      toast.error('Save this task first before linking it to Google Tasks.');
      return;
    }

    try {
      const result = await createReminderForTask(task.id);
      if (result?.task) setForm((prev) => ({ ...prev, ...result.task }));
      invalidateTaskQueries(task.card_id);
      onSaved?.(result?.task || task);
      toast.success('Google reminder created.');
    } catch (error) {
      toast.error(error?.message || 'Failed to create Google reminder.');
    }
  };

  const handleSyncReminder = async () => {
    if (!task?.id) return;

    try {
      const result = await syncReminderForTask(task.id);
      if (result?.task) setForm((prev) => ({ ...prev, ...result.task }));
      invalidateTaskQueries(task.card_id);
      onSaved?.(result?.task || task);
      toast.success('Google reminder synced.');
    } catch (error) {
      toast.error(error?.message || 'Failed to sync Google reminder.');
    }
  };

  const handleDisconnectReminder = async () => {
    if (!task?.id) return;

    try {
      const result = await disconnectReminderForTask(task.id);
      if (result?.task) setForm((prev) => ({ ...prev, ...result.task }));
      invalidateTaskQueries(task.card_id);
      onSaved?.(result?.task || task);
      toast.success('Google reminder disconnected.');
    } catch (error) {
      toast.error(error?.message || 'Failed to disconnect Google reminder.');
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="max-w-2xl border-border bg-[#161820]">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{isExisting ? 'Task Details' : 'New Task'}</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Standalone tasks are time-relevant action items. Cards stay as higher-level project containers.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-5 px-4 pb-4 sm:px-6">
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Title</label>
            <Input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="What needs to happen?"
              className="border-border/50 bg-secondary/20"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Status</label>
              <Select value={form.status} onValueChange={(status) => setForm((prev) => ({ ...prev, status }))}>
                <SelectTrigger className="border-border/50 bg-secondary/20">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="doing">Doing</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Priority</label>
              <Select value={form.priority} onValueChange={(priority) => setForm((prev) => ({ ...prev, priority }))}>
                <SelectTrigger className="border-border/50 bg-secondary/20">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Due Date</label>
              <Input
                type="date"
                value={form.due_date}
                onChange={(event) => setForm((prev) => ({ ...prev, due_date: event.target.value }))}
                className="border-border/50 bg-secondary/20"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Due Time</label>
              <Input
                type="time"
                value={form.due_time}
                onChange={(event) => setForm((prev) => ({ ...prev, due_time: event.target.value }))}
                className="border-border/50 bg-secondary/20"
              />
            </div>
          </div>

          {resolvedCardTitle ? (
            <div className="rounded-2xl border border-border/40 bg-secondary/10 p-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium text-foreground">Linked Card</p>
                  <p className="truncate">{resolvedCardTitle}</p>
                  {resolvedCardDueDate ? (
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, due_date: resolvedCardDueDate }))}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Clock3 className="h-3 w-3" />
                      Use card due date ({resolvedCardDueDate})
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {hasSourceChecklist ? (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-200">
              <div className="flex items-start gap-2">
                <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>This task will stay linked to its originating checklist item so the card can show promotion state without turning checklist items into first-class tasks.</p>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</label>
            <Textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Add context, constraints, or next steps..."
              className="min-h-[120px] border-border/50 bg-secondary/20"
            />
          </div>

          <div className="rounded-2xl border border-border/40 bg-secondary/10 p-3 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="font-medium text-foreground">Google Reminder</p>
                <p className="text-muted-foreground">
                  {reminderLinked
                    ? `Linked to Google Tasks${reminderStatus ? ` • ${reminderStatus}` : ''}`
                    : 'Create a Google Task manually from this item when you want a reminder.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {reminderLinked ? (
                  <>
                    <Button type="button" variant="outline" onClick={handleSyncReminder}>Sync</Button>
                    <Button type="button" variant="outline" asChild>
                      <a href={getGoogleTasksAppUrl()} target="_blank" rel="noreferrer">Open Google Tasks</a>
                    </Button>
                    <Button type="button" variant="ghost" onClick={handleDisconnectReminder}>Disconnect</Button>
                  </>
                ) : (
                  <Button type="button" variant="outline" onClick={handleCreateReminder} disabled={!isExisting}>
                    Create Google Reminder
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        <ResponsiveModalFooter>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-between">
            <div>
              {isExisting ? (
                <Button variant="ghost" onClick={handleDelete} className="text-red-300 hover:text-red-200">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              ) : null}
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={!canSave}>{saveLabel}</Button>
            </div>
          </div>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
