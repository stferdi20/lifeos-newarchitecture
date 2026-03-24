import React from 'react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import TaskDetailModal from '@/components/tasks/TaskDetailModal';
import TaskRow from '@/components/tasks/TaskRow';
import { updateTaskWithReminderSync } from '@/lib/googleReminderSync';
import { createStandaloneTaskRecord, getTaskCounts, sanitizeTaskPayload } from '@/lib/tasks';
import AnimatedNumber from '@/components/ui/AnimatedNumber';

export default function TaskOverview({ tasks, isLoading, isError }) {
  const queryClient = useQueryClient();
  const [quickTitle, setQuickTitle] = useState('');
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const activeTasks = (tasks || []).filter((task) => task.status !== 'done').slice(0, 5);
  const counts = getTaskCounts(tasks);

  const handleQuickCreate = async () => {
    if (!quickTitle.trim()) return;
    try {
      await createStandaloneTaskRecord(sanitizeTaskPayload({ title: quickTitle.trim(), status: 'todo', priority: 'medium' }));
      setQuickTitle('');
      queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
    } catch (error) {
      toast.error(error?.message || 'Failed to create task.');
    }
  };

  const handleStatusChange = async (task, status) => {
    try {
      await updateTaskWithReminderSync(task, { status });
      queryClient.invalidateQueries({ queryKey: ['standalone-tasks'] });
      if (task.card_id) queryClient.invalidateQueries({ queryKey: ['linked-tasks', task.card_id] });
    } catch (error) {
      toast.error(error?.message || 'Failed to update task.');
    }
  };

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#111525] via-card to-card border border-blue-500/10 p-5 h-full flex flex-col hover:border-blue-500/25 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-300">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold tracking-tight">Tasks</h3>
        <Link to="/Tasks" className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0">
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="flex gap-2 mb-4">
        <Input
          value={quickTitle}
          onChange={(event) => setQuickTitle(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && handleQuickCreate()}
          placeholder="Quick add a real task..."
          className="h-9 border-border/40 bg-secondary/20 text-sm"
        />
        <Button size="sm" onClick={handleQuickCreate}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {[['Todo', counts.todo, 'bg-zinc-500/20 text-zinc-400'], ['Doing', counts.doing, 'bg-blue-500/20 text-blue-400'], ['Done', counts.done, 'bg-emerald-500/20 text-emerald-400'], ['Overdue', counts.overdue, 'bg-red-500/20 text-red-300']].map(([label, count, cls]) => (
          <div key={label} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${cls}`}>
            <AnimatedNumber value={count} /> {label}
          </div>
        ))}
      </div>

      <div className="space-y-2 flex-1 overflow-y-auto max-h-[320px]">
        {isLoading && <p className="text-xs text-muted-foreground">Loading tasks...</p>}
        {!isLoading && isError && <p className="text-xs text-red-300">We could not load tasks right now.</p>}
        {!isLoading && !isError && activeTasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            compact
            onOpen={(nextTask) => { setEditingTask(nextTask); setTaskModalOpen(true); }}
            onStatusChange={handleStatusChange}
          />
        ))}
        {!isLoading && !isError && activeTasks.length === 0 && <p className="text-xs text-muted-foreground">No active tasks. Add one above or promote a checklist item from a card.</p>}
      </div>

      <TaskDetailModal
        open={taskModalOpen}
        onClose={() => { setTaskModalOpen(false); setEditingTask(null); }}
        task={editingTask}
      />
    </div>
  );
}
