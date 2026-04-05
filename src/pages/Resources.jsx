import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Search, FileText, Sparkles, CheckSquare, Loader2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { listBoardWorkspaces } from '@/lib/projects-api';
import { CardResource, LifeArea, ProjectResource, Resource, reEnrichResources, retryResourceCapture } from '@/lib/resources-api';
import { retryInstagramDownloadForResource } from '@/lib/instagram-downloader-api';
import { isGenericCaptureActive } from '@/lib/resource-capture';
import ResourceFilters from '../components/resources/ResourceFilters';
import ResourceCard from '../components/resources/ResourceCard';
import ResourceDetailModal from '../components/resources/ResourceDetailModal';
import AddResourceModal from '../components/resources/AddResourceModal';
import QuickPasteButton from '../components/resources/QuickPasteButton';
import ManualNoteModal from '../components/resources/ManualNoteModal';
import BulkAddModal from '../components/resources/BulkAddModal';
import BulkResourceActionBar from '../components/resources/BulkResourceActionBar';
import { PageHeader, PageActionRow } from '@/components/layout/page-header';
import { MobileActionOverflow } from '@/components/layout/MobileActionOverflow';
import { MobileFilterDrawer } from '@/components/layout/MobileFilterDrawer';
import { PageLoader } from '@/components/ui/page-loader';
import { useIsMobile } from '@/hooks/use-mobile';

const RESOURCE_LAYOUT_STORAGE_KEY = 'lifeos.resources.layout-mode';
const RESOURCE_GRID_DENSITY_STORAGE_KEY = 'lifeos.resources.grid-density';
const DEFAULT_RESOURCE_LAYOUT_MODE = 'gallery';
const DEFAULT_RESOURCE_GRID_DENSITY = 'normal';

function normalizeLayoutMode(value) {
  if (value === 'grid' || value === 'gallery' || value === 'magazine') return value;
  if (value === 'freeflow') return 'gallery';
  return DEFAULT_RESOURCE_LAYOUT_MODE;
}

