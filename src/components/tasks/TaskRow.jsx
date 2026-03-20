import React from 'react';
import { CalendarDays, Circle, Play, CheckCircle2, Link2, BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTaskDueLabel, getTaskDueBucket } from '@/lib/tasks';

const statusConfig = {
  todo: { icon: Circle, className: 'text-zinc-400' },
  doing: { icon: Play, className: 'text-blue-400' },
  done: { icon: CheckCircle2, className: 'text-emerald-400' },
};

export default function TaskRow({ task, onOpen, onStatusChange, compact = false }) {
  const status = statusConfig[task.status] || statusConfig.todo;
  const dueBucket = getTaskDueBucket(task);

  return (
    <div className="rounded-xl border border-border/40 bg-secondary/15 p-3 transition-colors hover:bg-secondary/30">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onStatusChange(task, task.status === 'done' ? 'todo' : 'done')}
          className="mt-0.5"
          title={task.status === 'done' ? 'Move back to todo' : 'Mark done'}
        >
          <status.icon className={cn('h-4 w-4 shrink-0', status.className)} />
        </button>

        <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn('truncate text-sm font-medium', task.status === 'done' && 'text-muted-foreground line-through')}>
              {task.title}
            </p>
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
              task.priority === 'high' ? 'border-red-500/30 bg-red-500/10 text-red-300' :
                task.priority === 'low' ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300' :
                  'border-amber-500/30 bg-amber-500/10 text-amber-300'
            )}>
              {task.priority || 'medium'}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {task.workspace_name ? (
              <span className="rounded-full bg-background/60 px-2 py-1">{task.workspace_name}</span>
            ) : (
              <span className="rounded-full bg-background/60 px-2 py-1">Personal</span>
            )}
            {task.card_title ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-1">
                <Link2 className="h-3 w-3" />
                {task.card_title}
              </span>
            ) : null}
            {task.reminder_enabled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-1 text-sky-300">
                <BellRing className="h-3 w-3" />
                {task.google_sync_status === 'disconnected' ? 'Reminder disconnected' : 'Google reminder'}
              </span>
            ) : null}
            {task.due_date ? (
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-1',
                dueBucket === 'overdue' ? 'bg-red-500/10 text-red-300' :
                  dueBucket === 'today' ? 'bg-amber-500/10 text-amber-300' :
                    'bg-background/60'
              )}>
                <CalendarDays className="h-3 w-3" />
                {formatTaskDueLabel(task)}
              </span>
            ) : null}
          </div>
        </button>
      </div>

      {!compact ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {['todo', 'doing', 'done'].map((nextStatus) => (
            <button
              key={nextStatus}
              type="button"
              onClick={() => onStatusChange(task, nextStatus)}
              className={cn(
                'rounded-lg px-2 py-1 text-[10px] font-medium transition-colors',
                task.status === nextStatus
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background/60 text-muted-foreground hover:text-foreground'
              )}
            >
              {nextStatus === 'todo' ? 'To Do' : nextStatus === 'doing' ? 'Doing' : 'Done'}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
