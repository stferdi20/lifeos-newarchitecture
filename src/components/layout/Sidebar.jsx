import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, CheckSquare, Newspaper, Film, TrendingUp, CalendarDays, ChevronLeft, ChevronRight, Users, Wand2, Library, X, Settings, Scissors } from 'lucide-react';
import { createPageUrl } from '@/utils';
import { cn } from '@/lib/utils';
import { getLocalQueryCacheOptions } from '@/lib/local-query-cache';

const navItems = [
  { page: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'Calendar', label: 'Calendar', icon: CalendarDays },
  { page: 'Projects', label: 'Projects', icon: FolderKanban },
  { page: 'Tasks', label: 'Tasks', icon: CheckSquare },
  { page: 'Habits', label: 'Habits', icon: CheckSquare },
  { page: 'Resources', label: 'Resources', icon: Library },
  { page: 'Snippets', label: 'Snippets', icon: Scissors },
  { page: 'Media', label: 'Media', icon: Film },
  { page: 'CreatorVault', label: 'Creator Vault', icon: Users },
  { page: 'Investments', label: 'Investments', icon: TrendingUp },

  { page: 'PromptWizard', label: 'Prompt Wizard', icon: Wand2 },
  { page: 'News', label: 'AI News', icon: Newspaper },
  { page: 'Settings', label: 'Settings', icon: Settings },
];

const routePreloaders = {
  Calendar: () => import('@/pages/Calendar'),
  CreatorVault: () => import('@/pages/CreatorVault'),
  Dashboard: () => import('@/pages/Dashboard'),
  Habits: () => import('@/pages/Habits'),
  Investments: () => import('@/pages/Investments'),
  Media: () => import('@/pages/Media'),
  News: () => import('@/pages/News'),
  Projects: () => import('@/pages/Projects'),
  PromptWizard: () => import('@/pages/PromptWizard'),
  Resources: () => import('@/pages/Resources'),
  Settings: () => import('@/pages/Settings'),
  Snippets: () => import('@/pages/Snippets'),
  Tasks: () => import('@/pages/Tasks'),
};

const preloadedPages = new Set();

function prefetchNavTarget(page, queryClient) {
  if (!page) return;

  if (!preloadedPages.has(page)) {
    preloadedPages.add(page);
    routePreloaders[page]?.().catch(() => {
      preloadedPages.delete(page);
    });
  }

  if (!queryClient) return;

  if (page === 'Habits') {
    import('@/lib/habits-api')
      .then(({ HABIT_CARDS_QUERY_KEY, HABIT_LOGS_RECENT_QUERY_KEY, listHabitCards, listRecentHabitLogs }) => {
        queryClient.prefetchQuery({
          queryKey: HABIT_CARDS_QUERY_KEY,
          queryFn: listHabitCards,
          ...getLocalQueryCacheOptions(['habits']),
        }).catch(() => null);

        queryClient.prefetchQuery({
          queryKey: HABIT_LOGS_RECENT_QUERY_KEY,
          queryFn: () => listRecentHabitLogs(500),
          ...getLocalQueryCacheOptions(['habitLogs']),
        }).catch(() => null);
      })
      .catch(() => null);
  }

  if (page === 'Settings') {
    Promise.all([
      import('@/lib/google-api'),
      import('@/lib/instagram-downloader-api'),
      import('@/lib/youtube-transcript-api'),
    ])
      .then(([
        { listGoogleConnections },
        { getInstagramDownloaderSettings, getInstagramDownloaderStatus },
        { getYouTubeTranscriptSettings, getYouTubeTranscriptStatus },
      ]) => {
        queryClient.prefetchQuery({
          queryKey: ['google-connections'],
          queryFn: listGoogleConnections,
          ...getLocalQueryCacheOptions(['google-connections']),
        }).catch(() => null);

        queryClient.prefetchQuery({
          queryKey: ['instagram-downloader-settings'],
          queryFn: getInstagramDownloaderSettings,
          ...getLocalQueryCacheOptions(['instagram-downloader-settings']),
        }).catch(() => null);

        queryClient.prefetchQuery({
          queryKey: ['instagram-downloader-status'],
          queryFn: getInstagramDownloaderStatus,
          ...getLocalQueryCacheOptions(['instagram-downloader-status']),
        }).catch(() => null);

        queryClient.prefetchQuery({
          queryKey: ['youtube-transcript-settings'],
          queryFn: getYouTubeTranscriptSettings,
          ...getLocalQueryCacheOptions(['youtube-transcript-settings']),
        }).catch(() => null);

        queryClient.prefetchQuery({
          queryKey: ['youtube-transcript-status'],
          queryFn: getYouTubeTranscriptStatus,
          ...getLocalQueryCacheOptions(['youtube-transcript-status']),
        }).catch(() => null);
      })
      .catch(() => null);
  }

  if (page !== 'Resources') return;

  import('@/lib/resources-api')
    .then(({ listLifeAreaFilters, listResourceCards }) => {
      queryClient.prefetchQuery({
        queryKey: ['resources'],
        queryFn: () => listResourceCards(200),
        ...getLocalQueryCacheOptions(['resources']),
      }).catch(() => null);

      queryClient.prefetchQuery({
        queryKey: ['lifeAreas'],
        queryFn: listLifeAreaFilters,
        ...getLocalQueryCacheOptions(['lifeAreas']),
      }).catch(() => null);
    })
    .catch(() => null);

  import('@/lib/projects-api')
    .then(({ listBoardWorkspaces }) => {
      queryClient.prefetchQuery({
        queryKey: ['projects'],
        queryFn: listBoardWorkspaces,
        ...getLocalQueryCacheOptions(['projects']),
      }).catch(() => null);
    })
    .catch(() => null);
}

