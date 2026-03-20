import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Habit, HabitLog } from '@/lib/habits-api';
import GreetingWidget from '../components/dashboard/GreetingWidget';
import HabitMiniWidget from '../components/dashboard/HabitMiniWidget';
import QuickCapture from '../components/dashboard/QuickCapture';
import QuickCaptureCreator from '../components/dashboard/QuickCaptureCreator';
import IdeaSpark from '../components/dashboard/IdeaSpark';
import TaskOverview from '../components/dashboard/TaskOverview';
import NewsWidget from '../components/dashboard/NewsWidget';
import InvestmentWidget from '../components/dashboard/InvestmentWidget';
import TodaySchedule from '../components/dashboard/TodaySchedule';
import { useStandaloneTasks } from '@/hooks/useStandaloneTasks';

export default function Dashboard() {
  const { tasks, isLoading: tasksLoading, isError: tasksError } = useStandaloneTasks();

  const { data: habits } = useQuery({
    queryKey: ['habits'],
    queryFn: () => Habit.list(),
    initialData: [],
  });

  const { data: habitLogs } = useQuery({
    queryKey: ['habitLogs'],
    queryFn: () => HabitLog.list('-date', 200),
    initialData: [],
  });

  return (
    <div className="space-y-6">
      {/* Greeting + Next Event */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <GreetingWidget tasks={tasks} />
        </div>
        <div className="lg:col-span-2">
          <TodaySchedule />
        </div>
      </div>

      {/* Quick Capture row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QuickCapture />
        <QuickCaptureCreator />
      </div>

      {/* Habits + Tasks */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <HabitMiniWidget habits={habits} habitLogs={habitLogs} />
        <TaskOverview tasks={tasks} isLoading={tasksLoading} isError={tasksError} />
      </div>

      {/* Ideas + News */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <IdeaSpark />
        <NewsWidget />
      </div>

      {/* Portfolio */}
      <div>
        <InvestmentWidget />
      </div>
    </div>
  );
}
