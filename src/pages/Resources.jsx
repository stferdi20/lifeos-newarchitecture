import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Search, FileText, Sparkles, CheckSquare } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getLocalQueryCacheOptions } from '@/lib/local-query-cache';
import { listBoardWorkspaces } from '@/lib/projects-api';
import {
  CardResource,
  ProjectResource,
  Resource,
  listLifeAreaFilters,
  listProjectResourceLinks,
  listResourceCards,
  reEnrichResources,
  retryResourceCapture,
} from '@/lib/resources-api';
import { retryInstagramDownloadForResource, retryInstagramEnrichmentForResource } from '@/lib/instagram-downloader-api';
import { retryYouTubeTranscriptForResource } from '@/lib/youtube-transcript-api';
import {
  getResourceProfileSnapshot,
  isResourceProfilingEnabled,
  recordResourceProfileEvent,
  resetResourceProfileSession,
  startResourceProfileSpan,
  subscribeToResourceProfile,
  summarizeResourceProfile,
} from '@/lib/resource-profile';
import { isGenericCaptureActive } from '@/lib/resource-capture';
import { prewarmResourceImageCache } from '@/lib/resource-image-cache';
import ResourceFilters from '../components/resources/ResourceFilters';
import ResourceCard from '../components/resources/ResourceCard';
import QuickPasteButton from '../components/resources/QuickPasteButton';
import BulkResourceActionBar from '../components/resources/BulkResourceActionBar';
import { PageHeader, PageActionRow } from '@/components/layout/page-header';
import { MobileActionOverflow } from '@/components/layout/MobileActionOverflow';
import { MobileFilterDrawer } from '@/components/layout/MobileFilterDrawer';

const AddResourceModal = lazy(() => import('../components/resources/AddResourceModal'));
const BulkAddModal = lazy(() => import('../components/resources/BulkAddModal'));
const ManualNoteModal = lazy(() => import('../components/resources/ManualNoteModal'));
const ResourceDetailModal = lazy(() => import('../components/resources/ResourceDetailModal'));

const RESOURCE_LAYOUT_STORAGE_KEY = 'lifeos.resources.layout-mode';
const RESOURCE_GRID_DENSITY_STORAGE_KEY = 'lifeos.resources.grid-density';
const DEFAULT_RESOURCE_LAYOUT_MODE = 'gallery';
const DEFAULT_RESOURCE_GRID_DENSITY = 'normal';
const RESOURCE_QUERY_STALE_TIME = 60_000;
const RESOURCE_QUERY_GC_TIME = 10 * 60_000;
const RESOURCE_INITIAL_VISIBLE_COUNT = 24;
const RESOURCE_VISIBLE_INCREMENT = 24;

