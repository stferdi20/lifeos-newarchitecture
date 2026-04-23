import React, { useMemo } from 'react';
import { Check, Flame, Trash2, Edit2, Trophy, Target } from 'lucide-react';
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

  return (
    <div className={cn(
      'rounded-2xl bg-card border transition-all',
      isDone ? 'border-emerald-500/30' : 'border-border/50'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleMutation.mutate()}
            className={cn(
              'w-9 h-9 rounded-xl border-2 flex items-center justify-center transition-all shrink-0',
              isDone
                ? 'bg-emerald-500 border-emerald-500 shadow-lg shadow-emerald-500/20'
                : 'border-border hover:border-emerald-500/50 hover:bg-emerald-500/5'
            )}
          >
            {isDone && <Check className="w-4 h-4 text-white" />}
          </button>
          <div>
            <p className="font-semibold text-sm">{habit.icon} {habit.name}</p>
            <div className="flex items-center gap-3 mt-0.5">
              {streak > 0 && (
                <span className="text-[11px] text-orange-400 flex items-center gap-1">
                  <Flame className="w-3 h-3" /> {streak} streak
                </span>
              )}
              {bestStreak > 0 && (
                <span className="text-[11px] text-amber-400 flex items-center gap-1">
                  <Trophy className="w-3 h-3" /> {bestStreak} best
                </span>
              )}
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Target className="w-3 h-3" /> {completedDates.size} total
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <button onClick={() => onEdit(habit)} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => deleteMutation.mutate()} className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Last 7 days dots */}
      <div className="px-4 pb-3 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground/50 mr-1">Last 7d</span>
        {last7.map(day => (
          <div
            key={day}
            title={day}
            className={cn(
              'w-5 h-5 rounded-md text-[9px] flex items-center justify-center font-medium',
              completedDates.has(day)
                ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/40'
                : day === todayStr
                  ? 'bg-secondary/80 text-muted-foreground ring-1 ring-border'
                  : 'bg-secondary/30 text-muted-foreground/30'
            )}
          >
            {new Date(day).getDate()}
          </div>
        ))}
      </div>

      {/* Heatmap */}
      <div className="px-4 pb-4 border-t border-border/30 pt-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 mb-2">Activity</p>
        <HabitHeatmap habitId={habit.id} habitLogs={habitLogs} />
      </div>
    </div>
  );
}
