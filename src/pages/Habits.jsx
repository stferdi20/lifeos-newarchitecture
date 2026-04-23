import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckSquare, Plus } from 'lucide-react';
import { Habit, HABIT_CARDS_QUERY_KEY, HABIT_LOGS_RECENT_QUERY_KEY, listHabitCards, listRecentHabitLogs } from '@/lib/habits-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';
import { PageHeader } from '@/components/layout/page-header';
import { getLocalQueryCacheOptions } from '@/lib/local-query-cache';
import { cn } from '@/lib/utils';
import HabitCard from '../components/habits/HabitCard';

const EMOJI_OPTIONS = ['📖', '🏋️', '🧘', '📚', '🎨', '💻', '🏃', '💊', '🧠', '✍️', '🎵', '🌱'];
const HABIT_LOG_HISTORY_LIMIT = 500;

function HabitCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 animate-pulse rounded-xl bg-secondary/60" />
          <div className="space-y-2">
            <div className="h-4 w-36 animate-pulse rounded-full bg-secondary/70" />
            <div className="h-3 w-48 animate-pulse rounded-full bg-secondary/50" />
          </div>
        </div>
        <div className="h-7 w-16 animate-pulse rounded-lg bg-secondary/40" />
      </div>
      <div className="mt-4 flex gap-1.5">
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-5 w-5 animate-pulse rounded-md bg-secondary/40" />
        ))}
      </div>
      <div className="mt-4 border-t border-border/30 pt-3">
        <div className="mb-2 h-3 w-20 animate-pulse rounded-full bg-secondary/40" />
        <div className="grid grid-cols-[repeat(18,12px)] gap-[3px]">
          {Array.from({ length: 126 }).map((_, index) => (
            <div key={index} className="h-3 w-3 animate-pulse rounded-sm bg-secondary/35" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Habits() {
  const [showForm, setShowForm] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);
  const [viewMode, setViewMode] = useState('checklist');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📖');
  const queryClient = useQueryClient();

  const habitsQuery = useQuery({
    queryKey: HABIT_CARDS_QUERY_KEY,
    queryFn: listHabitCards,
    ...getLocalQueryCacheOptions(['habits']),
    refetchOnMount: false,
  });

  const habitLogsQuery = useQuery({
    queryKey: HABIT_LOGS_RECENT_QUERY_KEY,
    queryFn: () => listRecentHabitLogs(HABIT_LOG_HISTORY_LIMIT),
    ...getLocalQueryCacheOptions(['habitLogs']),
    refetchOnMount: false,
  });

  const habits = habitsQuery.data || [];
  const habitLogs = habitLogsQuery.data || [];
  const isInitialHabitsLoad = habitsQuery.isPending && habits.length === 0;
  const hasHabitsError = habitsQuery.isError;

  const habitLogsByHabitId = useMemo(() => {
    const grouped = new Map();
    for (const log of habitLogs || []) {
      if (!log?.habit_id) continue;
      const existing = grouped.get(log.habit_id) || [];
      existing.push(log);
      grouped.set(log.habit_id, existing);
    }
    return grouped;
  }, [habitLogs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingHabit) {
        await Habit.update(editingHabit.id, { name, icon });
      } else {
        await Habit.create({ name, icon, frequency: 'daily', active: true });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['habits'] });
      closeForm();
    },
  });

  const openEdit = (habit) => {
    setEditingHabit(habit);
    setName(habit.name);
    setIcon(habit.icon || '📖');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingHabit(null);
    setName('');
    setIcon('📖');
  };

  return (
    <div>
      <PageHeader
        title="Habit Tracker"
        description="Build streaks, build discipline."
        actions={(
          <Button onClick={() => setShowForm(true)} className="w-full bg-primary hover:bg-primary/90 text-white sm:w-auto">
          <Plus className="w-4 h-4 mr-2" /> Add Habit
          </Button>
        )}
        className="mb-6"
      />

      {!isInitialHabitsLoad && !hasHabitsError && habits.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/40 bg-card/50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">
              {viewMode === 'checklist' ? 'Today checklist' : 'Activity heatmap'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {viewMode === 'checklist'
                ? 'Compact cards focused on the last 7 days.'
                : 'Expanded cards showing the longer habit pattern.'}
            </p>
          </div>

          <div className="grid grid-cols-2 rounded-xl border border-border/50 bg-secondary/20 p-1 sm:w-auto">
            {[
              { value: 'checklist', label: 'Checklist', icon: CheckSquare },
              { value: 'heatmap', label: 'Heatmap', icon: Activity },
            ].map(({ value, label, icon: Icon }) => {
              const selected = viewMode === value;

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setViewMode(value)}
                  className={cn(
                    'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors',
                    selected
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  aria-pressed={selected}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isInitialHabitsLoad ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <HabitCardSkeleton key={index} />
          ))}
        </div>
      ) : hasHabitsError ? (
        <div className="text-center py-20">
          <p className="text-sm font-medium text-red-400">Could not load habits.</p>
          <p className="mt-1 text-sm text-muted-foreground">Refresh the page or try again in a moment.</p>
        </div>
      ) : (
        <div className={cn(
          'grid grid-cols-1 gap-4',
          viewMode === 'checklist'
            ? 'md:grid-cols-2 xl:grid-cols-3'
            : 'md:grid-cols-2'
        )}>
          {habits.map(habit => (
            <HabitCard
              key={habit.id}
              habit={habit}
              habitLogs={habitLogsByHabitId.get(habit.id) || []}
              onEdit={openEdit}
              viewMode={viewMode}
            />
          ))}
        </div>
      )}

      {!isInitialHabitsLoad && !hasHabitsError && habits.length === 0 && (
        <div className="text-center py-20">
          <p className="text-muted-foreground">No habits yet. Start building your routine.</p>
        </div>
      )}

      <ResponsiveModal open={showForm} onOpenChange={closeForm}>
        <ResponsiveModalContent className="bg-card border-border" mobileClassName="bg-card border-border">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{editingHabit ? 'Edit Habit' : 'New Habit'}</ResponsiveModalTitle>
          </ResponsiveModalHeader>
          <div className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Icon</label>
              <div className="flex gap-2 flex-wrap">
                {EMOJI_OPTIONS.map(e => (
                  <button
                    key={e}
                    onClick={() => setIcon(e)}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all ${icon === e ? 'bg-primary/20 ring-1 ring-primary' : 'bg-secondary/50 hover:bg-secondary'}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Name</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Morning stretch"
                className="bg-secondary/50 border-border"
              />
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={!name.trim()} className="w-full bg-primary hover:bg-primary/90 text-white">
              {editingHabit ? 'Save Changes' : 'Create Habit'}
            </Button>
          </div>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  );
}