function normalizeGridDensity(value) {
  return value === 'compact' ? 'compact' : DEFAULT_RESOURCE_GRID_DENSITY;
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

export default function Resources() {
  const REENRICH_BATCH_SIZE = 25;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

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
  const listRef = useRef(null);
  const rafRef = useRef(null);
  const [listMetrics, setListMetrics] = useState({
    width: 0,
    top: 0,
    viewportHeight: 0,
    scrollY: 0,
  });

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

  const { data: resources = [], isLoading: resourcesLoading } = useQuery({
    queryKey: ['resources'],
    queryFn: () => Resource.list('-created_date', 200),
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

  const { data: downloaderStatus } = useQuery({
    queryKey: ['instagram-downloader-status'],
    queryFn: async () => {
      const module = await import('@/lib/instagram-downloader-api');
      return module.getInstagramDownloaderStatus();
    },
    refetchInterval: 5000,
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listBoardWorkspaces(),
  });

  const { data: areas = [], isLoading: areasLoading } = useQuery({
    queryKey: ['lifeAreas'],
    queryFn: () => LifeArea.list(),
  });

  const { data: projectResources = [], isLoading: projectResourcesLoading } = useQuery({
    queryKey: ['projectResources'],
    queryFn: () => ProjectResource.list(),
  });

  const projectResourceIds = useMemo(() => {
    if (!projectFilter) return null;
    return new Set(
      projectResources.filter(pr => pr.project_id === projectFilter).map(pr => pr.resource_id || pr.note_id)
    );
  }, [projectFilter, projectResources]);

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
        const searchable = [
          r.title,
          r.summary,
          r.why_it_matters,
          r.who_its_for,
          r.content,
          r.main_topic,
          r.author,
          ...(Array.isArray(r.tags) ? r.tags : []),
          ...(Array.isArray(r.key_points) ? r.key_points : []),
          ...(Array.isArray(r.actionable_points) ? r.actionable_points : []),
          ...(Array.isArray(r.use_cases) ? r.use_cases : []),
          ...(Array.isArray(r.learning_outcomes) ? r.learning_outcomes : []),
          ...(Array.isArray(r.notable_quotes_or_moments) ? r.notable_quotes_or_moments : []),
        ].filter(Boolean).join(' ').toLowerCase();
        
        const matchesAll = searchTerms.every(t => searchable.includes(t));
        if (!matchesAll) return false;
      }
      return true;
    });
  }, [resources, search, typeFilter, areaFilter, archivedFilter, projectResourceIds, tagFilter]);

  const layoutColumnCount = useMemo(() => {
    if (typeof window === 'undefined') return 1;
    const viewportWidth = window.innerWidth;
    const isCompactGrid = layoutMode === 'grid' && gridDensity === 'compact';
    if (layoutMode === 'grid') {
      if (isCompactGrid && viewportWidth >= 1536) return 5;
      if (viewportWidth >= 1280) return 4;
      if (viewportWidth >= 1024) return 3;
      if (viewportWidth >= 640) return 2;
      return 1;
    }

    if (viewportWidth >= 1280) return 4;
    if (viewportWidth >= 1024) return 3;
    if (viewportWidth >= 640) return 2;
    return 1;
  }, [gridDensity, layoutMode, listMetrics.width]);

  const estimatedResourceHeight = useMemo(() => {
    if (layoutMode === 'grid') {
      if (gridDensity === 'compact') return isMobile ? 340 : 320;
      return isMobile ? 360 : 390;
    }
    if (layoutMode === 'gallery') return isMobile ? 420 : 470;
    return isMobile ? 320 : 360;
  }, [gridDensity, isMobile, layoutMode]);

  const totalRows = useMemo(
    () => Math.ceil(filteredResources.length / layoutColumnCount),
    [filteredResources.length, layoutColumnCount],
  );

  const overscanRows = isMobile ? 2 : 3;

  const visibleRange = useMemo(() => {
    if (!filteredResources.length) {
      return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
    }

    if (!listMetrics.viewportHeight || !estimatedResourceHeight) {
      const fallbackCount = Math.min(filteredResources.length, 24);
      const rowsShown = Math.ceil(fallbackCount / layoutColumnCount);
      return {
        startIndex: 0,
        endIndex: fallbackCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: Math.max(0, (totalRows - rowsShown) * estimatedResourceHeight),
      };
    }

    const relativeTop = Math.max(0, listMetrics.scrollY - listMetrics.top);
    const relativeBottom = relativeTop + listMetrics.viewportHeight;
    const startRow = Math.max(0, Math.floor(relativeTop / estimatedResourceHeight) - overscanRows);
    const endRow = Math.min(totalRows, Math.ceil(relativeBottom / estimatedResourceHeight) + overscanRows);

    return {
      startIndex: startRow * layoutColumnCount,
      endIndex: Math.min(filteredResources.length, endRow * layoutColumnCount),
      topSpacerHeight: startRow * estimatedResourceHeight,
      bottomSpacerHeight: Math.max(0, (totalRows - endRow) * estimatedResourceHeight),
    };
  }, [
    estimatedResourceHeight,
    filteredResources.length,
    layoutColumnCount,
    listMetrics.scrollY,
    listMetrics.top,
    listMetrics.viewportHeight,
    overscanRows,
    totalRows,
  ]);

  const renderedResources = useMemo(
    () => filteredResources.slice(visibleRange.startIndex, visibleRange.endIndex),
    [filteredResources, visibleRange.endIndex, visibleRange.startIndex],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const updateMetrics = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = window.requestAnimationFrame(() => {
        const node = listRef.current;
        const rect = node?.getBoundingClientRect();
        setListMetrics({
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

    const resizeObserver = typeof ResizeObserver === 'function' && listRef.current
      ? new ResizeObserver(() => updateMetrics())
      : null;

    if (resizeObserver && listRef.current) {
      resizeObserver.observe(listRef.current);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      window.removeEventListener('scroll', updateMetrics);
      window.removeEventListener('resize', updateMetrics);
      resizeObserver?.disconnect();
    };
  }, [filteredResources.length, layoutMode]);

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
      if (isInstagram) {
        return retryInstagramDownloadForResource(targetResource.id);
      }
      return retryResourceCapture(targetResource.id);
    },
    onSuccess: (_, targetResource) => {
      invalidateResourceQueries();
      queryClient.invalidateQueries({ queryKey: ['instagram-downloader-status'] });
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

  const filteredReenrichMutation = useMutation({
    mutationFn: async () => runReenrichInBatches({
      resourceIds: filteredResources.map((resource) => resource.id),
      toastId: 'resource-reenrich-filtered',
      scope: 'filtered',
      scopeLabel: `${filteredResources.length} filtered resource${filteredResources.length === 1 ? '' : 's'}`,
    }),
    onSuccess: (result) => {
      const updated = Number(result?.updated || 0);
      const skipped = Number(result?.skipped || 0);
      const failed = Number(result?.failed || 0);
      toast.success(
        `Filtered re-enrichment finished: ${updated} updated${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}.`,
        {
          id: 'resource-reenrich-filtered',
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
      toast.error(error?.message || 'Failed to re-enrich filtered resources.', {
        id: 'resource-reenrich-filtered',
      });
    },
  });

  const deleteDirectMutation = useMutation({
    mutationFn: async (resourceId) => {
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
    onSuccess: () => {
      invalidateResourceQueries();
      toast.success('Resource deleted.');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to delete resource.');
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

  if (resourcesLoading || projectsLoading || areasLoading || projectResourcesLoading) {
    return <PageLoader label="Loading resources..." />;
  }

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

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{filteredResources.length} resource{filteredResources.length !== 1 ? 's' : ''}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {downloaderStatus?.worker?.online === false && (
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
          {layoutMode === 'grid' && (
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
          )}
          {filteredResources.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => filteredReenrichMutation.mutate()}
              disabled={filteredReenrichMutation.isPending}
              className="border-border text-xs"
            >
              {filteredReenrichMutation.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                : <Sparkles className="w-3.5 h-3.5 mr-1" />}
              {filteredReenrichMutation.isPending ? buildReenrichLabel('filtered') : 'Re-enrich filtered'}
            </Button>
          )}
        </div>
      </div>

      <div
        ref={listRef}
        style={{
          paddingTop: visibleRange.topSpacerHeight,
          paddingBottom: visibleRange.bottomSpacerHeight,
        }}
        className={cn(
          layoutMode === 'grid'
            ? cn(
              'grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
              gridDensity === 'compact'
                ? 'gap-3 2xl:grid-cols-5'
                : 'gap-4',
            )
            : layoutMode === 'gallery'
              ? 'columns-1 gap-5 sm:columns-2 lg:columns-3 xl:columns-4'
              : 'columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4',
        )}
      >
        {renderedResources.map(r => (
          <div
            key={r.id}
            className={cn(layoutMode !== 'grid' && 'mb-5 w-full break-inside-avoid')}
          >
            <ResourceCard
              resource={r}
              onClick={handleCardClick}
              onArchiveToggle={handleArchiveToggle}
              onDelete={(id) => deleteDirectMutation.mutate(id)}
              onRetry={(resource) => retryResourceMutation.mutate(resource)}
              onTagClick={handleTagClick}
              areas={areas}
              selectMode={selectMode}
              selected={selectedIds.has(r.id)}
              layoutMode={layoutMode}
              gridDensity={gridDensity}
              archiveLoading={archiveToggleMutation.isPending && archiveToggleMutation.variables?.resourceId === r.id}
              retryLoading={retryResourceMutation.isPending && retryResourceMutation.variables?.id === r.id}
            />
          </div>
        ))}
      </div>

      {filteredResources.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 p-12 text-center">
          <BookOpen className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No resources found. Add your first one!</p>
        </div>
      )}

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

      {selectMode && selectedIds.size > 0 && (
        <BulkResourceActionBar
          selectedIds={selectedIds}
          selectedResources={selectedResources}
          filteredCount={filteredResources.length}
          areas={areas}
          isWorking={bulkUpdateMutation.isPending || bulkDeleteMutation.isPending || bulkReenrichMutation.isPending || filteredReenrichMutation.isPending}
          isReenrichingSelected={bulkReenrichMutation.isPending}
          isReenrichingFiltered={filteredReenrichMutation.isPending}
          reenrichSelectedLabel={buildReenrichLabel('selected')}
          reenrichFilteredLabel={buildReenrichLabel('filtered')}
          onArchive={() => bulkUpdateMutation.mutate(() => ({ is_archived: true }))}
          onUnarchive={() => bulkUpdateMutation.mutate(() => ({ is_archived: false }))}
          onReenrich={() => bulkReenrichMutation.mutate()}
          onReenrichFiltered={() => filteredReenrichMutation.mutate()}
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
