import React, { useMemo } from 'react';
import { Check, Flame, Trash2, Edit2, Trophy, Target, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Habit, HabitLog, HABIT_LOGS_RECENT_QUERY_KEY } from '@/lib/habits-api';
import HabitHeatmap from './HabitHeatmap';

export default function HabitCard({ habit, habitLogs, onEdit }) {
  const queryClient = useQueryClient();
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const myLogs = useMemo(() => habitLogs || [], [habitLogs]);
  const todayLog = useMemo(() => myLogs.find(l => l.date === todayStr && l.completed), [myLogs, todayStr]);
  const isDone = !!todayLog;

  const completedDates = useMemo(() => new Set(myLogs.filter(l => l.completed).map(l => l.date)), [myLogs]);
  const recentWindowDays = 30 * 7;

  const streak = useMemo(() => {
    let s = 0;
    const d = new Date();
    while (true) {
      const ds = d.toISOString().split('T')[0];
      if (completedDates.has(ds)) {
        s++;
        d.setDate(d.getDate() - 1);
      } else break;
    }
    return s;
  }, [completedDates]);

  const bestStreak = useMemo(() => {
    let best = 0, temp = 0;
    const sortedDates = Array.from(completedDates).sort();
    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) { temp = 1; }
      else {
        const prev = new Date(sortedDates[i - 1]);
        const curr = new Date(sortedDates[i]);
        const diff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
        temp = diff === 1 ? temp + 1 : 1;
      }
      best = Math.max(best, temp);
    }
    return best;
  }, [completedDates]);

  const recentCompletion = useMemo(() => {
    let completed = 0;
    const d = new Date();
    for (let i = 0; i < recentWindowDays; i++) {
      const ds = d.toISOString().split('T')[0];
      if (completedDates.has(ds)) completed++;
      d.setDate(d.getDate() - 1);
    }

    return {
      completed,
      rate: Math.round((completed / recentWindowDays) * 100),
    };
  }, [completedDates, recentWindowDays]);

  const weekProgress = useMemo(() => {
    let completed = 0;
    const d = new Date();
    const dayIndex = d.getDay();
    const daysElapsed = dayIndex === 0 ? 7 : dayIndex;

    for (let i = 0; i < daysElapsed; i++) {
      const ds = d.toISOString().split('T')[0];
      if (completedDates.has(ds)) completed++;
      d.setDate(d.getDate() - 1);
    }

    return { completed, daysElapsed };
  }, [completedDates]);

  const last7 = useMemo(() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date();
      day.setDate(day.getDate() - i);
      arr.push(day.toISOString().split('T')[0]);
    }
    return arr;
  }, []);

  const toggleMutation = useMutation({
    mutationFn: async () => {
      if (todayLog) {
        await HabitLog.delete(todayLog.id);
      } else {
        await HabitLog.create({ habit_id: habit.id, date: todayStr, completed: true });
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['habitLogs'] });
      const previousLogs = queryClient.getQueryData(HABIT_LOGS_RECENT_QUERY_KEY);
      
      queryClient.setQueryData(HABIT_LOGS_RECENT_QUERY_KEY, old => {
        const oldLogs = Array.isArray(old) ? old : [];
        return isDone
          ? oldLogs.filter(l => !(l.habit_id === habit.id && l.date === todayStr && l.completed))
          : [{ id: `temp-card-${Date.now()}`, habit_id: habit.id, date: todayStr, completed: true }, ...oldLogs];
      });
      return { previousLogs };
    },
    onError: (err, newLog, context) => {
      if (context?.previousLogs) {
        queryClient.setQueryData(HABIT_LOGS_RECENT_QUERY_KEY, context.previousLogs);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['habitLogs'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => Habit.delete(habit.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });

  const statItems = [
    {
      label: 'streak',
      value: streak,
      icon: Flame,
      className: 'text-orange-400',
    },
    {
      label: 'best',
      value: bestStreak,
      icon: Trophy,
      className: 'text-amber-400',
    },
    {
      label: 'total',
      value: completedDates.size,
      icon: Target,
      className: 'text-muted-foreground',
    },
  ];

  return (
    <div className={cn(
      'group rounded-2xl bg-card border transition-all hover:border-primary/20',
      isDone ? 'border-emerald-500/30' : 'border-border/50'
    )}>
      <div className="grid gap-4 p-4 2xl:grid-cols-[minmax(13rem,0.78fr)_minmax(24rem,1.22fr)] 2xl:items-start">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => toggleMutation.mutate()}
                className={cn(
                  'w-10 h-10 rounded-xl border-2 flex items-center justify-center transition-all shrink-0',
                  isDone
                    ? 'bg-emerald-500 border-emerald-500 shadow-lg shadow-emerald-500/20'
                    : 'border-border hover:border-emerald-500/50 hover:bg-emerald-500/5'
                )}
                aria-label={isDone ? `Mark ${habit.name} incomplete today` : `Mark ${habit.name} complete today`}
              >
                {isDone && <Check className="w-4 h-4 text-white" />}
              </button>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-tight">{habit.icon} {habit.name}</p>
                <p className={cn(
                  'mt-0.5 text-xs',
                  isDone ? 'text-emerald-400' : 'text-muted-foreground/60'
                )}>
                  {isDone ? 'Done today' : 'Ready for today'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => onEdit(habit)}
                className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={`Edit ${habit.name}`}
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
                aria-label={`Delete ${habit.name}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {statItems.map(({ label, value, icon: Icon, className }) => (
              <div key={label} className="rounded-xl border border-border/30 bg-secondary/15 px-2.5 py-2">
                <div className={cn('flex items-center gap-1 text-[11px] font-medium', className)}>
                  <Icon className="h-3 w-3" />
                  <span>{label}</span>
                </div>
                <p className="mt-1 text-lg font-semibold leading-none text-foreground">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-border/30 bg-secondary/10 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground/50">
                <CalendarDays className="h-3 w-3" />
                Last 7d
              </span>
              <span className="text-[10px] font-medium text-muted-foreground/60">
                {weekProgress.completed}/{weekProgress.daysElapsed} this week
              </span>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {last7.map(day => {
                const isCompleted = completedDates.has(day);
                const isToday = day === todayStr;

                return (
                  <div
                    key={day}
                    title={day}
                    className={cn(
                      'flex h-8 min-w-0 items-center justify-center rounded-lg text-[10px] font-semibold transition-colors',
                      isCompleted
                        ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                        : isToday
                          ? 'bg-secondary/80 text-muted-foreground ring-1 ring-border'
                          : 'bg-secondary/30 text-muted-foreground/35'
                    )}
                  >
                    {new Date(day).getDate()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 border-t border-border/30 pt-3 2xl:border-l 2xl:border-t-0 2xl:pl-4 2xl:pt-0">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50">Activity</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Last 30 weeks</p>
            </div>
            <div className="text-right">
              <p className="text-xl font-semibold leading-none text-foreground">{recentCompletion.rate}%</p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground/50">completion</p>
            </div>
          </div>

          <HabitHeatmap habitId={habit.id} habitLogs={habitLogs} weeksCount={30} cellSize={11} />
        </div>
      </div>
    </div>
  );
}
