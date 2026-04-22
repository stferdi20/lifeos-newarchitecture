import { getLocalQueryCachePolicy } from '@/lib/local-query-cache';

const PREFETCH_STALE_TIME = 5 * 60 * 1000;
const PREFETCH_GC_TIME = 30 * 60 * 1000;
const PREFETCH_WORKSPACE_LIMIT = 3;

let prefetchStarted = false;

function scheduleIdle(callback, timeout = 2500) {
  if (typeof window === 'undefined') return () => {};
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, Math.min(timeout, 1000));
  return () => window.clearTimeout(id);
}

function safePrefetch(queryClient, options) {
  const policy = getLocalQueryCachePolicy(options.queryKey) || {};
  return queryClient.prefetchQuery({
    staleTime: PREFETCH_STALE_TIME,
    gcTime: PREFETCH_GC_TIME,
    ...options,
    ...policy,
  }).catch(() => null);
}

function preloadRouteChunks() {
  [
    () => import('@/pages/Resources'),
    () => import('@/pages/Projects'),
    () => import('@/pages/Tasks'),
    () => import('@/pages/Calendar'),
    () => import('@/pages/Habits'),
    () => import('@/pages/Media'),
    () => import('@/pages/News'),
    () => import('@/pages/Investments'),
    () => import('@/pages/Snippets'),
    () => import('@/pages/CreatorVault'),
    () => import('@/pages/PromptWizard'),
  ].forEach((load) => load().catch(() => null));
}

function calendarRange(weeksAhead = 0) {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const start = new Date(now);
  start.setDate(now.getDate() - diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + ((weeksAhead + 1) * 7) - 1);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

async function prefetchResources(queryClient) {
  const [{ listLifeAreaFilters, listResourceCards }, { prewarmResourceImageCache }] = await Promise.all([
    import('@/lib/resources-api'),
    import('@/lib/resource-image-cache'),
  ]);

  safePrefetch(queryClient, {
    queryKey: ['lifeAreas'],
    queryFn: listLifeAreaFilters,
  });

  const resources = await queryClient.fetchQuery({
    queryKey: ['resources'],
    queryFn: () => listResourceCards(200),
    staleTime: PREFETCH_STALE_TIME,
    gcTime: PREFETCH_GC_TIME,
    ...getLocalQueryCachePolicy(['resources']),
  }).catch(() => []);

  prewarmResourceImageCache(resources, { limit: 120, concurrency: 4 });
}

async function prefetchProjects(queryClient) {
  const { listBoardCards, listBoardLists, listBoardWorkspaces } = await import('@/lib/projects-api');
  const workspaces = await queryClient.fetchQuery({
    queryKey: ['workspaces'],
    queryFn: listBoardWorkspaces,
    staleTime: PREFETCH_STALE_TIME,
    gcTime: PREFETCH_GC_TIME,
    ...getLocalQueryCachePolicy(['workspaces']),
  }).catch(() => []);

  (workspaces || [])
    .filter((workspace) => !workspace?.is_archived)
    .slice(0, PREFETCH_WORKSPACE_LIMIT)
    .forEach((workspace) => {
      safePrefetch(queryClient, {
        queryKey: ['workspace-lists', workspace.id],
        queryFn: () => listBoardLists(workspace.id),
      });
      safePrefetch(queryClient, {
        queryKey: ['cards', workspace.id, 'active'],
        queryFn: () => listBoardCards(workspace.id, { includeArchived: false }),
      });
    });
}

async function prefetchTasks(queryClient) {
  const { listCardRecords, listStandaloneTaskRecords, listWorkspaceRecords } = await import('@/lib/tasks');
  safePrefetch(queryClient, {
    queryKey: ['standalone-tasks'],
    queryFn: listStandaloneTaskRecords,
  });
  safePrefetch(queryClient, {
    queryKey: ['task-workspaces'],
    queryFn: listWorkspaceRecords,
  });
  safePrefetch(queryClient, {
    queryKey: ['task-cards'],
    queryFn: listCardRecords,
  });
}

async function prefetchCalendar(queryClient) {
  const { fetchCalendarEvents } = await import('@/lib/calendar-api');
  const { start, end } = calendarRange(0);
  safePrefetch(queryClient, {
    queryKey: ['calendarEvents', 0],
    queryFn: () => fetchCalendarEvents({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      maxResults: 200,
    }),
  });
}

async function prefetchLightSections(queryClient) {
  const [
    { Habit, HabitLog },
    { Investment },
    { Snippet },
    { fetchNews },
  ] = await Promise.all([
    import('@/lib/habits-api'),
    import('@/lib/investments-api'),
    import('@/lib/snippets-api'),
    import('@/lib/news-api'),
  ]);

  safePrefetch(queryClient, { queryKey: ['habits'], queryFn: () => Habit.list() });
  safePrefetch(queryClient, { queryKey: ['habitLogs'], queryFn: () => HabitLog.list('-date', 200) });
  safePrefetch(queryClient, { queryKey: ['investments'], queryFn: () => Investment.list() });
  safePrefetch(queryClient, { queryKey: ['snippets'], queryFn: () => Snippet.list('-updated_date', 200) });
  safePrefetch(queryClient, {
    queryKey: ['news', 'ai'],
    queryFn: () => fetchNews({ category: 'ai', query: 'artificial intelligence', limit: 8 }),
    staleTime: 5 * 60 * 1000,
  });
}

export function prefetchAppSections(queryClient) {
  if (!queryClient || prefetchStarted) return () => {};
  prefetchStarted = true;

  const cancelChunks = scheduleIdle(preloadRouteChunks, 1200);
  const cancelCoreData = scheduleIdle(() => {
    prefetchResources(queryClient).catch(() => null);
    prefetchProjects(queryClient).catch(() => null);
    prefetchTasks(queryClient).catch(() => null);
  }, 2200);
  const cancelSecondaryData = scheduleIdle(() => {
    prefetchCalendar(queryClient).catch(() => null);
    prefetchLightSections(queryClient).catch(() => null);
  }, 4200);

  return () => {
    cancelChunks();
    cancelCoreData();
    cancelSecondaryData();
  };
}
