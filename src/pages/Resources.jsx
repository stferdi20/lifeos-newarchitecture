import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Search, FileText, Sparkles, CheckSquare } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listBoardWorkspaces } from '@/lib/projects-api';
import { CardResource, LifeArea, ProjectResource, Resource } from '@/lib/resources-api';
import ResourceFilters from '../components/resources/ResourceFilters';
import ResourceCard from '../components/resources/ResourceCard';
import ResourceDetailModal from '../components/resources/ResourceDetailModal';
import AddResourceModal from '../components/resources/AddResourceModal';
import ManualNoteModal from '../components/resources/ManualNoteModal';
import BulkAddModal from '../components/resources/BulkAddModal';
import BulkResourceActionBar from '../components/resources/BulkResourceActionBar';
import { PageHeader, PageActionRow } from '@/components/layout/page-header';

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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

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

  const { data: resources = [] } = useQuery({
    queryKey: ['resources'],
    queryFn: () => Resource.list('-created_date', 200),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => listBoardWorkspaces(),
  });

  const { data: areas = [] } = useQuery({
    queryKey: ['lifeAreas'],
    queryFn: () => LifeArea.list(),
  });

  const { data: projectResources = [] } = useQuery({
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
    resources.forEach(r => (r.tags || []).forEach(t => tagSet.add(t)));
    return [...tagSet].sort();
  }, [resources]);

  const filteredResources = useMemo(() => {
    const term = search.toLowerCase().trim();
    return resources.filter(r => {
      if (typeFilter !== 'all' && r.resource_type !== typeFilter) return false;
      if (areaFilter !== 'all' && r.area_id !== areaFilter) return false;
      if (archivedFilter === 'active' && r.is_archived) return false;
      if (archivedFilter === 'archived' && !r.is_archived) return false;
      if (projectResourceIds && !projectResourceIds.has(r.id)) return false;
      if (tagFilter && !(r.tags || []).includes(tagFilter)) return false;
      if (term) {
        const searchable = [
          r.title,
          r.summary,
          r.why_it_matters,
          r.who_its_for,
          r.content,
          r.main_topic,
          r.author,
          ...(r.tags || []),
          ...(r.key_points || []),
          ...(r.actionable_points || []),
          ...(r.use_cases || []),
          ...(r.learning_outcomes || []),
          ...(r.notable_quotes_or_moments || []),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!searchable.includes(term)) return false;
      }
      return true;
    });
  }, [resources, search, typeFilter, areaFilter, archivedFilter, projectResourceIds, tagFilter]);

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

  return (
    <div className="space-y-6 overflow-x-hidden">
      <PageHeader
        icon={BookOpen}
        title={projectName ? `Resources · ${projectName}` : 'Resources'}
        description="AI-powered knowledge capture & organization."
        actions={(
          <PageActionRow>
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="border-border bg-secondary/40 pl-9" />
            </div>
            <Button variant="outline" onClick={() => setShowManualNote(true)} className="w-full border-border gap-1.5 sm:w-auto">
              <FileText className="w-4 h-4" /> Note
            </Button>
            <Button variant="outline" onClick={() => setShowBulkAdd(true)} className="w-full border-border gap-1.5 sm:w-auto">
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
              className="w-full border-border gap-1.5 sm:w-auto"
            >
              <CheckSquare className="w-4 h-4" /> {selectMode ? 'Cancel' : 'Select'}
            </Button>
            <Button onClick={() => setShowAddUrl(true)} className="w-full gap-1.5 sm:w-auto">
              <Sparkles className="w-4 h-4" /> Add URL
            </Button>
          </PageActionRow>
        )}
      />

      <ResourceFilters
        typeFilter={typeFilter} setTypeFilter={setTypeFilter}
        areaFilter={areaFilter} setAreaFilter={setAreaFilter}
        archivedFilter={archivedFilter} setArchivedFilter={setArchivedFilter}
        projectFilter={projectFilter} setProjectFilter={setProjectFilter}
        tagFilter={tagFilter} setTagFilter={setTagFilter}
        projects={projects} allTags={allTags} areas={areas}
      />

      <p className="text-xs text-muted-foreground">{filteredResources.length} resource{filteredResources.length !== 1 ? 's' : ''}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredResources.map(r => (
          <ResourceCard
            key={r.id}
            resource={r}
            onClick={handleCardClick}
            onArchiveToggle={handleArchiveToggle}
            onTagClick={handleTagClick}
            areas={areas}
            selectMode={selectMode}
            selected={selectedIds.has(r.id)}
            archiveLoading={archiveToggleMutation.isPending && archiveToggleMutation.variables?.resourceId === r.id}
          />
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
          areas={areas}
          isWorking={bulkUpdateMutation.isPending || bulkDeleteMutation.isPending}
          onArchive={() => bulkUpdateMutation.mutate(() => ({ is_archived: true }))}
          onUnarchive={() => bulkUpdateMutation.mutate(() => ({ is_archived: false }))}
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
    </div>
  );
}
