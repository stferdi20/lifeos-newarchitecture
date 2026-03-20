import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Habit, HabitLog } from '@/lib/habits-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';
import { PageHeader } from '@/components/layout/page-header';
import HabitCard from '../components/habits/HabitCard';

const EMOJI_OPTIONS = ['📖', '🏋️', '🧘', '📚', '🎨', '💻', '🏃', '💊', '🧠', '✍️', '🎵', '🌱'];

export default function Habits() {
  const [showForm, setShowForm] = useState(false);
  const [editingHabit, setEditingHabit] = useState(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('📖');
  const queryClient = useQueryClient();

  const { data: habits } = useQuery({
    queryKey: ['habits'],
    queryFn: () => Habit.list(),
    initialData: [],
  });

  const { data: habitLogs } = useQuery({
    queryKey: ['habitLogs'],
    queryFn: () => HabitLog.list('-date', 500),
    initialData: [],
  });

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {habits.map(habit => (
          <HabitCard key={habit.id} habit={habit} habitLogs={habitLogs} onEdit={openEdit} />
        ))}
      </div>

      {habits.length === 0 && (
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
