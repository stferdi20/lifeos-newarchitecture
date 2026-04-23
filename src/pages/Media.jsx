import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, LayoutGrid, Calendar, Film, Tv, Sword, BookOpen, Gamepad2, BookMarked, Layers, Search, CheckSquare, Loader2, Wrench, ServerCrash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { StaggerContainer, StaggerItem } from '@/components/ui/StaggerContainer';
import { getLocalQueryCacheOptions } from '@/lib/local-query-cache';
import { MediaEntry, bulkUpdateMediaEntries } from '@/lib/media-api';
import MediaCard from '../components/media/MediaCard';
import { PageHeader, PageActionRow } from '@/components/layout/page-header';
import { MobileActionOverflow } from '@/components/layout/MobileActionOverflow';
import { MobileFilterDrawer } from '@/components/layout/MobileFilterDrawer';
import {
  buildMediaExactQuery,
  flattenMediaPages,
  INITIAL_MEDIA_RENDER_COUNT,
  mapMediaQueryData,
  matchesMediaLibraryFilters,
  MEDIA_PAGE_SIZE,
  normalizeMediaEntries,
  normalizeMediaEntry,
  normalizeMediaSearch,
  prependMediaToQueryData,
  removeMediaFromQueryData,
} from '../components/media/mediaUtils';
import { fetchMediaHealth, getMediaBackendState } from '../components/media/searchMedia';
import { prewarmResourceImageCache } from '@/lib/resource-image-cache';

const MediaSearchModal = lazy(() => import('../components/media/MediaSearchModal'));
const loadMediaDetailModal = () => import('../components/media/MediaDetailModal');
const MediaDetailModal = lazy(loadMediaDetailModal);
import { PageLoader } from '@/components/ui/page-loader';
import BulkAddMediaModal from '@/components/media/BulkAddMediaModal';
const RepairMediaModal = lazy(() => import('../components/media/RepairMediaModal'));
const BulkStatusBar = lazy(() => import('../components/media/BulkStatusBar'));
const YearlyReview = lazy(() => import('../components/media/YearlyReview'));
import { useIsMobile } from '@/hooks/use-mobile';

const TYPE_FILTERS = [
  { key: 'all', label: 'All', icon: LayoutGrid },
  { key: 'movie', label: 'Movies', icon: Film },
  { key: 'series', label: 'Series', icon: Tv },
  { key: 'anime', label: 'Anime', icon: Sword },
  { key: 'manga', label: 'Manga', icon: BookOpen },
  { key: 'comic', label: 'Comics', icon: Layers },
  { key: 'book', label: 'Books', icon: BookMarked },
  { key: 'game', label: 'Games', icon: Gamepad2 },
];

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'completed', label: 'Completed' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'plan_to_watch', label: 'Backlog' },
  { key: 'dropped', label: 'Dropped' },
];

const MEDIA_DUPLICATE_FIELDS = [
  'id',
  'title',
  'media_type',
  'status',
  'year_consumed',
  'year_released',
  'year_ended',
  'release_status',
  'external_id',
  'source_url',
  'primary_provider',
  'secondary_providers',
  'created_date',
];
const MEDIA_ENTRY_FIELDS = [
  'id',
  'title',
  'media_type',
  'status',
  'year_consumed',
  'year_released',
  'year_ended',
  'release_status',
  'poster_url',
  'rating',
  'genres',
  'studio_author',
  'cast',
  'played_on',
  'platforms',
  'seasons_total',
  'episodes',
  'chapters',
  'page_count',
  'episodes_watched',
  'chapters_read',
  'seasons_watched',
  'notes',
  'external_id',
  'source_url',
  'plot',
  'duration',
  'language',
  'country',
  'imdb_rating',
  'awards',
  'themes',
  'volumes',
  'issues_total',
  'director_names',
  'creator_names',
  'author_names',
  'developer_names',
  'character_names',
  'concept_names',
  'publisher',
  'network',
  'primary_provider',
  'secondary_providers',
  'enrichment_version',
  'enriched_at',
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, index) => currentYear - index);

function MediaModalFallback() {
  return null;
}

async function fetchMediaPage({ exactQuery, limit, skip, fields = MEDIA_ENTRY_FIELDS }) {
  const rows = Object.keys(exactQuery).length > 0
    ? await MediaEntry.filter(exactQuery, '-created_date', limit, skip, fields)
    : await MediaEntry.list('-created_date', limit, skip, fields);

  return normalizeMediaEntries(rows);
}