function ResourceGridSkeleton({ layoutMode, gridDensity }) {
  const count = layoutMode === 'grid' ? 12 : 8;
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={`resource-loading-${index}`}
          className={cn(
            'overflow-hidden rounded-2xl border border-border/50 bg-card/70',
            gridDensity === 'compact' ? 'min-h-[220px]' : 'min-h-[280px]',
          )}
        >
          <div className={cn(
            'animate-pulse bg-secondary/50',
            layoutMode === 'grid' ? 'h-36' : 'aspect-[16/10]',
          )} />
          <div className="space-y-3 p-4">
            <div className="h-3 w-24 animate-pulse rounded-full bg-secondary/60" />
            <div className="h-4 w-4/5 animate-pulse rounded-full bg-secondary/70" />
            <div className="h-4 w-3/5 animate-pulse rounded-full bg-secondary/50" />
            <div className="flex gap-2 pt-2">
              <div className="h-5 w-16 animate-pulse rounded-full bg-secondary/50" />
              <div className="h-5 w-20 animate-pulse rounded-full bg-secondary/40" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function normalizeLayoutMode(value) {
  if (value === 'grid' || value === 'gallery' || value === 'magazine') return value;
  if (value === 'freeflow') return 'gallery';
  return DEFAULT_RESOURCE_LAYOUT_MODE;
}

function normalizeGridDensity(value) {
  return value === 'compact' ? 'compact' : DEFAULT_RESOURCE_GRID_DENSITY;
}

function buildResourceSearchText(resource = {}) {
  const terms = [
    resource.instagram_display_title,
    resource.title,
    resource.author,
    resource.instagram_author_handle,
    resource.summary,
    resource.why_it_matters,
    resource.who_its_for,
    resource.explanation_for_newbies,
    resource.main_topic,
    ...(Array.isArray(resource.tags) ? resource.tags : []),
    ...(Array.isArray(resource.key_points) ? resource.key_points : []),
    ...(Array.isArray(resource.actionable_points) ? resource.actionable_points : []),
    ...(Array.isArray(resource.use_cases) ? resource.use_cases : []),
  ];

  return terms
    .filter((value) => value != null && value !== '')
    .join(' ')
    .toLowerCase();
}

async function fetchResourceLinks(entityApi, resourceId) {
  if (!entityApi) return [];

  if (entityApi.filter) {
    try {
      return await entityApi.filter({ resource_id: resourceId });
    } catch {
      // Fall back to list-based cleanup for entities that do not support this filter shape.
    }
  }

  if (entityApi.list) {
    const rows = await entityApi.list();
    return (rows || []).filter((row) => row?.resource_id === resourceId);
  }

  return [];
}

function ResourceProfilePanel() {
  const [summary, setSummary] = useState(() => summarizeResourceProfile(getResourceProfileSnapshot()));

  useEffect(() => {
    const sync = () => setSummary(summarizeResourceProfile(getResourceProfileSnapshot()));
    sync();
    return subscribeToResourceProfile(sync);
  }, []);

  if (!summary?.enabled) return null;

  return (
    <div className="rounded-2xl border border-sky-500/25 bg-sky-500/10 p-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-sky-200">Resources Profiler</p>
          <p className="text-sky-100/70">Enable with `?profileResources=1` while running locally.</p>
        </div>
        <span className="rounded-full border border-sky-400/30 px-2 py-0.5 text-[11px] text-sky-100/80">
          Session {summary.sessionAgeMs ?? 0}ms
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-background/30 p-3">
          <p className="text-[10px] uppercase tracking-wider text-sky-100/60">Route</p>
          <p className="mt-1 text-sm text-foreground">Mounted: {summary.routeMountedMs ?? 'n/a'}ms</p>
          <p className="text-sm text-foreground">First paint: {summary.firstPaintMs ?? 'n/a'}ms</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-background/30 p-3">
          <p className="text-[10px] uppercase tracking-wider text-sky-100/60">Queries</p>
          <p className="mt-1 text-sm text-foreground">Resources: {summary.resourcesReadyMs ?? 'n/a'}ms</p>
          <p className="text-sm text-foreground">Projects: {summary.projectsReadyMs ?? 'n/a'}ms</p>
          <p className="text-sm text-foreground">Areas: {summary.areasReadyMs ?? 'n/a'}ms</p>
          <p className="text-sm text-foreground">Project links: {summary.projectFilterReadyMs ?? 'n/a'}ms</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-background/30 p-3">
          <p className="text-[10px] uppercase tracking-wider text-sky-100/60">API/Auth</p>
          <p className="mt-1 text-sm text-foreground">Requests: {summary.apiCount}</p>
          <p className="text-sm text-foreground">Token total: {summary.totalTokenMs ?? 'n/a'}ms</p>
          <p className="text-sm text-foreground">Fetch total: {summary.totalFetchMs ?? 'n/a'}ms</p>
          <p className="text-sm text-foreground">Downloader: {summary.downloaderReadyMs ?? 'n/a'}ms</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-background/30 p-3">
          <p className="text-[10px] uppercase tracking-wider text-sky-100/60">Images</p>
          <p className="mt-1 text-sm text-foreground">Loaded: {summary.imageCount}</p>
          <p className="text-sm text-foreground">First image: {summary.firstImageMs ?? 'n/a'}ms</p>
          <p className="text-sm text-foreground">Last image: {summary.lastImageMs ?? 'n/a'}ms</p>
        </div>
      </div>

      {summary.requestSummaries?.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[11px]">
            <thead className="text-sky-100/60">
              <tr>
                <th className="pb-2 font-medium">Request</th>
                <th className="pb-2 font-medium">At</th>
                <th className="pb-2 font-medium">Total</th>
                <th className="pb-2 font-medium">Token</th>
                <th className="pb-2 font-medium">Fetch</th>
                <th className="pb-2 font-medium">JSON</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="text-foreground/90">
              {summary.requestSummaries.map((request, index) => (
                <tr key={`${request.label}-${index}`} className="border-t border-white/5">
                  <td className="py-2 pr-3">{request.label}</td>
                  <td className="py-2 pr-3">{request.atMs ?? 'n/a'}ms</td>
                  <td className="py-2 pr-3">{request.totalMs ?? 'n/a'}ms</td>
                  <td className="py-2 pr-3">{request.tokenMs ?? 'n/a'}ms</td>
                  <td className="py-2 pr-3">{request.fetchMs ?? 'n/a'}ms</td>
                  <td className="py-2 pr-3">{request.jsonMs ?? 'n/a'}ms</td>
                  <td className="py-2">{request.status ?? 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Resources() {
  const REENRICH_BATCH_SIZE = 25;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const profilingEnabled = isResourceProfilingEnabled();

  const urlParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialProject = urlParams.get('projectId') || null;
  const initialTag = urlParams.get('tag') || null;

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [areaFilter, setAreaFilter] = useState('all');
  const [archivedFilter, setArchivedFilter] = useState('active');
  const [projectFilter, setProjectFilter] = useState(initialProject);
  const [tagFilter, setTagFilter] = useState(initialTag);
  const [selectedResource, setSelectedResource] = useState(null);
  const [showAddUrl, setShowAddUrl] = useState(false);
  const [showManualNote, setShowManualNote] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [layoutMode, setLayoutMode] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_RESOURCE_LAYOUT_MODE;
    const storedValue = window.localStorage.getItem(RESOURCE_LAYOUT_STORAGE_KEY);
    return normalizeLayoutMode(storedValue);
  });
  const [gridDensity, setGridDensity] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_RESOURCE_GRID_DENSITY;
    const storedValue = window.localStorage.getItem(RESOURCE_GRID_DENSITY_STORAGE_KEY);
    return normalizeGridDensity(storedValue);
  });
  const [reenrichProgress, setReenrichProgress] = useState({
    scope: null,
    total: 0,
    processed: 0,
    updated: 0,
    failed: 0,
  });
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return window.innerWidth;
  });
  const [visibleResourceCount, setVisibleResourceCount] = useState(RESOURCE_INITIAL_VISIBLE_COUNT);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    if (!profilingEnabled) return undefined;
    resetResourceProfileSession('Resources route');
    recordResourceProfileEvent('resources:route-mounted', {
      projectFilter: initialProject || '',
      tagFilter: initialTag || '',
    });
    return undefined;
  }, [initialProject, initialTag, profilingEnabled]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RESOURCE_LAYOUT_STORAGE_KEY, layoutMode);
    } catch {
      // Ignore storage failures and keep the view usable.
    }
  }, [layoutMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(RESOURCE_GRID_DENSITY_STORAGE_KEY, gridDensity);
    } catch {
      // Ignore storage failures and keep the view usable.
    }
  }, [gridDensity]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateViewportWidth = () => {
      setViewportWidth(window.innerWidth);
    };

    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);

    return () => {
      window.removeEventListener('resize', updateViewportWidth);
    };
  }, []);

  const { data: resources = [], isLoading: resourcesLoading } = useQuery({
    queryKey: ['resources'],
    initialData: () => queryClient.getQueryData(['resources']),
    initialDataUpdatedAt: () => queryClient.getQueryState(['resources'])?.dataUpdatedAt,
    queryFn: async () => {
      const finish = startResourceProfileSpan('resources:query');
      try {
        const result = await listResourceCards(200);
        finish({ count: result.length });
        return result;
      } catch (error) {
        finish({ error: error?.message || 'unknown' });
        throw error;
      }
    },
    ...getLocalQueryCacheOptions(['resources'], {
      staleTime: RESOURCE_QUERY_STALE_TIME,
      gcTime: RESOURCE_QUERY_GC_TIME,
    }),
    refetchOnMount: false,
    refetchInterval: (query) => {
      const currentResources = Array.isArray(query.state.data) ? query.state.data : [];
      const hasPendingBackgroundWork = currentResources.some((resource) => {
        const isQueuedInstagram = ['queued', 'processing'].includes(resource?.download_status);
        const isQueuedYouTubeTranscript = resource?.resource_type === 'youtube'
          && ['queued', 'processing'].includes(resource?.youtube_transcript_status);
        return isQueuedInstagram || isQueuedYouTubeTranscript || isGenericCaptureActive(resource);
      });
      return hasPendingBackgroundWork ? 3000 : false;
    },
  });

  useEffect(() => {
    if (!resources.length) return undefined;
    return prewarmResourceImageCache(resources, { limit: 120, concurrency: 4 });
  }, [resources]);

  const hasInstagramResources = useMemo(
    () => resources.some((resource) => ['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(resource?.resource_type)),
    [resources],
  );

  const { data: downloaderStatus } = useQuery({
    queryKey: ['instagram-downloader-status'],
    queryFn: async () => {
      const finish = startResourceProfileSpan('resources:downloader-status-query');
      const module = await import('@/lib/instagram-downloader-api');
      try {
        const result = await module.getInstagramDownloaderStatus();
        finish();
        return result;
      } catch (error) {
        finish({ error: error?.message || 'unknown' });
        throw error;
      }
    },
    enabled: hasInstagramResources,
    staleTime: 30_000,
    refetchInterval: 5000,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const finish = startResourceProfileSpan('resources:projects-query');
      try {
        const result = await listBoardWorkspaces();
        finish({ count: result.length });
        return result;
      } catch (error) {
        finish({ error: error?.message || 'unknown' });
        throw error;
      }
    },
    ...getLocalQueryCacheOptions(['projects'], {
      staleTime: RESOURCE_QUERY_STALE_TIME,
      gcTime: RESOURCE_QUERY_GC_TIME,
    }),
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['lifeAreas'],
    queryFn: async () => {
      const finish = startResourceProfileSpan('resources:areas-query');
      try {
        const result = await listLifeAreaFilters();
        finish({ count: result.length });
        return result;
      } catch (error) {
        finish({ error: error?.message || 'unknown' });
        throw error;
      }
    },
    ...getLocalQueryCacheOptions(['lifeAreas'], {
      staleTime: RESOURCE_QUERY_STALE_TIME,
      gcTime: RESOURCE_QUERY_GC_TIME,
    }),
  });

  const { data: projectResources = [], isLoading: projectResourcesLoading } = useQuery({
    queryKey: ['projectResources', projectFilter || 'all'],
    queryFn: async () => {
      const finish = startResourceProfileSpan('resources:project-links-query', {
        projectFilter: projectFilter || '',
      });
      try {
        const result = await listProjectResourceLinks(projectFilter ? { project_id: projectFilter } : {});
        finish({ count: result.length });
        return result;
      } catch (error) {
        finish({ error: error?.message || 'unknown' });
        throw error;
      }
    },
    enabled: Boolean(projectFilter),
    ...getLocalQueryCacheOptions(['projectResources'], {
      staleTime: RESOURCE_QUERY_STALE_TIME,
      gcTime: RESOURCE_QUERY_GC_TIME,
    }),
  });

  const projectResourceIds = useMemo(() => {
    if (!projectFilter) return null;
    if (projectResourcesLoading && projectResources.length === 0) return null;
    return new Set(
      projectResources.filter(pr => pr.project_id === projectFilter).map(pr => pr.resource_id || pr.note_id)
    );
  }, [projectFilter, projectResources, projectResourcesLoading]);

  const resourceSearchIndex = useMemo(
    () => new Map(resources.map((resource) => [resource.id, buildResourceSearchText(resource)])),
    [resources],
  );

  const allTags = useMemo(() => {
    const tagSet = new Set();
    resources.forEach(r => (Array.isArray(r.tags) ? r.tags : []).forEach(t => tagSet.add(t)));
    return [...tagSet].sort();
  }, [resources]);

  const filteredResources = useMemo(() => {
    const searchTerms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return resources.filter(r => {
      if (typeFilter !== 'all' && r.resource_type !== typeFilter) return false;
      if (areaFilter !== 'all' && r.area_id !== areaFilter) return false;
      if (archivedFilter === 'active' && r.is_archived) return false;
      if (archivedFilter === 'archived' && !r.is_archived) return false;
      if (projectResourceIds && !projectResourceIds.has(r.id)) return false;
      if (tagFilter && !(Array.isArray(r.tags) ? r.tags : []).includes(tagFilter)) return false;
      if (searchTerms.length > 0) {
        const searchable = resourceSearchIndex.get(r.id) || '';
        const matchesAll = searchTerms.every(t => searchable.includes(t));
        if (!matchesAll) return false;
      }
      return true;
    });
  }, [resources, search, typeFilter, areaFilter, archivedFilter, projectResourceIds, resourceSearchIndex, tagFilter]);

  useEffect(() => {
    setVisibleResourceCount(RESOURCE_INITIAL_VISIBLE_COUNT);
  }, [search, typeFilter, areaFilter, archivedFilter, projectFilter, tagFilter, layoutMode, gridDensity]);

  useEffect(() => {
    setVisibleResourceCount((current) => {
      if (filteredResources.length <= current) return current;
      return Math.min(current, filteredResources.length);
    });
  }, [filteredResources.length]);

  const visibleResources = useMemo(
    () => filteredResources.slice(0, visibleResourceCount),
    [filteredResources, visibleResourceCount],
  );

  const hasMoreResourcesToRender = visibleResources.length < filteredResources.length;

  const layoutColumnCount = useMemo(() => {
    const isCompactDensity = gridDensity === 'compact';
    if (layoutMode === 'grid') {
      if (isCompactDensity && viewportWidth >= 1536) return 5;
      if (viewportWidth >= 1280) return 4;
      if (viewportWidth >= 1024) return 3;
      if (viewportWidth >= 640) return 2;
      return 1;
    }

    if (isCompactDensity && viewportWidth >= 1536) return 5;
    if (viewportWidth >= 1280) return 4;
    if (viewportWidth >= 1024) return 3;
    if (viewportWidth >= 640) return 2;
    return 1;
  }, [gridDensity, layoutMode, viewportWidth]);

  const isGridLayout = layoutMode === 'grid';

  const stableColumnResources = useMemo(() => {
    if (isGridLayout) return [];
    const columns = Array.from({ length: layoutColumnCount }, () => []);
    visibleResources.forEach((resource, index) => {
      columns[index % layoutColumnCount].push(resource);
    });
    return columns;
  }, [visibleResources, isGridLayout, layoutColumnCount]);

  const resourceListStyle = {
    gridTemplateColumns: `repeat(${layoutColumnCount}, minmax(0, 1fr))`,
    gap: layoutMode === 'gallery' ? '1.25rem' : '1rem',
  };

  useEffect(() => {
    if (!profilingEnabled || resourcesLoading || visibleResources.length === 0 || typeof window === 'undefined') {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      recordResourceProfileEvent('resources:first-paint', {
        renderedCount: visibleResources.length,
        filteredCount: filteredResources.length,
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [filteredResources.length, profilingEnabled, resourcesLoading, visibleResources.length]);

  useEffect(() => {
    if (!hasMoreResourcesToRender || typeof window === 'undefined') return undefined;

    const node = loadMoreRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleResourceCount((current) => Math.min(current + RESOURCE_VISIBLE_INCREMENT, filteredResources.length));
      },
      { rootMargin: '240px 0px' },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [filteredResources.length, hasMoreResourcesToRender]);

  const selectedResources = useMemo(
    () => resources.filter((resource) => selectedIds.has(resource.id)),
    [resources, selectedIds],
  );

  const activeSelectedResource = useMemo(() => {
    if (!selectedResource?.id) return selectedResource;
    return resources.find((resource) => resource.id === selectedResource.id) || selectedResource;
  }, [resources, selectedResource]);

  const invalidateResourceQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    queryClient.invalidateQueries({ queryKey: ['projectResources'] });
    queryClient.invalidateQueries({ queryKey: ['card-resource-links'] });
  };

  const buildReenrichLabel = (scopeLabel) => {
    if (!reenrichProgress.total || !reenrichProgress.scope) return `Re-enriching ${scopeLabel}...`;
    return `Processing 25 at a time (${Math.min(reenrichProgress.processed, reenrichProgress.total)}/${reenrichProgress.total})`;
  };

  const runReenrichInBatches = async ({ resourceIds, toastId, scope, scopeLabel }) => {
    const ids = [...new Set((resourceIds || []).filter(Boolean))];
    if (!ids.length) {
      return {
        total: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
    }

    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    setReenrichProgress({
      scope,
      total: ids.length,
      processed: 0,
      updated: 0,
      failed: 0,
    });

    toast.loading(`Processing 25 at a time (0/${ids.length})`, {
      id: toastId,
      description: `${scopeLabel} re-enrichment is running in batches.`,
    });

    for (let index = 0; index < ids.length; index += REENRICH_BATCH_SIZE) {
      const batchIds = ids.slice(index, index + REENRICH_BATCH_SIZE);
      try {
        const result = await reEnrichResources({
          resource_ids: batchIds,
          batch_size: REENRICH_BATCH_SIZE,
        });

        updated += Number(result?.updated || 0);
        skipped += Number(result?.skipped || 0);
        failed += Number(result?.failed || 0);
      } catch {
        failed += batchIds.length;
      }

      processed += batchIds.length;

      setReenrichProgress({
        scope,
        total: ids.length,
        processed,
        updated,
        failed,
      });

      invalidateResourceQueries();

      toast.loading(`Processing 25 at a time (${Math.min(processed, ids.length)}/${ids.length})`, {
        id: toastId,
        description: `${updated} updated${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}.`,
      });
    }

    setReenrichProgress({
      scope: null,
      total: 0,
      processed: 0,
      updated: 0,
      failed: 0,
    });

    return {
      total: ids.length,
      updated,
      skipped,
      failed,
    };
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectMode(false);
  };

  const bulkUpdateMutation = useMutation({
    mutationFn: async (updater) => {
      await Promise.all(selectedResources.map((resource) => (
        Resource.update(resource.id, updater(resource))
      )));
    },
    onSuccess: () => {
      invalidateResourceQueries();
      clearSelection();
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update selected resources.');
    },
  });

  const archiveToggleMutation = useMutation({
    mutationFn: async ({ resourceId, isArchived }) => (
      Resource.update(resourceId, { is_archived: isArchived })
    ),
    onSuccess: (_, variables) => {
      invalidateResourceQueries();
      setSelectedResource((current) => (
        current?.id === variables.resourceId
          ? { ...current, is_archived: variables.isArchived }
          : current
      ));
      toast.success(variables.isArchived ? 'Resource archived.' : 'Resource restored.');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update archive status.');
    },
  });

  const retryResourceMutation = useMutation({
    mutationFn: async (targetResource) => {
      const isInstagram = ['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(targetResource?.resource_type);
      const isYouTube = targetResource?.resource_type === 'youtube';
      if (isInstagram) {
        const canRetryEnrichmentOnly = targetResource?.instagram_enrichment_status === 'failed'
          && (targetResource?.download_status === 'uploaded' || targetResource?.drive_files?.length || targetResource?.drive_folder_url);
        return canRetryEnrichmentOnly
          ? retryInstagramEnrichmentForResource(targetResource.id)
          : retryInstagramDownloadForResource(targetResource.id);
      }
      if (isYouTube) {
        return retryYouTubeTranscriptForResource(targetResource.id);
      }
      return retryResourceCapture(targetResource.id);
    },
    onSuccess: (_, targetResource) => {
      invalidateResourceQueries();
      if (targetResource?.resource_type === 'youtube') {
        queryClient.invalidateQueries({ queryKey: ['youtube-transcript-status'] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['instagram-downloader-status'] });
      }
      queryClient.invalidateQueries({ queryKey: ['resource-detail', targetResource?.id] });
      toast.success('Retry queued.');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to retry this resource.');
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      await Promise.all(selectedResources.map(async (resource) => {
        const [projectLinks, cardLinks] = await Promise.all([
          fetchResourceLinks(ProjectResource, resource.id),
          fetchResourceLinks(CardResource, resource.id),
        ]);

        await Promise.all([
          ...projectLinks.map((link) => ProjectResource.delete(link.id)),
          ...cardLinks.map((link) => CardResource.delete(link.id)),
        ]);

        await Resource.delete(resource.id);
      }));
    },
    onSuccess: () => {
      invalidateResourceQueries();
      clearSelection();
      setSelectedResource(null);
      toast.success('Selected resources deleted.');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to delete selected resources.');
    },
  });

  const bulkReenrichMutation = useMutation({
    mutationFn: async () => runReenrichInBatches({
      resourceIds: selectedResources.map((resource) => resource.id),
      toastId: 'resource-reenrich-selected',
      scope: 'selected',
      scopeLabel: `${selectedResources.length} selected resource${selectedResources.length === 1 ? '' : 's'}`,
    }),
    onSuccess: (result) => {
      const updated = Number(result?.updated || 0);
      const skipped = Number(result?.skipped || 0);
      const failed = Number(result?.failed || 0);
      toast.success(
        `Re-enrichment finished: ${updated} updated${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}.`,
        {
          id: 'resource-reenrich-selected',
        },
      );
    },
    onError: (error) => {
      setReenrichProgress({
        scope: null,
        total: 0,
        processed: 0,
        updated: 0,
        failed: 0,
      });
      toast.error(error?.message || 'Failed to re-enrich selected resources.', {
        id: 'resource-reenrich-selected',
      });
    },
  });

  const deleteDirectMutation = useMutation({
    mutationFn: async (resource) => {
      const resourceId = resource?.id;
      if (!resourceId) throw new Error('Resource id is missing.');

      const [projectLinks, cardLinks] = await Promise.all([
        fetchResourceLinks(ProjectResource, resourceId),
        fetchResourceLinks(CardResource, resourceId),
      ]);
      await Promise.all([
        ...projectLinks.map((link) => ProjectResource.delete(link.id)),
        ...cardLinks.map((link) => CardResource.delete(link.id)),
      ]);
      await Resource.delete(resourceId);
    },
    onMutate: async (resource) => {
      const resourceId = resource?.id;
      if (!resourceId) return { previousResources: null };

      await queryClient.cancelQueries({ queryKey: ['resources'] });
      const previousResources = queryClient.getQueryData(['resources']);

      queryClient.setQueryData(['resources'], (current) => {
        if (!Array.isArray(current)) return current;
        return current.filter((item) => item?.id !== resourceId);
      });
      setSelectedResource((current) => (
        current?.id === resourceId ? null : current
      ));
      setSelectedIds((current) => {
        if (!current.has(resourceId)) return current;
        const next = new Set(current);
        next.delete(resourceId);
        return next;
      });

      return { previousResources };
    },
    onSuccess: () => {
      toast.success('Resource deleted.');
    },
    onError: (error, _resource, context) => {
      if (Array.isArray(context?.previousResources)) {
        queryClient.setQueryData(['resources'], context.previousResources);
      }
      toast.error(error?.message || 'Failed to delete resource.');
    },
    onSettled: () => {
      invalidateResourceQueries();
    },
  });

  const handleManualSave = async (form) => {
    await Resource.create(form);
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    setShowManualNote(false);
  };

  const handleResourceCreated = (createdResource) => {
    if (createdResource?.id) {
      queryClient.setQueryData(['resources'], (current) => {
        const list = Array.isArray(current) ? current : [];
        return [createdResource, ...list.filter((resource) => resource?.id !== createdResource.id)];
      });
      setSelectedResource((current) => (
        current?.id === createdResource.id ? createdResource : current
      ));
    }
    invalidateResourceQueries();
  };

  const handleCardClick = (resource) => {
    if (selectMode) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(resource.id)) next.delete(resource.id);
        else next.add(resource.id);
        return next;
      });
      return;
    }

    setSelectedResource(resource);
  };

  const handleArchiveToggle = (resource) => {
    archiveToggleMutation.mutate({
      resourceId: resource.id,
      isArchived: !resource.is_archived,
    });
  };

  const projectName = projectFilter ? projects.find(p => p.id === projectFilter)?.name : null;

  useEffect(() => {
    const nextProject = urlParams.get('projectId') || null;
    const nextTag = urlParams.get('tag') || null;

    setProjectFilter(current => current === nextProject ? current : nextProject);
    setTagFilter(current => current === nextTag ? current : nextTag);
  }, [urlParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(location.search);

    if (projectFilter) {
      nextParams.set('projectId', projectFilter);
    } else {
      nextParams.delete('projectId');
    }

    if (tagFilter) {
      nextParams.set('tag', tagFilter);
    } else {
      nextParams.delete('tag');
    }

    const nextSearch = nextParams.toString();
    const currentSearch = location.search.startsWith('?') ? location.search.slice(1) : location.search;

    if (nextSearch !== currentSearch) {
      navigate(
        {
          pathname: location.pathname,
          search: nextSearch ? `?${nextSearch}` : '',
        },
        { replace: true }
      );
    }
  }, [navigate, location.pathname, location.search, projectFilter, tagFilter]);

  const handleTagClick = (tag) => {
    setSelectedResource(null);
    setTagFilter(tag);
    navigate({
      pathname: '/Resources',
      search: `?${new URLSearchParams({
        ...(projectFilter ? { projectId: projectFilter } : {}),
        tag,
      }).toString()}`,
    });
  };

  const renderResourceCard = (resource) => (
    <ResourceCard
      key={resource.id}
      resource={resource}
      onClick={handleCardClick}
      onArchiveToggle={handleArchiveToggle}
      onDelete={(targetResource) => deleteDirectMutation.mutate(targetResource)}
      onRetry={(targetResource) => retryResourceMutation.mutate(targetResource)}
      onTagClick={handleTagClick}
      areas={areas}
      selectMode={selectMode}
      selected={selectedIds.has(resource.id)}
      layoutMode={layoutMode}
      gridDensity={gridDensity}
      archiveLoading={archiveToggleMutation.isPending && archiveToggleMutation.variables?.resourceId === resource.id}
      deleteLoading={deleteDirectMutation.isPending && deleteDirectMutation.variables?.id === resource.id}
      retryLoading={retryResourceMutation.isPending && retryResourceMutation.variables?.id === resource.id}
    />
  );

  const isInitialResourcesLoad = resourcesLoading && resources.length === 0;

  return (
    <div className="space-y-6 overflow-x-hidden">
      <PageHeader
        icon={BookOpen}
        title={projectName ? `Resources · ${projectName}` : 'Resources'}
        description="AI-powered knowledge capture & organization."
        actions={(
          <PageActionRow>
            {/* Desktop Actions */}
            <div className="hidden sm:flex gap-2 w-full sm:w-auto items-center">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="border-border bg-secondary/40 pl-9" />
              </div>
              <Button variant="outline" onClick={() => setShowManualNote(true)} className="border-border gap-1.5">
                <FileText className="w-4 h-4" /> Note
              </Button>
              <Button variant="outline" onClick={() => setShowBulkAdd(true)} className="border-border gap-1.5">
                <Sparkles className="w-4 h-4" /> Bulk Add
              </Button>
              <Button
                variant={selectMode ? 'default' : 'outline'}
                onClick={() => {
                  if (selectMode) {
                    clearSelection();
                    return;
                  }
                  setSelectMode(true);
                  setSelectedIds(new Set());
                }}
                className="border-border gap-1.5"
              >
                <CheckSquare className="w-4 h-4" /> {selectMode ? 'Cancel' : 'Select'}
              </Button>
              <Button onClick={() => setShowAddUrl(true)} className="gap-1.5">
                <Sparkles className="w-4 h-4" /> Add URL
              </Button>
            </div>

            {/* Mobile Actions Header Row */}
            <div className="flex w-full sm:hidden gap-2">
              <MobileActionOverflow 
                className="flex-[0_0_auto]"
                actions={[
                  { label: 'Note', icon: FileText, onClick: () => setShowManualNote(true) },
                  { label: 'Bulk Add', icon: Sparkles, onClick: () => setShowBulkAdd(true) },
                  { label: selectMode ? 'Cancel Select' : 'Select', icon: CheckSquare, onClick: () => {
                    if (selectMode) clearSelection();
                    else { setSelectMode(true); setSelectedIds(new Set()); }
                  }}
                ]}
              />
              <Button onClick={() => setShowAddUrl(true)} className="flex-1 bg-primary hover:bg-primary/90 text-white text-sm">
                <Sparkles className="w-4 h-4 mr-2" /> Add URL
              </Button>
            </div>
          </PageActionRow>
        )}
      />

      <div className="sm:hidden flex gap-2 w-full">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="border-border bg-secondary/40 pl-9" />
        </div>
        <div className="flex-1 max-w-[120px]">
          <MobileFilterDrawer 
            activeCount={(typeFilter !== 'all' ? 1 : 0) + (areaFilter !== 'all' ? 1 : 0) + (archivedFilter !== 'active' ? 1 : 0) + (projectFilter ? 1 : 0) + (tagFilter ? 1 : 0)} 
            triggerClassName="w-full"
          >
            <ResourceFilters
              typeFilter={typeFilter} setTypeFilter={setTypeFilter}
              areaFilter={areaFilter} setAreaFilter={setAreaFilter}
              archivedFilter={archivedFilter} setArchivedFilter={setArchivedFilter}
              projectFilter={projectFilter} setProjectFilter={setProjectFilter}
              tagFilter={tagFilter} setTagFilter={setTagFilter}
              projects={projects} allTags={allTags} areas={areas}
            />
          </MobileFilterDrawer>
        </div>
      </div>

      <div className="hidden sm:block">
        <ResourceFilters
          typeFilter={typeFilter} setTypeFilter={setTypeFilter}
          areaFilter={areaFilter} setAreaFilter={setAreaFilter}
          archivedFilter={archivedFilter} setArchivedFilter={setArchivedFilter}
          projectFilter={projectFilter} setProjectFilter={setProjectFilter}
          tagFilter={tagFilter} setTagFilter={setTagFilter}
          projects={projects} allTags={allTags} areas={areas}
        />
      </div>

      {profilingEnabled && <ResourceProfilePanel />}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {isInitialResourcesLoad
            ? 'Loading resources...'
            : `Showing ${visibleResources.length} of ${filteredResources.length} resource${filteredResources.length !== 1 ? 's' : ''}`}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {projectFilter && projectResourcesLoading && (
            <p className="text-xs text-muted-foreground">Applying project filter…</p>
          )}
          {downloaderStatus?.worker?.state === 'stale' && (
            <p className="text-xs text-muted-foreground">Local worker heartbeat is stale. Queue recovery is active and queued captures should resume shortly.</p>
          )}
          {downloaderStatus?.worker?.state !== 'stale' && downloaderStatus?.worker?.online === false && (
            <p className="text-xs text-muted-foreground">Local worker offline. Queued captures will resume when it comes back online.</p>
          )}
          <div className="inline-flex rounded-xl border border-border/60 bg-card/70 p-1">
            <button
              type="button"
              onClick={() => setLayoutMode('grid')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                layoutMode === 'grid'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Grid
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('gallery')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                layoutMode === 'gallery'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Gallery
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('magazine')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                layoutMode === 'magazine'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Magazine
            </button>
          </div>
          <div className="inline-flex rounded-xl border border-border/60 bg-card/70 p-1">
            <button
              type="button"
              onClick={() => setGridDensity('normal')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                gridDensity === 'normal'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Comfortable
            </button>
            <button
              type="button"
              onClick={() => setGridDensity('compact')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                gridDensity === 'compact'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Compact
            </button>
          </div>
        </div>
      </div>

      <div
        style={isGridLayout ? undefined : resourceListStyle}
        className={cn(
          isGridLayout
            ? cn(
              'grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
              gridDensity === 'compact'
                ? 'gap-3 2xl:grid-cols-5'
                : 'gap-4',
            )
            : 'grid items-start',
        )}
      >
        {isInitialResourcesLoad ? (
          <ResourceGridSkeleton layoutMode={layoutMode} gridDensity={gridDensity} />
        ) : isGridLayout
          ? visibleResources.map((resource) => renderResourceCard(resource))
          : stableColumnResources.map((columnResources, columnIndex) => (
            <div
              key={`resource-column-${columnIndex}`}
              className={cn('flex min-w-0 flex-col', layoutMode === 'gallery' ? 'gap-5' : 'gap-4')}
            >
              {columnResources.map((resource) => renderResourceCard(resource))}
            </div>
          ))}
      </div>

      {!isInitialResourcesLoad && hasMoreResourcesToRender && (
        <div ref={loadMoreRef} className="flex justify-center pt-2">
          <div className="rounded-full border border-border/50 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground">
            Loading more resources…
          </div>
        </div>
      )}

      {!isInitialResourcesLoad && filteredResources.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 p-12 text-center">
          <BookOpen className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No resources found. Add your first one!</p>
        </div>
      )}

      <Suspense fallback={null}>
        <AddResourceModal
          open={showAddUrl}
          onClose={() => setShowAddUrl(false)}
          onCreated={handleResourceCreated}
          projectId={projectFilter}
        />

        <ManualNoteModal
          open={showManualNote}
          onClose={() => setShowManualNote(false)}
          onSave={handleManualSave}
        />

        <BulkAddModal
          open={showBulkAdd}
          onClose={() => setShowBulkAdd(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['resources'] })}
          projectId={projectFilter}
        />

        {selectedResource && (
          <ResourceDetailModal
            open={!!activeSelectedResource}
            onClose={() => setSelectedResource(null)}
            resource={activeSelectedResource}
          />
        )}
      </Suspense>

      {selectMode && selectedIds.size > 0 && (
        <BulkResourceActionBar
          selectedIds={selectedIds}
          selectedResources={selectedResources}
          areas={areas}
          isWorking={bulkUpdateMutation.isPending || bulkDeleteMutation.isPending || bulkReenrichMutation.isPending}
          isReenrichingSelected={bulkReenrichMutation.isPending}
          reenrichSelectedLabel={buildReenrichLabel('selected')}
          onArchive={() => bulkUpdateMutation.mutate(() => ({ is_archived: true }))}
          onUnarchive={() => bulkUpdateMutation.mutate(() => ({ is_archived: false }))}
          onReenrich={() => bulkReenrichMutation.mutate()}
          onAssignArea={(areaId) => bulkUpdateMutation.mutate(() => ({ area_id: areaId }))}
          onAddTag={(tagInput) => {
            const normalizedTag = tagInput.trim().toLowerCase();
            if (!normalizedTag) return;
            bulkUpdateMutation.mutate((resource) => ({
              tags: [...new Set([...(resource.tags || []), normalizedTag])],
            }));
          }}
          onRemoveTag={(tagToRemove) => {
            if (!tagToRemove) return;
            bulkUpdateMutation.mutate((resource) => ({
              tags: (resource.tags || []).filter((tag) => tag !== tagToRemove),
            }));
          }}
          onDelete={() => bulkDeleteMutation.mutate()}
          onClear={clearSelection}
        />
      )}

      <QuickPasteButton
        onCreated={handleResourceCreated}
        projectId={projectFilter}
      />
    </div>
  );
}
