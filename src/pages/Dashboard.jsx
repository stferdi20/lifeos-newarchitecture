import React, { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HABIT_CARDS_QUERY_KEY, HABIT_LOGS_RECENT_QUERY_KEY, listHabitCards, listRecentHabitLogs } from '@/lib/habits-api';
import { StaggerContainer, StaggerItem } from '@/components/ui/StaggerContainer';
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
import { prefetchAppSections } from '@/lib/app-prefetch';
import { getLocalQueryCacheOptions } from '@/lib/local-query-cache';

const HABIT_LOG_HISTORY_LIMIT = 500;

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { tasks, isLoading: tasksLoading, isError: tasksError } = useStandaloneTasks();

  useEffect(() => prefetchAppSections(queryClient), [queryClient]);

  const { data: habits = [] } = useQuery({
    queryKey: HABIT_CARDS_QUERY_KEY,
    queryFn: listHabitCards,
    ...getLocalQueryCacheOptions(['habits']),
    refetchOnMount: false,
  });

  const { data: habitLogs = [] } = useQuery({
    queryKey: HABIT_LOGS_RECENT_QUERY_KEY,
    queryFn: () => listRecentHabitLogs(HABIT_LOG_HISTORY_LIMIT),
    ...getLocalQueryCacheOptions(['habitLogs']),
    refetchOnMount: false,
  });

  return (
    <StaggerContainer className="space-y-6">
      {/* Greeting + Next Event */}
      <StaggerItem className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl">
          <GreetingWidget tasks={tasks} />
        </div>
        <div className="lg:col-span-2 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl">
          <TodaySchedule />
        </div>
      </StaggerItem>

      {/* Quick Capture row */}
      <StaggerItem className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl">
          <QuickCapture />
        </div>
        <div className="hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl">
          <QuickCaptureCreator />
        </div>
      </StaggerItem>

      {/* Habits + Tasks */}
      <StaggerItem className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl h-full">
          <HabitMiniWidget habits={habits} habitLogs={habitLogs} />
        </div>
        <div className="hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl h-full">
          <TaskOverview tasks={tasks} isLoading={tasksLoading} isError={tasksError} />
        </div>
      </StaggerItem>

      {/* News */}
      <StaggerItem>
        <div className="hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl h-full">
          <NewsWidget />
        </div>
      </StaggerItem>

      {/* Idea Lab */}
      <StaggerItem>
        <div className="hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl h-full">
          <IdeaSpark />
        </div>
      </StaggerItem>

      {/* Portfolio */}
      <StaggerItem>
        <div className="hover:-translate-y-1 hover:shadow-lg transition-all duration-300 rounded-xl">
          <InvestmentWidget />
        </div>
      </StaggerItem>
    </StaggerContainer>
  );
}