export default function Sidebar({ expanded, onToggle, isMobile = false, mobileOpen = false, onCloseMobile }) {
  const location = useLocation();
  const queryClient = useQueryClient();

  const containerClasses = cn(
    "fixed left-0 top-0 bottom-0 z-50 flex flex-col transition-all duration-300 ease-in-out",
    "bg-[#111318] border-r border-white/[0.06]",
    isMobile ? "w-72" : expanded ? "w-56" : "w-[68px]"
  );

  if (isMobile) {
    return (
      <>
        <div
          className={cn(
            "fixed inset-0 z-40 bg-black/55 transition-opacity duration-300",
            mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          )}
          onClick={onCloseMobile}
          aria-hidden="true"
        />
        <aside
          className={cn(
            containerClasses,
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
          aria-hidden={!mobileOpen}
        >
          <div className="h-16 flex items-center justify-between px-4 shrink-0">
            <Link to={createPageUrl('Dashboard')} className="flex items-center gap-2.5 min-w-0" onClick={onCloseMobile}>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/20">
                <span className="text-white font-bold text-sm">L</span>
              </div>
              <span className="text-sm font-semibold tracking-tight text-foreground truncate">LifeOS</span>
            </Link>
            <button
              onClick={onCloseMobile}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors shrink-0"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="flex-1 px-2.5 space-y-0.5 mt-1 overflow-y-auto overflow-x-hidden">
            {navItems.map(item => {
              const pageUrl = createPageUrl(item.page);
              const isActive = location.pathname === pageUrl;
              return (
                <Link
                  key={item.page}
                  to={pageUrl}
                  onClick={() => {
                    prefetchNavTarget(item.page, queryClient);
                    onCloseMobile?.();
                  }}
                  onFocus={() => prefetchNavTarget(item.page, queryClient)}
                  onPointerEnter={() => prefetchNavTarget(item.page, queryClient)}
                  className={cn(
                    "flex items-center gap-3 h-11 rounded-lg text-[14px] font-medium transition-all duration-150 px-3",
                    isActive
                      ? "bg-white/[0.08] text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                  )}
                >
                  <item.icon className={cn("w-[18px] h-[18px] shrink-0", isActive && "text-violet-400")} />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>
      </>
    );
  }

  return (
    <aside className={containerClasses}>
      {/* Logo */}
      <div className={cn(
        "h-16 flex items-center shrink-0",
        expanded ? "justify-between px-4" : "justify-center px-2"
      )}>
        <Link 
          to={createPageUrl('Dashboard')} 
          className={cn("flex items-center gap-2.5 min-w-0", !expanded && "hidden")}
        >
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/20">
            <span className="text-white font-bold text-sm">L</span>
          </div>
          {expanded && (
            <span className="text-sm font-semibold tracking-tight text-foreground truncate">LifeOS</span>
          )}
        </Link>
        <button
          onClick={onToggle}
          className={cn(
            "rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors shrink-0",
            expanded ? "w-8 h-8 ml-2" : "w-12 h-12"
          )}
          aria-label={expanded ? "Collapse navigation" : "Open navigation"}
        >
          {expanded ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-6 h-6" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 space-y-0.5 mt-1 overflow-y-auto overflow-x-hidden">
        {navItems.map(item => {
          const pageUrl = createPageUrl(item.page);
          const isActive = location.pathname === pageUrl;
          return (
            <Link
              key={item.page}
              to={pageUrl}
              title={!expanded ? item.label : ''}
              onFocus={() => prefetchNavTarget(item.page, queryClient)}
              onPointerEnter={() => prefetchNavTarget(item.page, queryClient)}
              onClick={() => prefetchNavTarget(item.page, queryClient)}
              className={cn(
                "flex items-center gap-3 h-10 rounded-lg text-[13px] font-medium transition-all duration-150",
                expanded ? "px-3" : "px-0 justify-center",
                isActive
                  ? "bg-white/[0.08] text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              )}
            >
              <item.icon className={cn("w-[18px] h-[18px] shrink-0", isActive && "text-violet-400")} />
              {expanded && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 shrink-0">
        {expanded && (
          <p className="text-[10px] text-muted-foreground/30 tracking-wider">LifeOS v1.0</p>
        )}
      </div>
    </aside>
  );
}
