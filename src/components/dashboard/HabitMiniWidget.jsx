import React, { useMemo } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HabitLog } from '@/lib/habits-api';

export default function HabitMiniWidget({ habits, habitLogs }) {
  const queryClient = useQueryClient();
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);

  const { todayLogs, completedIds } = useMemo(() => {
    const logs = (habitLogs || []).filter(l => l.date === todayStr && l.completed);
    return {
      todayLogs: logs,
      completedIds: new Set(logs.map(l => l.habit_id))
    };
  }, [habitLogs, todayStr]);

  const toggleMutation = useMutation({
    mutationFn: async (habit) => {
      const existing = todayLogs.find(l => l.habit_id === habit.id);
      if (existing) {
        await HabitLog.delete(existing.id);
      } else {
        await HabitLog.create({ habit_id: habit.id, date: todayStr, completed: true });
      }
    },
    onMutate: async (habit) => {
      await queryClient.cancelQueries({ queryKey: ['habitLogs'] });
      const previousLogs = queryClient.getQueryData(['habitLogs']);
      
      const isDone = completedIds.has(habit.id);
      queryClient.setQueryData(['habitLogs'], old => {
        const oldLogs = Array.isArray(old) ? old : [];
        return isDone
          ? oldLogs.filter(l => !(l.habit_id === habit.id && l.date === todayStr && l.completed))
          : [{ id: `temp-${Date.now()}`, habit_id: habit.id, date: todayStr, completed: true }, ...oldLogs];
      });
      return { previousLogs };
    },
    onError: (err, habit, context) => {
      if (context?.previousLogs) {
        queryClient.setQueryData(['habitLogs'], context.previousLogs);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['habitLogs'] });
    },
  });

  const activeHabits = useMemo(() => (habits || []).filter(h => h.active !== false), [habits]);
  const completedCount = useMemo(() => activeHabits.filter(h => completedIds.has(h.id)).length, [activeHabits, completedIds]);

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#0f1a1a] via-card to-card border border-emerald-500/10 p-5 hover:border-emerald-500/25 hover:shadow-lg hover:shadow-emerald-500/5 transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold tracking-tight">Daily Habits</h3>
        <span className="text-xs text-muted-foreground">{completedCount}/{activeHabits.length}</span>
      </div>
      {activeHabits.length > 0 && (
        <div className="w-full bg-secondary/30 rounded-full h-1.5 mb-4 overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-full rounded-full transition-all duration-500" style={{ width: `${activeHabits.length > 0 ? (completedCount / activeHabits.length) * 100 : 0}%` }} />
        </div>
      )}
      <div className="space-y-2 pr-1 overflow-y-auto max-h-[220px]">
        {activeHabits.map(habit => {
          const done = completedIds.has(habit.id);
          return (
            <button
              key={habit.id}
              onClick={() => toggleMutation.mutate(habit)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all",
                done ? "bg-emerald-500/10 text-emerald-400" : "bg-secondary/50 text-foreground/70 hover:bg-secondary"
              )}
            >
              <div className={cn(
                "w-5 h-5 rounded-md border flex items-center justify-center transition-all shrink-0",
                done ? "bg-emerald-500 border-emerald-500" : "border-border"
              )}>
                {done && <Check className="w-3 h-3 text-white" />}
              </div>
              <span className={cn(done && "line-through opacity-60")}>{habit.icon} {habit.name}</span>
            </button>
          );
        })}
      </div>
      {activeHabits.length === 0 && <p className="text-xs text-muted-foreground">No habits yet. Add some in Habits page.</p>}
    </div>
  );
}