export default function Media() {
  const [view, setView] = useState('library');
  const [showSearch, setShowSearch] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showRepair, setShowRepair] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const queryClient = useQueryClient();
  const gridRef = useRef(null);
  const rafRef = useRef(null);
  const detailCloseTimerRef = useRef(null);
  const isMobile = useIsMobile();
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = normalizeMediaSearch(deferredSearchQuery);
  const [gridMetrics, setGridMetrics] = useState({
    width: 0,
    top: 0,
    viewportHeight: 0,
    scrollY: 0,
  });

  const exactLibraryQuery = useMemo(
    () => buildMediaExactQuery(typeFilter, statusFilter),
    [typeFilter, statusFilter],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const preloadDetailModal = () => {
      void loadMediaDetailModal();
    };
    const idleId = window.requestIdleCallback
      ? window.requestIdleCallback(preloadDetailModal, { timeout: 1200 })
      : window.setTimeout(preloadDetailModal, 700);

    return () => {
      if (window.cancelIdleCallback && typeof idleId === 'number') {
        window.cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, []);

  useEffect(() => () => {
    if (detailCloseTimerRef.current) {
      window.clearTimeout(detailCloseTimerRef.current);
    }
  }, []);

  const { data: summaryEntries = [], isLoading: summaryLoading } = useQuery({
    queryKey: ['mediaSummary'],
    queryFn: async () => normalizeMediaEntries(
      await MediaEntry.list('-created_date', 5000, 0, MEDIA_DUPLICATE_FIELDS),
    ),
    initialData: [],
    ...getLocalQueryCacheOptions(['mediaSummary']),
  });

  const browseQuery = useInfiniteQuery({
    queryKey: ['mediaLibrary', 'browse', typeFilter, statusFilter],
    queryFn: ({ pageParam = 0 }) => fetchMediaPage({
      exactQuery: exactLibraryQuery,
      limit: MEDIA_PAGE_SIZE,
      skip: pageParam,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (
      lastPage.length === MEDIA_PAGE_SIZE ? allPages.length * MEDIA_PAGE_SIZE : undefined
    ),
    enabled: view === 'library' && !normalizedSearchQuery,
    ...getLocalQueryCacheOptions(['mediaLibrary']),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const searchResultsQuery = useQuery({
    queryKey: ['mediaLibrary', 'search', typeFilter, statusFilter, normalizedSearchQuery],
    queryFn: async () => {
      const rows = await fetchMediaPage({
        exactQuery: exactLibraryQuery,
        limit: 5000,
        skip: 0,
      });

      return rows.filter((entry) => {
        const searchable = [
          entry.title,
          entry.plot,
          entry.studio_author,
          ...(Array.isArray(entry.genres) ? entry.genres : []),
          ...(Array.isArray(entry.cast) ? entry.cast : []),
          ...(Array.isArray(entry.themes) ? entry.themes : []),
          ...(Array.isArray(entry.character_names) ? entry.character_names : []),
          ...(Array.isArray(entry.creator_names) ? entry.creator_names : []),
        ].filter(Boolean).join(' ').toLowerCase();

        const searchTerms = normalizedSearchQuery.split(/\s+/).filter(Boolean);
        return searchTerms.length === 0 || searchTerms.every(t => searchable.includes(t));
      });
    },
    enabled: view === 'library' && !!normalizedSearchQuery,
    initialData: [],
    ...getLocalQueryCacheOptions(['mediaLibrary']),
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const { data: yearlyEntries = [], isLoading: yearlyLoading } = useQuery({
    queryKey: ['mediaYearly', selectedYear],
    queryFn: async () => normalizeMediaEntries(
      await MediaEntry.filter({ year_consumed: selectedYear }, '-created_date', 5000, 0, MEDIA_ENTRY_FIELDS),
    ),
    enabled: view === 'yearly',
    initialData: [],
    ...getLocalQueryCacheOptions(['mediaYearly']),
  });

  const mediaHealthQuery = useQuery({
    queryKey: ['mediaHealth'],
    queryFn: fetchMediaHealth,
    ...getLocalQueryCacheOptions(['mediaHealth']),
    retry: 1,
  });

  const libraryEntries = normalizedSearchQuery
    ? searchResultsQuery.data
    : flattenMediaPages(browseQuery.data);

  const isLibraryLoading = normalizedSearchQuery
    ? searchResultsQuery.isLoading || searchResultsQuery.isFetching
    : browseQuery.isLoading || browseQuery.isFetching;

  const countsByType = useMemo(() => {
    return summaryEntries.reduce((acc, entry) => {
      acc.all += 1;
      acc[entry.media_type] = (acc[entry.media_type] || 0) + 1;
      return acc;
    }, { all: 0 });
  }, [summaryEntries]);

  const stats = useMemo(() => ({
    total: summaryEntries.filter((entry) => entry.status === 'completed').length,
    thisYear: summaryEntries.filter((entry) => entry.status === 'completed' && entry.year_consumed === currentYear).length,
  }), [summaryEntries]);
  const isLocalDebug = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const mediaBackendState = useMemo(
    () => getMediaBackendState(mediaHealthQuery.data),
    [mediaHealthQuery.data],
  );

  useEffect(() => {
    if (!mediaHealthQuery.data) return;

    if (!mediaBackendState.available || mediaBackendState.versionMismatch) {
      console.warn('Media backend mismatch detected:', {
        expected: mediaBackendState.expectedVersion,
        backend: mediaBackendState.backendVersion,
        functionsVersionHeader: mediaBackendState.functionsVersionHeader,
        error: mediaBackendState.error,
      });
    } else if (isLocalDebug) {
      console.info('Media backend healthy:', {
        version: mediaBackendState.backendVersion,
        functionsVersionHeader: mediaBackendState.functionsVersionHeader,
      });
    }
  }, [isLocalDebug, mediaBackendState, mediaHealthQuery.data]);

  const selectedEntries = useMemo(
    () => libraryEntries.filter((entry) => selectedIds.has(entry.id)),
    [libraryEntries, selectedIds],
  );

  const columnCount = useMemo(() => {
    if (typeof window === 'undefined') return 2;
    const viewportWidth = window.innerWidth;
    if (viewportWidth >= 1280) return 6;
    if (viewportWidth >= 1024) return 5;
    if (viewportWidth >= 768) return 4;
    if (viewportWidth >= 640) return 3;
    return 2;
  }, [gridMetrics.width]);

  const gridGap = 12;
  const horizontalPadding = 1;
  const columnWidth = useMemo(() => {
    if (!gridMetrics.width || columnCount <= 0) return 0;
    return Math.max(0, (gridMetrics.width - (gridGap * (columnCount - 1)) - horizontalPadding) / columnCount);
  }, [columnCount, gridMetrics.width]);

  const estimatedCardHeight = useMemo(() => {
    if (!columnWidth) return isMobile ? 320 : 380;
    const posterHeight = columnWidth * 1.5;
    const metadataHeight = isMobile ? 92 : 104;
    return posterHeight + metadataHeight;
  }, [columnWidth, isMobile]);

  const totalRows = useMemo(
    () => Math.ceil(libraryEntries.length / columnCount),
    [columnCount, libraryEntries.length],
  );

  const canFetchMore = !normalizedSearchQuery && browseQuery.hasNextPage;
  const overscanRows = isMobile ? 2 : 3;

  const visibleRange = useMemo(() => {
    if (!libraryEntries.length) {
      return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
    }

    if (!estimatedCardHeight || !gridMetrics.viewportHeight) {
      const fallbackCount = Math.min(INITIAL_MEDIA_RENDER_COUNT, libraryEntries.length);
      const rowsShown = Math.ceil(fallbackCount / columnCount);
      return {
        startIndex: 0,
        endIndex: fallbackCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: Math.max(0, (totalRows - rowsShown) * estimatedCardHeight),
      };
    }

    const relativeViewportTop = Math.max(0, gridMetrics.scrollY - gridMetrics.top);
    const relativeViewportBottom = Math.max(0, relativeViewportTop + gridMetrics.viewportHeight);
    const startRow = Math.max(0, Math.floor(relativeViewportTop / estimatedCardHeight) - overscanRows);
    const endRow = Math.min(
      totalRows,
      Math.ceil(relativeViewportBottom / estimatedCardHeight) + overscanRows,
    );

    return {
      startIndex: startRow * columnCount,
      endIndex: Math.min(libraryEntries.length, endRow * columnCount),
      topSpacerHeight: startRow * estimatedCardHeight,
      bottomSpacerHeight: Math.max(0, (totalRows - endRow) * estimatedCardHeight),
    };
  }, [
    columnCount,
    estimatedCardHeight,
    gridMetrics.scrollY,
    gridMetrics.top,
    gridMetrics.viewportHeight,
    libraryEntries.length,
    overscanRows,
    totalRows,
  ]);

  const renderedEntries = useMemo(
    () => libraryEntries.slice(visibleRange.startIndex, visibleRange.endIndex),
    [libraryEntries, visibleRange.endIndex, visibleRange.startIndex],
  );

  useEffect(() => {
    const entriesToPrewarm = view === 'yearly' ? yearlyEntries : libraryEntries;
    return prewarmResourceImageCache(entriesToPrewarm, { limit: 300, concurrency: 4 });
  }, [libraryEntries, view, yearlyEntries]);

  useEffect(() => {
    if (view !== 'library' || typeof window === 'undefined') return undefined;

    const updateMetrics = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = window.requestAnimationFrame(() => {
        const node = gridRef.current;
        const rect = node?.getBoundingClientRect();
        setGridMetrics({
          width: rect?.width || 0,
          top: rect ? rect.top + window.scrollY : 0,
          viewportHeight: window.innerHeight,
          scrollY: window.scrollY,
        });
      });
    };

    updateMetrics();
    window.addEventListener('scroll', updateMetrics, { passive: true });
    window.addEventListener('resize', updateMetrics);

    const resizeObserver = typeof ResizeObserver === 'function' && gridRef.current
      ? new ResizeObserver(() => updateMetrics())
      : null;

    if (resizeObserver && gridRef.current) {
      resizeObserver.observe(gridRef.current);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      window.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      resizeObserver?.disconnect();
    };
  }, [libraryEntries.length, view]);

  useEffect(() => {
    if (!canFetchMore || browseQuery.isFetchingNextPage) return;

    const fetchThreshold = columnCount * 3;
    if (visibleRange.endIndex + fetchThreshold >= libraryEntries.length) {
      browseQuery.fetchNextPage();
    }
  }, [browseQuery, canFetchMore, columnCount, libraryEntries.length, visibleRange.endIndex]);

  const applyEntryUpdate = useCallback((updatedEntry) => {
    queryClient.setQueriesData({ queryKey: ['mediaLibrary'] }, (old) => mapMediaQueryData(old, (entry) => (
      entry.id === updatedEntry.id ? { ...entry, ...updatedEntry } : entry
    )));

    queryClient.setQueriesData({ queryKey: ['mediaYearly'] }, (old) => mapMediaQueryData(old, (entry) => (
      entry.id === updatedEntry.id ? { ...entry, ...updatedEntry } : entry
    )));

    queryClient.setQueryData(['mediaSummary'], (old = []) => old.map((entry) => (
      entry.id === updatedEntry.id ? { ...entry, ...updatedEntry } : entry
    )));
  }, [queryClient]);

  const removeEntryFromCaches = useCallback((id) => {
    queryClient.setQueriesData({ queryKey: ['mediaLibrary'] }, (old) => removeMediaFromQueryData(old, id));
    queryClient.setQueriesData({ queryKey: ['mediaYearly'] }, (old) => removeMediaFromQueryData(old, id));
    queryClient.setQueryData(['mediaSummary'], (old = []) => old.filter((entry) => entry.id !== id));
  }, [queryClient]);

  const handleMediaCreated = useCallback((savedEntry) => {
    const normalizedSavedEntry = normalizeMediaEntry(savedEntry);

    if (!normalizedSavedEntry?.id) {
      queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
      return;
    }

    queryClient.setQueryData(['mediaSummary'], (old = []) => [
      normalizedSavedEntry,
      ...old.filter((entry) => entry.id !== normalizedSavedEntry.id),
    ]);

    queryClient.setQueriesData({ queryKey: ['mediaLibrary'] }, (old) => {
      if (!old) return old;

      const matches = matchesMediaLibraryFilters(normalizedSavedEntry, {
        typeFilter,
        statusFilter,
        searchQuery: normalizedSearchQuery,
      });

      return matches ? prependMediaToQueryData(old, normalizedSavedEntry, MEDIA_PAGE_SIZE) : old;
    });

    if (normalizedSavedEntry.year_consumed === selectedYear) {
      queryClient.setQueryData(['mediaYearly', selectedYear], (old = []) => [
        normalizedSavedEntry,
        ...old.filter((entry) => entry.id !== normalizedSavedEntry.id),
      ]);
    }

    queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
    queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
    queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
  }, [normalizedSearchQuery, queryClient, selectedYear, statusFilter, typeFilter]);

  const handleOpenExistingMedia = useCallback((entry) => {
    const normalizedEntry = normalizeMediaEntry(entry);
    if (!normalizedEntry?.id) return;

    if (detailCloseTimerRef.current) {
      window.clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }
    setShowSearch(false);
    setShowBulkAdd(false);
    setSelectedEntry(normalizedEntry);
    setShowDetail(true);
  }, []);

  const handleCardClick = useCallback((entry) => {
    const normalizedEntry = normalizeMediaEntry(entry);
    if (!normalizedEntry?.id) return;

    if (selectMode) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(normalizedEntry.id)) next.delete(normalizedEntry.id);
        else next.add(normalizedEntry.id);
        return next;
      });
      return;
    }

    if (detailCloseTimerRef.current) {
      window.clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }
    setSelectedEntry(normalizedEntry);
    setShowDetail(true);
  }, [selectMode]);

  const handleCloseDetail = useCallback(() => {
    setShowDetail(false);

    if (detailCloseTimerRef.current) {
      window.clearTimeout(detailCloseTimerRef.current);
    }

    detailCloseTimerRef.current = window.setTimeout(() => {
      setSelectedEntry(null);
      detailCloseTimerRef.current = null;
    }, 260);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (form) => {
      if (form.id) {
        return MediaEntry.update(form.id, form);
      }

      return MediaEntry.create(form);
    },
    onMutate: async (form) => {
      if (!form.id) return {};

      await queryClient.cancelQueries({ queryKey: ['mediaLibrary'] });
      await queryClient.cancelQueries({ queryKey: ['mediaYearly'] });

      const previousLibrary = queryClient.getQueriesData({ queryKey: ['mediaLibrary'] });
      const previousYearly = queryClient.getQueriesData({ queryKey: ['mediaYearly'] });
      const previousSummary = queryClient.getQueryData(['mediaSummary']);

      applyEntryUpdate(form);
      return { previousLibrary, previousYearly, previousSummary };
    },
    onError: (_error, form, context) => {
      context?.previousLibrary?.forEach(([key, value]) => queryClient.setQueryData(key, value));
      context?.previousYearly?.forEach(([key, value]) => queryClient.setQueryData(key, value));
      if (context?.previousSummary) {
        queryClient.setQueryData(['mediaSummary'], context.previousSummary);
      }
      if (form.id) {
        setSelectedEntry(form);
      }
    },
    onSuccess: (savedEntry) => {
      const normalizedSavedEntry = normalizeMediaEntry(savedEntry);
      if (!normalizedSavedEntry?.id) {
        queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
        queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
        queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
        return;
      }

      applyEntryUpdate(normalizedSavedEntry);
      queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => MediaEntry.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['mediaLibrary'] });
      await queryClient.cancelQueries({ queryKey: ['mediaYearly'] });

      const previousLibrary = queryClient.getQueriesData({ queryKey: ['mediaLibrary'] });
      const previousYearly = queryClient.getQueriesData({ queryKey: ['mediaYearly'] });
      const previousSummary = queryClient.getQueryData(['mediaSummary']);

      removeEntryFromCaches(id);
      return { previousLibrary, previousYearly, previousSummary };
    },
    onError: (_error, _id, context) => {
      context?.previousLibrary?.forEach(([key, value]) => queryClient.setQueryData(key, value));
      context?.previousYearly?.forEach(([key, value]) => queryClient.setQueryData(key, value));
      if (context?.previousSummary) {
        queryClient.setQueryData(['mediaSummary'], context.previousSummary);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
      setShowDetail(false);
      setSelectedEntry(null);
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: async ({ ids, newStatus, yearConsumed }) => {
      const update = { status: newStatus };
      if (yearConsumed !== null) {
        update.year_consumed = yearConsumed;
      }

      return bulkUpdateMediaEntries({ ids, update });
    },
    onMutate: async ({ ids, newStatus, yearConsumed }) => {
      await queryClient.cancelQueries({ queryKey: ['mediaLibrary'] });
      await queryClient.cancelQueries({ queryKey: ['mediaYearly'] });

      const previousLibrary = queryClient.getQueriesData({ queryKey: ['mediaLibrary'] });
      const previousYearly = queryClient.getQueriesData({ queryKey: ['mediaYearly'] });
      const previousSummary = queryClient.getQueryData(['mediaSummary']);

      queryClient.setQueriesData({ queryKey: ['mediaLibrary'] }, (old) => mapMediaQueryData(old, (entry) => (
        ids.includes(entry.id)
          ? { ...entry, status: newStatus, ...(yearConsumed !== null ? { year_consumed: yearConsumed } : {}) }
          : entry
      )));

      queryClient.setQueriesData({ queryKey: ['mediaYearly'] }, (old) => mapMediaQueryData(old, (entry) => (
        ids.includes(entry.id)
          ? { ...entry, status: newStatus, ...(yearConsumed !== null ? { year_consumed: yearConsumed } : {}) }
          : entry
      )));

      queryClient.setQueryData(['mediaSummary'], (old = []) => old.map((entry) => (
        ids.includes(entry.id)
          ? { ...entry, status: newStatus, ...(yearConsumed !== null ? { year_consumed: yearConsumed } : {}) }
          : entry
      )));

      return { previousLibrary, previousYearly, previousSummary };
    },
    onError: (_error, _variables, context) => {
      context?.previousLibrary?.forEach(([key, value]) => queryClient.setQueryData(key, value));
      context?.previousYearly?.forEach(([key, value]) => queryClient.setQueryData(key, value));
      if (context?.previousSummary) {
        queryClient.setQueryData(['mediaSummary'], context.previousSummary);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
      setSelectedIds(new Set());
      setSelectMode(false);
    },
  });

  const isInitialLoading = summaryLoading || 
    (view === 'library' && !normalizedSearchQuery && browseQuery.isLoading) || 
    (view === 'yearly' && yearlyLoading);

  if (isInitialLoading) {
    return <PageLoader label="Loading media..." />;
  }

  return (
    <StaggerContainer className="space-y-6">
      <StaggerItem>
      <PageHeader
        icon={Film}
        title="Media Tracker"
        description={`${stats.total} completed all time · ${stats.thisYear} in ${currentYear}`}
        actions={(
          <PageActionRow>
            {/* Desktop Actions */}
            <div className="hidden sm:flex gap-2 w-full sm:w-auto items-center">
              <div className="flex gap-1 bg-secondary/40 rounded-lg p-1">
                <button
                  onClick={() => setView('library')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    view === 'library' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <LayoutGrid className="w-3.5 h-3.5" /> Library
                </button>
                <button
                  onClick={() => setView('yearly')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                    view === 'yearly' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Calendar className="w-3.5 h-3.5" /> Yearly
                </button>
              </div>
              <Button
                variant={selectMode ? 'default' : 'outline'}
                onClick={() => {
                  setSelectMode((mode) => !mode);
                  setSelectedIds(new Set());
                }}
                className={cn('border-border text-sm', selectMode && 'bg-primary/20 text-primary border-primary/30')}
              >
                <CheckSquare className="w-4 h-4 mr-2" /> {selectMode ? 'Cancel' : 'Select'}
              </Button>
              <Button variant="outline" onClick={() => setShowRepair(true)} className="border-border text-sm">
                <Wrench className="w-4 h-4 mr-2" /> Repair
              </Button>
              <Button variant="outline" onClick={() => setShowBulkAdd(true)} className="border-border text-sm">
                <Plus className="w-4 h-4 mr-2" /> Bulk Add
              </Button>
              <Button onClick={() => setShowSearch(true)} className="bg-primary hover:bg-primary/90 text-white text-sm">
                <Plus className="w-4 h-4 mr-2" /> Add Media
              </Button>
            </div>

            {/* Mobile Actions Header Row */}
            <div className="flex w-full sm:hidden gap-2">
              <MobileActionOverflow 
                className="flex-[0_0_auto]"
                actions={[
                  { label: view === 'library' ? 'Yearly View' : 'Library View', icon: view === 'library' ? Calendar : LayoutGrid, onClick: () => setView(view === 'library' ? 'yearly' : 'library') },
                  { label: selectMode ? 'Cancel Select' : 'Select', icon: CheckSquare, onClick: () => { setSelectMode((m) => !m); setSelectedIds(new Set()); } },
                  { label: 'Repair Media', icon: Wrench, onClick: () => setShowRepair(true) },
                  { label: 'Bulk Add', icon: Plus, onClick: () => setShowBulkAdd(true) }
                ]}
              />
              <Button onClick={() => setShowSearch(true)} className="flex-1 bg-primary hover:bg-primary/90 text-white text-sm">
                <Plus className="w-4 h-4 mr-2" /> Add Media
              </Button>
            </div>
          </PageActionRow>
        )}
      />
      </StaggerItem>

      {(isLocalDebug || !mediaBackendState.available || mediaBackendState.versionMismatch) && (
        <StaggerItem>
        <div className={cn(
          'flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
          !mediaBackendState.available || mediaBackendState.versionMismatch
            ? 'border-amber-500/20 bg-amber-500/5 text-amber-100'
            : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100',
        )}>
          <ServerCrash className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            !mediaBackendState.available || mediaBackendState.versionMismatch ? 'text-amber-300' : 'text-emerald-300',
          )} />
          <div>
            <p className="font-medium">
              {!mediaBackendState.available || mediaBackendState.versionMismatch
                ? 'Remote media backend issue detected'
                : 'Remote media backend looks current'}
            </p>
            <p className="mt-1 text-xs leading-relaxed opacity-80">
              {!mediaBackendState.available
                ? (mediaBackendState.error || 'The remote Base44 backend did not expose the current media health check.')
                : mediaBackendState.versionMismatch
                  ? `Frontend expects ${mediaBackendState.expectedVersion}, but the backend reports ${mediaBackendState.backendVersion || 'unknown'}.`
                  : `Backend version ${mediaBackendState.backendVersion}${mediaBackendState.functionsVersionHeader ? ` · functions header ${mediaBackendState.functionsVersionHeader}` : ''}.`}
            </p>
          </div>
        </div>
        </StaggerItem>
      )}

      {view === 'yearly' ? (
        <StaggerItem>
        <div>
          <div className="flex gap-2 mb-6 flex-wrap">
            {YEARS.map((year) => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                className={cn(
                  'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  selectedYear === year ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary/50',
                )}
              >
                {year}
              </button>
            ))}
          </div>

          <Suspense fallback={<div className="py-12 flex items-center justify-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading yearly review...</div>}>
            {yearlyLoading ? (
              <div className="py-12 flex items-center justify-center text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading yearly review...
              </div>
            ) : (
              <YearlyReview entries={yearlyEntries} year={selectedYear} />
            )}
          </Suspense>
        </div>
        </StaggerItem>
      ) : (
        <>
          <StaggerItem className="space-y-3">
            <div className="flex gap-2 items-center w-full">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search library..."
                  className="pl-8 bg-secondary/40 border-border/50 h-8 text-sm"
                />
              </div>
              <div className="sm:hidden flex-1 max-w-[120px]">
                <MobileFilterDrawer activeCount={(typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0)} triggerClassName="w-full">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Type</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {TYPE_FILTERS.map((filter) => {
                          const Icon = filter.icon;
                          const count = countsByType[filter.key] || 0;
                          return (
                            <button
                              key={filter.key}
                              onClick={() => setTypeFilter(filter.key)}
                              className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                                typeFilter === filter.key
                                  ? 'bg-primary/20 text-primary border-primary/30'
                                  : 'bg-secondary/20 text-muted-foreground border-border/20 hover:bg-secondary/40',
                              )}
                            >
                              <Icon className="w-3 h-3" />
                              {filter.label}
                              <span className="opacity-60">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Status</p>
                      <div className="flex gap-1 flex-wrap">
                        {STATUS_FILTERS.map((status) => (
                          <button
                            key={status.key}
                            onClick={() => setStatusFilter(status.key)}
                            className={cn(
                              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                              statusFilter === status.key ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary/40',
                            )}
                          >
                            {status.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </MobileFilterDrawer>
              </div>
            </div>

            {/* Desktop Filters */}
            <div className="hidden sm:block space-y-3">
              <div className="flex gap-1.5 flex-wrap">
                {TYPE_FILTERS.map((filter) => {
                  const Icon = filter.icon;
                  const count = countsByType[filter.key] || 0;
                  return (
                    <button
                      key={filter.key}
                      onClick={() => setTypeFilter(filter.key)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                        typeFilter === filter.key
                          ? 'bg-primary/20 text-primary border-primary/30'
                          : 'bg-secondary/20 text-muted-foreground border-border/20 hover:bg-secondary/40',
                      )}
                    >
                      <Icon className="w-3 h-3" />
                      {filter.label}
                      <span className="opacity-60">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-1">
                {STATUS_FILTERS.map((status) => (
                  <button
                    key={status.key}
                    onClick={() => setStatusFilter(status.key)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      statusFilter === status.key ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary/40',
                    )}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>
          </StaggerItem>

          {isLibraryLoading && libraryEntries.length === 0 ? (
            <StaggerItem>
            <div className="py-16 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading media...
            </div>
            </StaggerItem>
          ) : libraryEntries.length > 0 ? (
            <StaggerItem>
              <p className="text-xs text-muted-foreground mb-3">
                Showing {Math.min(visibleRange.endIndex, libraryEntries.length)} of {libraryEntries.length}
                {canFetchMore ? ' loaded so far' : ''}
              </p>
              <div
                ref={gridRef}
                style={{
                  paddingTop: visibleRange.topSpacerHeight,
                  paddingBottom: visibleRange.bottomSpacerHeight,
                }}
              >
                <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {renderedEntries.map((entry) => (
                    <StaggerItem key={entry.id} className="relative">
                      {selectMode && (
                        <div
                          className={cn(
                            'absolute top-2 right-2 z-10 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors',
                            selectedIds.has(entry.id)
                              ? 'bg-primary border-primary text-white'
                              : 'bg-black/40 border-white/40',
                          )}
                        >
                          {selectedIds.has(entry.id) && <CheckSquare className="w-3 h-3" />}
                        </div>
                      )}
                      <MediaCard
                        entry={entry}
                        onClick={handleCardClick}
                        onDelete={(id) => deleteMutation.mutate(id)}
                        className={selectMode && selectedIds.has(entry.id) ? 'ring-2 ring-primary' : ''}
                      />
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </div>

              <div className="h-12 flex items-center justify-center">
                {browseQuery.isFetchingNextPage && (
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
              </div>
            </StaggerItem>
          ) : (
            <StaggerItem>
            <div className="text-center py-20">
              <Film className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">No media found. Start adding!</p>
              <Button onClick={() => setShowSearch(true)} className="mt-4 bg-primary/20 text-primary hover:bg-primary/30 border-0">
                <Plus className="w-4 h-4 mr-2" /> Add your first title
              </Button>
            </div>
            </StaggerItem>
          )}
        </>
      )}

      <Suspense fallback={<MediaModalFallback />}>
        {selectMode && selectedIds.size > 0 && (
          <BulkStatusBar
            selectedIds={selectedIds}
            entries={selectedEntries}
            onApply={(newStatus, yearConsumed) => bulkStatusMutation.mutate({
              ids: [...selectedIds],
              newStatus,
              yearConsumed,
            })}
            onClear={() => {
              setSelectedIds(new Set());
              setSelectMode(false);
            }}
          />
        )}
      </Suspense>

      <Suspense fallback={<MediaModalFallback />}>
        {showSearch && (
          <MediaSearchModal
            open={showSearch}
            onClose={() => setShowSearch(false)}
            onCreated={handleMediaCreated}
            mediaHealth={mediaHealthQuery.data}
            existingEntries={summaryEntries}
            onOpenExisting={handleOpenExistingMedia}
          />
        )}
      </Suspense>

      <Suspense fallback={<MediaModalFallback />}>
        {showBulkAdd && (
          <BulkAddMediaModal
            open={showBulkAdd}
            onClose={() => setShowBulkAdd(false)}
            existingEntries={summaryEntries}
            onOpenExisting={handleOpenExistingMedia}
            onCreated={() => {
              queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
              queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
              queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
            }}
          />
        )}
      </Suspense>

      <Suspense fallback={<MediaModalFallback />}>
        {showRepair && (
          <RepairMediaModal
            open={showRepair}
            onClose={() => setShowRepair(false)}
            onRepaired={() => {
              queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
              queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
              queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
            }}
          />
        )}
      </Suspense>

      <Suspense fallback={<MediaModalFallback />}>
        {selectedEntry && (
          <MediaDetailModal
            open={showDetail}
            onClose={handleCloseDetail}
            entry={selectedEntry}
            onSave={(form) => saveMutation.mutateAsync(form)}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        )}
      </Suspense>
    </StaggerContainer>
  );
}
