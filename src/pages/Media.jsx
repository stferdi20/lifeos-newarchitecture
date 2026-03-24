import React, { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, LayoutGrid, Calendar, Film, Tv, Sword, BookOpen, Gamepad2, BookMarked, Layers, Search, CheckSquare, Loader2, Wrench, ServerCrash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
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
  MEDIA_RENDER_STEP,
  normalizeMediaEntries,
  normalizeMediaEntry,
  normalizeMediaSearch,
  prependMediaToQueryData,
  removeMediaFromQueryData,
} from '../components/media/mediaUtils';
import { fetchMediaHealth, getMediaBackendState } from '../components/media/searchMedia';

const MediaSearchModal = lazy(() => import('../components/media/MediaSearchModal'));
const MediaDetailModal = lazy(() => import('../components/media/MediaDetailModal'));
import { PageLoader } from '@/components/ui/page-loader';
import BulkAddMediaModal from '@/components/media/BulkAddMediaModal';
const RepairMediaModal = lazy(() => import('../components/media/RepairMediaModal'));
const BulkStatusBar = lazy(() => import('../components/media/BulkStatusBar'));
const YearlyReview = lazy(() => import('../components/media/YearlyReview'));

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

const MEDIA_SUMMARY_FIELDS = ['id', 'media_type', 'status', 'year_consumed'];
const MEDIA_ENTRY_FIELDS = [
  'id',
  'title',
  'media_type',
  'status',
  'year_consumed',
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
  const [visibleCount, setVisibleCount] = useState(INITIAL_MEDIA_RENDER_COUNT);
  const queryClient = useQueryClient();
  const loadMoreRef = useRef(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = normalizeMediaSearch(deferredSearchQuery);

  const exactLibraryQuery = useMemo(
    () => buildMediaExactQuery(typeFilter, statusFilter),
    [typeFilter, statusFilter],
  );

  const { data: summaryEntries = [], isLoading: summaryLoading } = useQuery({
    queryKey: ['mediaSummary'],
    queryFn: async () => normalizeMediaEntries(
      await MediaEntry.list('-created_date', 5000, 0, MEDIA_SUMMARY_FIELDS),
    ),
    initialData: [],
    staleTime: 1000 * 60 * 10,
    gcTime: 1000 * 60 * 30,
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
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
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
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
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
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });

  const mediaHealthQuery = useQuery({
    queryKey: ['mediaHealth'],
    queryFn: fetchMediaHealth,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
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

  const renderedEntries = useMemo(
    () => libraryEntries.slice(0, visibleCount),
    [libraryEntries, visibleCount],
  );

  useEffect(() => {
    setVisibleCount(INITIAL_MEDIA_RENDER_COUNT);
  }, [normalizedSearchQuery, statusFilter, typeFilter, view]);

  const canRevealMoreRendered = renderedEntries.length < libraryEntries.length;
  const canFetchMore = !normalizedSearchQuery && browseQuery.hasNextPage;

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || view !== 'library' || typeof IntersectionObserver !== 'function') return undefined;

    const observer = new IntersectionObserver((entries) => {
      const firstEntry = entries[0];
      if (!firstEntry?.isIntersecting) return;

      if (canRevealMoreRendered) {
        setVisibleCount((count) => Math.min(count + MEDIA_RENDER_STEP, libraryEntries.length));
        return;
      }

      if (canFetchMore && !browseQuery.isFetchingNextPage) {
        browseQuery.fetchNextPage();
      }
    }, { rootMargin: '240px' });

    observer.observe(node);
    return () => observer.disconnect();
  }, [browseQuery, canFetchMore, canRevealMoreRendered, libraryEntries.length, view]);

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

    setSelectedEntry(normalizedEntry);
    setShowDetail(true);
  }, [selectMode]);

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
    onSuccess: (savedEntry, form) => {
      const normalizedSavedEntry = normalizeMediaEntry(savedEntry);
      if (!normalizedSavedEntry?.id) {
        queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
        queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
        queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });
        setShowDetail(false);
        setSelectedEntry(null);
        return;
      }

      if (form.id) {
        applyEntryUpdate(normalizedSavedEntry);
      } else {
        queryClient.setQueryData(['mediaSummary'], (old = []) => [normalizedSavedEntry, ...old.filter((entry) => entry.id !== normalizedSavedEntry.id)]);

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
          queryClient.setQueryData(['mediaYearly', selectedYear], (old = []) => [normalizedSavedEntry, ...old.filter((entry) => entry.id !== normalizedSavedEntry.id)]);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['mediaLibrary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaSummary'] });
      queryClient.invalidateQueries({ queryKey: ['mediaYearly'] });

      setShowDetail(false);
      setSelectedEntry(null);
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
    <div>
      <PageHeader
        icon={Film}
        title="Media Tracker"
        description={`${stats.total} completed all time · ${stats.thisYear} in ${currentYear}`}
        className="mb-6"
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

      {(isLocalDebug || !mediaBackendState.available || mediaBackendState.versionMismatch) && (
        <div className={cn(
          'mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm',
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
      )}

      {view === 'yearly' ? (
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
      ) : (
        <>
          <div className="space-y-3 mb-6">
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
          </div>

          {isLibraryLoading && libraryEntries.length === 0 ? (
            <div className="py-16 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading media...
            </div>
          ) : libraryEntries.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                Showing {renderedEntries.length} of {libraryEntries.length}
                {canFetchMore ? ' loaded so far' : ''}
              </p>
              <motion.div layout className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                <AnimatePresence mode="popLayout">
                  {renderedEntries.map((entry) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      key={entry.id}
                      className="relative"
                    >
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
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>

              <div ref={loadMoreRef} className="h-12 flex items-center justify-center">
                {(browseQuery.isFetchingNextPage || canRevealMoreRendered) && (
                  <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                )}
              </div>
            </>
          ) : (
            <div className="text-center py-20">
              <Film className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">No media found. Start adding!</p>
              <Button onClick={() => setShowSearch(true)} className="mt-4 bg-primary/20 text-primary hover:bg-primary/30 border-0">
                <Plus className="w-4 h-4 mr-2" /> Add your first title
              </Button>
            </div>
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
          />
        )}
      </Suspense>

      <Suspense fallback={<MediaModalFallback />}>
        {showBulkAdd && (
          <BulkAddMediaModal
            open={showBulkAdd}
            onClose={() => setShowBulkAdd(false)}
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
        {showDetail && (
          <MediaDetailModal
            open={showDetail}
            onClose={() => {
              setShowDetail(false);
              setSelectedEntry(null);
            }}
            entry={selectedEntry}
            onSave={(form) => saveMutation.mutate(form)}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        )}
      </Suspense>
    </div>
  );
}
