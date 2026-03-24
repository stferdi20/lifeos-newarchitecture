import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageActionRow, PageHeader } from '@/components/layout/page-header';
import { MobileFilterDrawer } from '@/components/layout/MobileFilterDrawer';
import TaskDetailModal from '@/components/tasks/TaskDetailModal';
import { updateTaskWithReminderSync } from '@/lib/googleReminderSync';
import TaskRow from '@/components/tasks/TaskRow';
import { useStandaloneTasks } from '@/hooks/useStandaloneTasks';
import { getTaskCounts } from '@/lib/tasks';

const FILTER_OPTIONS = [
  { id: 'active', label: 'Active' },
  { id: 'all', label: 'All' },
  { id: 'due', label: 'Due Soon' },
  { id: 'linked', label: 'Linked to Card' },
  { id: 'personal', label: 'Personal' },
];

export default function Tasks() {
  const queryClient = useQueryClient();
  const { tasks, isLoading, isError } = useStandaloneTasks();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  const counts = useMemo(() => getTaskCounts(tasks), [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const searchValue = search.trim().toLowerCase();
      const matchesSearch = !searchValue || `${task.title} ${task.description || ''} ${task.workspace_name || ''} ${task.card_title || ''}`.toLowerCase().includes(searchValue);
      if (!matchesSearch) return false;

      if (filter === 'active') return task.status !== 'done';
      if (filter === 'due') return task.due_bucket === 'overdue' || task.due_bucket === 'today';
      if (filter === 'linked') return Boolean(task.card_id);
      if (filter === 'personal') return !task.card_id;
      return true;
    });
  }, [filter, search, tasks]);

  const handleStatusChange = async (task, status) => {
    try {
      await updateTaskWithReminderSync(task, { status });
      queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
      if (task.card_id) queryClient.invalidateQueries({ queryKey: ['linked-tasks', task.card_id] });
    } catch (error) {
      toast.error(error?.message || 'Failed to update task status.');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CheckSquare}
        title="Tasks"
        description="Real action items live here. Cards stay high-level, and checklist items can be promoted when they need dates, priority, or tracking."
        actions={(
          <PageActionRow>
            <Button onClick={() => { setEditingTask(null); setModalOpen(true); }}>
              <Plus className="h-4 w-4" />
              New Task
            </Button>
          </PageActionRow>
        )}
      />

      <section className="grid gap-3 md:grid-cols-4">
        {[
          ['To Do', counts.todo, 'bg-zinc-500/10 text-zinc-300'],
          ['Doing', counts.doing, 'bg-blue-500/10 text-blue-300'],
          ['Done', counts.done, 'bg-emerald-500/10 text-emerald-300'],
          ['Overdue', counts.overdue, 'bg-red-500/10 text-red-300'],
        ].map(([label, count, className]) => (
          <div key={label} className={`rounded-2xl border border-border/40 p-4 ${className}`}>
            <p className="text-xs uppercase tracking-[0.2em] opacity-75">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{count}</p>
          </div>
        ))}
      </section>

      <section className="rounded-3xl border border-border/40 bg-card/50 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full max-w-xl flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tasks, cards, and workspaces..."
                className="border-border/50 bg-secondary/20 pl-9"
              />
            </div>
            <div className="md:hidden flex-[0_0_auto] max-w-[110px]">
              <MobileFilterDrawer activeCount={filter !== 'active' ? 1 : 0} triggerClassName="w-full h-full">
                <div className="flex flex-col gap-2">
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setFilter(option.id)}
                      className={`flex items-center px-4 py-3 rounded-xl text-sm font-medium border transition-all text-left ${
                        filter === option.id
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'bg-secondary/20 border-border/30 text-muted-foreground hover:bg-secondary/40'
                      }`}
                    >
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              </MobileFilterDrawer>
            </div>
          </div>

          <div className="hidden md:flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  filter === option.id ? 'bg-primary text-primary-foreground' : 'bg-secondary/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-border/40 px-4 py-8 text-sm text-muted-foreground">Loading tasks...</div>
          ) : null}

          {!isLoading && isError ? (
            <div className="rounded-2xl border border-dashed border-red-500/30 px-4 py-8 text-sm text-red-200">
              We could not load tasks right now. Try again in a moment.
            </div>
          ) : null}

          {!isLoading && !isError && filteredTasks.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/40 px-4 py-8 text-sm text-muted-foreground">
              No tasks match this view yet. Create one directly here or promote a checklist item from a project card.
            </div>
          ) : null}

          {!isLoading && !isError && filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onOpen={(nextTask) => { setEditingTask(nextTask); setModalOpen(true); }}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      </section>

      <TaskDetailModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingTask(null); }}
        task={editingTask}
      />
    </div>
  );
}
