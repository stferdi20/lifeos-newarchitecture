import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckSquare, Flame, ListChecks, Play, Plus, Search, Sparkles } from 'lucide-react';
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
  { id: 'plan', label: 'Plan' },
  { id: 'all', label: 'All' },
  { id: 'due', label: 'Due Soon' },
  { id: 'linked', label: 'Linked to Card' },
  { id: 'personal', label: 'Personal' },
];

const getTodayInputValue = () => {
  const today = new Date();
  const offsetDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
};

const getPlanCandidateScore = (task) => {
  if (task.status === 'done') return -1;

  let score = 0;
  if (task.status === 'doing') score += 40;
  if (task.due_bucket === 'overdue') score += 35;
  if (task.due_bucket === 'today') score += 30;
  if (task.priority === 'high') score += 20;
  if (task.card_id) score += 6;
  if (task.reminder_enabled) score += 4;
  if (!task.due_date) score += 2;
  return score;
};

const buildTodayPlan = (tasks = []) => {
  const activeTasks = tasks.filter((task) => task.status !== 'done');
  const committed = activeTasks.filter((task) => ['overdue', 'today'].includes(task.due_bucket));
  const candidates = activeTasks
    .map((task) => ({ task, score: getPlanCandidateScore(task) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.task);

  const focusQueue = candidates.slice(0, 5);
  const unscheduledHighValue = activeTasks
    .filter((task) => !task.due_date && task.priority === 'high')
    .slice(0, 3);
  const loadScore = committed.length + activeTasks.filter((task) => task.status === 'doing').length;
  const loadState = loadScore >= 8 ? 'heavy' : loadScore >= 4 ? 'steady' : 'light';

  return {
    committed,
    focusQueue,
    loadScore,
    loadState,
    unscheduledHighValue,
  };
};

function TodayPlanPanel({ plan, onOpen, onStartTask, onScheduleToday, isBusy }) {
  const firstTask = plan.focusQueue[0] || null;
  const scheduleCandidates = plan.focusQueue
    .filter((task) => task.due_bucket !== 'today' && task.status !== 'done')
    .slice(0, 3);
  const loadConfig = {
    light: {
      label: 'Light load',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
      barClassName: 'bg-emerald-400',
      description: 'Good room for one meaningful push.',
    },
    steady: {
      label: 'Steady load',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
      barClassName: 'bg-amber-400',
      description: 'Pick carefully and keep the queue short.',
    },
    heavy: {
      label: 'Heavy load',
      className: 'border-red-500/30 bg-red-500/10 text-red-200',
      barClassName: 'bg-red-400',
      description: 'Protect the day from extra commitments.',
    },
  }[plan.loadState];
  const loadWidth = `${Math.min(100, Math.max(12, plan.loadScore * 12))}%`;

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)]">
      <div className="rounded-3xl border border-border/40 bg-card/60 p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Today Plan
            </div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">Choose the work before the work chooses you.</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              A focused queue from overdue, due today, in-progress, and high-priority tasks.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row md:flex-col lg:flex-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => firstTask && onStartTask(firstTask)}
              disabled={!firstTask || isBusy}
              className="shrink-0"
            >
              <Play className="h-4 w-4" />
              Start Next
            </Button>
            <Button
              type="button"
              onClick={() => onScheduleToday(scheduleCandidates)}
              disabled={!scheduleCandidates.length || isBusy}
              className="shrink-0"
            >
              <CalendarClock className="h-4 w-4" />
              Plan Today
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {plan.focusQueue.slice(0, 3).map((task, index) => (
            <button
              key={task.id}
              type="button"
              onClick={() => onOpen(task)}
              className="min-h-[9rem] rounded-2xl border border-border/40 bg-secondary/20 p-3 text-left transition-colors hover:bg-secondary/35"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-background/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {index === 0 ? 'Now' : index === 1 ? 'Next' : 'Later'}
                </span>
                {task.due_bucket === 'overdue' ? (
                  <span className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-medium text-red-300">Overdue</span>
                ) : null}
              </div>
              <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug">{task.title}</p>
              <div className="mt-3 flex flex-wrap gap-1 text-[10px] text-muted-foreground">
                <span className="rounded-full bg-background/60 px-2 py-1 capitalize">{task.priority || 'medium'}</span>
                <span className="rounded-full bg-background/60 px-2 py-1">{task.workspace_name || 'Personal'}</span>
              </div>
            </button>
          ))}

          {plan.focusQueue.length === 0 ? (
            <div className="md:col-span-3 rounded-2xl border border-dashed border-border/40 px-4 py-8 text-sm text-muted-foreground">
              Nothing urgent is asking for today yet. Add a task or give one a due date to build a plan.
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-border/40 bg-card/60 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Planned Load</p>
            <p className="mt-1 text-xs text-muted-foreground">{loadConfig.description}</p>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${loadConfig.className}`}>
            {loadConfig.label}
          </span>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary/50">
          <div className={`h-full rounded-full ${loadConfig.barClassName}`} style={{ width: loadWidth }} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border/30 bg-secondary/15 p-3">
            <ListChecks className="h-4 w-4 text-primary" />
            <p className="mt-2 text-2xl font-semibold">{plan.committed.length}</p>
            <p className="text-[11px] text-muted-foreground">Due or overdue</p>
          </div>
          <div className="rounded-2xl border border-border/30 bg-secondary/15 p-3">
            <Flame className="h-4 w-4 text-amber-300" />
            <p className="mt-2 text-2xl font-semibold">{plan.unscheduledHighValue.length}</p>
            <p className="text-[11px] text-muted-foreground">High priority loose ends</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Tasks() {
  const queryClient = useQueryClient();
  const { tasks, isLoading, isError } = useStandaloneTasks();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [planningBusy, setPlanningBusy] = useState(false);

  const counts = useMemo(() => getTaskCounts(tasks), [tasks]);
  const todayPlan = useMemo(() => buildTodayPlan(tasks), [tasks]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      const searchValue = search.trim().toLowerCase();
      const matchesSearch = !searchValue || `${task.title} ${task.description || ''} ${task.workspace_name || ''} ${task.card_title || ''}`.toLowerCase().includes(searchValue);
      if (!matchesSearch) return false;

      if (filter === 'active') return task.status !== 'done';
      if (filter === 'plan') return todayPlan.focusQueue.some((entry) => entry.id === task.id);
      if (filter === 'due') return task.due_bucket === 'overdue' || task.due_bucket === 'today';
      if (filter === 'linked') return Boolean(task.card_id);
      if (filter === 'personal') return !task.card_id;
      return true;
    });
  }, [filter, search, tasks, todayPlan.focusQueue]);

  const handleStatusChange = async (task, status) => {
    try {
      await updateTaskWithReminderSync(task, { status });
      queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
      if (task.card_id) queryClient.invalidateQueries({ queryKey: ['linked-tasks', task.card_id] });
    } catch (error) {
      toast.error(error?.message || 'Failed to update task status.');
    }
  };

  const invalidateTaskCaches = (task) => {
    queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
    if (task.card_id) queryClient.invalidateQueries({ queryKey: ['linked-tasks', task.card_id] });
  };

  const handleStartTask = async (task) => {
    if (!task?.id) return;

    try {
      setPlanningBusy(true);
      await updateTaskWithReminderSync(task, { status: 'doing' });
      invalidateTaskCaches(task);
      toast.success('Task moved into focus.');
    } catch (error) {
      toast.error(error?.message || 'Failed to start task.');
    } finally {
      setPlanningBusy(false);
    }
  };

  const handleScheduleToday = async (tasksToSchedule = []) => {
    const candidates = tasksToSchedule.filter((task) => task?.id);
    if (!candidates.length) return;

    try {
      setPlanningBusy(true);
      const today = getTodayInputValue();
      await Promise.all(candidates.map((task) => updateTaskWithReminderSync(task, { due_date: today })));
      queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
      candidates.forEach((task) => {
        if (task.card_id) queryClient.invalidateQueries({ queryKey: ['linked-tasks', task.card_id] });
      });
      toast.success(candidates.length === 1 ? 'Task planned for today.' : `${candidates.length} tasks planned for today.`);
    } catch (error) {
      toast.error(error?.message || 'Failed to plan tasks.');
    } finally {
      setPlanningBusy(false);
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

      <TodayPlanPanel
        plan={todayPlan}
        onOpen={(nextTask) => { setEditingTask(nextTask); setModalOpen(true); }}
        onStartTask={handleStartTask}
        onScheduleToday={handleScheduleToday}
        isBusy={planningBusy}
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
