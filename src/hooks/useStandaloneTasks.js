import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listCardRecords,
  listStandaloneTaskRecords,
  listWorkspaceRecords,
  normalizeStandaloneTasks,
} from '@/lib/tasks';

export function useStandaloneTasks() {
  const tasksQuery = useQuery({
    queryKey: ['standalone-tasks'],
    queryFn: listStandaloneTaskRecords,
    initialData: [],
  });

  const workspacesQuery = useQuery({
    queryKey: ['task-workspaces'],
    queryFn: listWorkspaceRecords,
    initialData: [],
  });

  const cardsQuery = useQuery({
    queryKey: ['task-cards'],
    queryFn: listCardRecords,
    initialData: [],
  });

  const tasks = useMemo(
    () => normalizeStandaloneTasks(tasksQuery.data, workspacesQuery.data, cardsQuery.data),
    [tasksQuery.data, workspacesQuery.data, cardsQuery.data]
  );

  return {
    tasks,
    workspaces: workspacesQuery.data || [],
    cards: cardsQuery.data || [],
    isLoading: tasksQuery.isLoading || workspacesQuery.isLoading || cardsQuery.isLoading,
    isError: tasksQuery.isError,
    error: tasksQuery.error,
  };
}
