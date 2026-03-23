import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DragDropContext } from '@hello-pangea/dnd';
import {
  Archive,
  CalendarDays,
  Columns3,
  GanttChartSquare,
  Library,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageActionRow, PageHeader } from '@/components/layout/page-header';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  createBoardCard,
  createBoardList,
  createBoardWorkspace,
  deleteBoardCard,
  deleteBoardWorkspace,
  listBoardCards,
  listBoardLists,
  listBoardWorkspaces,
  reorderBoardCards,
  updateBoardCard,
  updateBoardWorkspace,
} from '@/lib/projects-api';
import KanbanColumn from '@/components/projects/KanbanColumn';
import TaskDetailModal from '@/components/projects/TaskDetailModal';
import GanttChart from '@/components/projects/GanttChart';
import { PageLoader } from '@/components/ui/page-loader';

function normalizeListName(value) {
  return String(value || '').trim().toLowerCase();
}

function isArchivedList(list) {
  return normalizeListName(list?.name) === 'archived';
}

function isDoneList(list) {
  const name = normalizeListName(list?.name);
  return name === 'done' || name === 'completed';
}

function inferStatusFromListId(listId, orderedLists) {
  const list = orderedLists.find((entry) => entry.id === listId);
  if (!list) return 'todo';
  if (isArchivedList(list)) return 'archived';
  if (isDoneList(list)) return 'done';

  const index = orderedLists.findIndex((entry) => entry.id === listId);
  if (index <= 0) return 'todo';
  return 'doing';
}

export default function Projects() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [viewMode, setViewMode] = useState('kanban');
  const [activeWorkspaceId, setActiveWorkspaceId] = useState('');
  const [showCreateWorkspaceDialog, setShowCreateWorkspaceDialog] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [createWorkspaceError, setCreateWorkspaceError] = useState('');
  const [showRenameWorkspaceDialog, setShowRenameWorkspaceDialog] = useState(false);
  const [renameWorkspaceName, setRenameWorkspaceName] = useState('');
  const [showDestructiveWorkspaceDialog, setShowDestructiveWorkspaceDialog] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [showCreateListDialog, setShowCreateListDialog] = useState(false);
  const [newListName, setNewListName] = useState('');
  
  // Mobile list view rendering state
  const [mobileListLimits, setMobileListLimits] = useState({});

  const { data: workspaces = [], isLoading: workspacesLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: listBoardWorkspaces,
    initialData: [],
  });

  const visibleWorkspaces = useMemo(
    () => workspaces.filter((workspace) => !workspace.is_archived),
    [workspaces],
  );

  const selectedWorkspaceId = activeWorkspaceId || visibleWorkspaces[0]?.id || '';

  const { data: workspaceLists = [], isLoading: listsLoading } = useQuery({
    queryKey: ['workspace-lists', selectedWorkspaceId],
    queryFn: () => listBoardLists(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId),
    initialData: [],
  });

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['cards', selectedWorkspaceId],
    queryFn: () => listBoardCards(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId),
    initialData: [],
  });

  useEffect(() => {
    if (!visibleWorkspaces.length) {
      if (activeWorkspaceId) setActiveWorkspaceId('');
      return;
    }

    const selectedExists = visibleWorkspaces.some((workspace) => workspace.id === selectedWorkspaceId);
    if (!selectedExists) {
      setActiveWorkspaceId(visibleWorkspaces[0].id);
    }
  }, [activeWorkspaceId, selectedWorkspaceId, visibleWorkspaces]);

  const orderedLists = useMemo(
    () => [...workspaceLists]
      .filter((list) => !list.is_archived)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [workspaceLists],
  );

  const cardsByListId = useMemo(() => {
    const grouped = Object.fromEntries(orderedLists.map((list) => [list.id, []]));
    for (const card of cards) {
      if (!card?.list_id) continue;
      if (!grouped[card.list_id]) grouped[card.list_id] = [];
      grouped[card.list_id].push(card);
    }

    for (const listId of Object.keys(grouped)) {
      grouped[listId].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }

    return grouped;
  }, [cards, orderedLists]);

  const saveCardMutation = useMutation({
    mutationFn: async (form) => {
      const resolvedListId = form.list_id || editingCard?.list_id || orderedLists[0]?.id || '';
      if (!resolvedListId) {
        throw new Error('Create a list in this workspace before adding cards.');
      }

      const payload = {
        ...form,
        workspace_id: selectedWorkspaceId,
        list_id: resolvedListId,
        status: form.status || inferStatusFromListId(resolvedListId, orderedLists),
        start_date: editingCard?.id ? form.start_date || '' : (form.start_date || new Date().toISOString().slice(0, 10)),
      };

      if (editingCard?.id) {
        return updateBoardCard(editingCard.id, payload);
      }

      return createBoardCard(payload);
    },
    onSuccess: (card) => {
      queryClient.invalidateQueries({ queryKey: ['cards', selectedWorkspaceId] });
      if (editingCard?.id) {
        setEditingCard(card);
      } else {
        setShowTaskModal(false);
        setEditingCard(null);
      }
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to save card.');
    },
  });

  const deleteCardMutation = useMutation({
    mutationFn: (cardId) => deleteBoardCard(cardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards', selectedWorkspaceId] });
      setShowTaskModal(false);
      setEditingCard(null);
      toast.success('Card deleted.');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to delete card.');
    },
  });

  const reorderCardsMutation = useMutation({
    mutationFn: (updates) => reorderBoardCards(updates),
    onMutate: async (updates) => {
      await queryClient.cancelQueries({ queryKey: ['cards', selectedWorkspaceId] });
      const previousCards = queryClient.getQueryData(['cards', selectedWorkspaceId]) || [];
      const updatesById = new Map(updates.map((entry) => [entry.id, entry]));

      queryClient.setQueryData(
        ['cards', selectedWorkspaceId],
        previousCards.map((card) => {
          const update = updatesById.get(card.id);
          if (!update) return card;
          return {
            ...card,
            list_id: update.list_id,
            position: update.position,
            status: update.status,
          };
        }),
      );

      return { previousCards };
    },
    onError: (_error, _updates, context) => {
      queryClient.setQueryData(['cards', selectedWorkspaceId], context?.previousCards || []);
      toast.error('Failed to move card. Restoring the previous order.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['cards', selectedWorkspaceId] });
    },
  });

  const quickSetDateMutation = useMutation({
    mutationFn: ({ cardId, field }) => updateBoardCard(cardId, {
      [field]: new Date().toISOString().slice(0, 10),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cards', selectedWorkspaceId] }),
  });

  const createWorkspaceMutation = useMutation({
    mutationFn: (name) => createBoardWorkspace({
      name,
      position: workspaces.length * 10,
    }),
    onSuccess: (workspace) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-lists', workspace.id] });
      setActiveWorkspaceId(workspace.id);
      setShowCreateWorkspaceDialog(false);
      setNewWorkspaceName('');
      setCreateWorkspaceError('');
      toast.success('Workspace created.');
    },
    onError: (error) => {
      setCreateWorkspaceError(error?.message || 'Failed to create workspace.');
    },
  });

  const renameWorkspaceMutation = useMutation({
    mutationFn: ({ workspaceId, name }) => updateBoardWorkspace(workspaceId, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setShowRenameWorkspaceDialog(false);
      setRenameWorkspaceName('');
      toast.success('Workspace renamed.');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to rename workspace.');
    },
  });

  const archiveOrDeleteWorkspaceMutation = useMutation({
    mutationFn: ({ workspaceId, mode }) => (
      mode === 'archive'
        ? updateBoardWorkspace(workspaceId, { is_archived: true })
        : deleteBoardWorkspace(workspaceId)
    ),
    onSuccess: (_result, { mode, workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-lists', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['cards', workspaceId] });
      setShowDestructiveWorkspaceDialog(false);
      setDeleteConfirmName('');
      if (selectedWorkspaceId === workspaceId) {
        setActiveWorkspaceId('');
      }
      toast.success(mode === 'archive' ? 'Workspace archived.' : 'Workspace deleted.');
    },
    onError: (error) => {
      toast.error(error?.message || 'Workspace update failed.');
    },
  });

  const createListMutation = useMutation({
    mutationFn: (name) => createBoardList({
      workspace_id: selectedWorkspaceId,
      name,
      position: ((orderedLists.at(-1)?.position ?? -10) + 10),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-lists', selectedWorkspaceId] });
      setShowCreateListDialog(false);
      setNewListName('');
      toast.success('List created.');
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to create list.');
    },
  });

  const selectedWorkspace = visibleWorkspaces.find((workspace) => workspace.id === selectedWorkspaceId) || null;
  const effectiveViewMode = isMobile ? 'mobile-board' : viewMode;
  const isBoardLoading = workspacesLoading || listsLoading || cardsLoading;

  const applyPositionUpdates = (updatedCards) => {
    const nextPositionByList = {};
    const payload = updatedCards.map((card) => {
      const nextPosition = nextPositionByList[card.list_id] ?? 0;
      nextPositionByList[card.list_id] = nextPosition + 10;
      return {
        id: card.id,
        list_id: card.list_id,
        position: nextPosition,
        status: inferStatusFromListId(card.list_id, orderedLists),
      };
    });

    reorderCardsMutation.mutate(payload);
  };

  const handleDragEnd = ({ destination, source, draggableId }) => {
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;

    const sourceCards = [...(cardsByListId[source.droppableId] || [])];
    const movingIndex = sourceCards.findIndex((card) => card.id === draggableId);
    if (movingIndex === -1) return;

    const [movedCard] = sourceCards.splice(movingIndex, 1);

    if (source.droppableId === destination.droppableId) {
      sourceCards.splice(destination.index, 0, movedCard);
      applyPositionUpdates(
        sourceCards.map((card, index) => ({ ...card, list_id: source.droppableId, position: index * 10 })),
      );
      return;
    }

    const destinationCards = [...(cardsByListId[destination.droppableId] || [])];
    destinationCards.splice(destination.index, 0, { ...movedCard, list_id: destination.droppableId });

    applyPositionUpdates([
      ...sourceCards.map((card, index) => ({ ...card, list_id: source.droppableId, position: index * 10 })),
      ...destinationCards.map((card, index) => ({ ...card, list_id: destination.droppableId, position: index * 10 })),
    ]);
  };

  const handleAddCard = (listId) => {
    setEditingCard({
      workspace_id: selectedWorkspaceId,
      list_id: listId,
      priority: 'medium',
    });
    setShowTaskModal(true);
  };

  const handleCreateWorkspace = () => {
    const trimmed = newWorkspaceName.trim();
    if (!trimmed) {
      setCreateWorkspaceError('Workspace name is required.');
      return;
    }

    setCreateWorkspaceError('');
    createWorkspaceMutation.mutate(trimmed);
  };

  const handleCreateList = () => {
    const trimmed = newListName.trim();
    if (!trimmed) {
      toast.error('List name is required.');
      return;
    }

    createListMutation.mutate(trimmed);
  };

  if (workspacesLoading || listsLoading || cardsLoading) {
    return <PageLoader label="Loading workspace..." />;
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Projects"
        icon={ListTodo}
        description={isMobile ? 'Focused board view for quick triage and card editing.' : 'Supabase-backed workspace board for your core planning loop.'}
        actions={(
          <PageActionRow>
            {!isMobile && (
              <div className="flex gap-0.5 rounded-lg bg-secondary/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode('kanban')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    viewMode === 'kanban' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Columns3 className="h-3.5 w-3.5" /> Board
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('gantt')}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    viewMode === 'gantt' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <GanttChartSquare className="h-3.5 w-3.5" /> Gantt
                </button>
              </div>
            )}

            <Link to={createPageUrl('Resources')} className="w-full sm:w-auto">
              <Button variant="outline" size="sm" className="w-full border-border text-sm hover:bg-secondary sm:w-auto">
                <Library className="mr-2 h-4 w-4" /> Resources
              </Button>
            </Link>
          </PageActionRow>
        )}
      />

      <div className="mb-4 rounded-2xl border border-border/50 bg-card/60 px-4 py-3 text-sm text-muted-foreground">
        Phase 2 is now running locally on your own backend for workspaces, lists, cards, comments, reminders, attachments, and AI card helpers.
        Drive folder orchestration stays intentionally deferred to phase 3 so the core board stays stable while we finish the cutover.
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="w-full sm:max-w-xs">
          <Select value={selectedWorkspaceId || 'none'} onValueChange={(value) => setActiveWorkspaceId(value === 'none' ? '' : value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select workspace" />
            </SelectTrigger>
            <SelectContent>
              {visibleWorkspaces.length === 0 && <SelectItem value="none">No workspaces found</SelectItem>}
              {visibleWorkspaces.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>{workspace.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateWorkspaceDialog(true)}
          className="w-full border-border text-sm hover:bg-secondary sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" /> Create Workspace
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCreateListDialog(true)}
          disabled={!selectedWorkspaceId}
          className="w-full border-border text-sm hover:bg-secondary sm:w-auto"
        >
          <Plus className="mr-2 h-4 w-4" /> Create List
        </Button>

        {!isMobile && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRenameWorkspaceName(selectedWorkspace?.name || '');
                setShowRenameWorkspaceDialog(true);
              }}
              disabled={!selectedWorkspaceId}
              className="border-border text-sm hover:bg-secondary"
            >
              <Pencil className="mr-2 h-4 w-4" /> Rename Workspace
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDestructiveWorkspaceDialog(true)}
              disabled={!selectedWorkspaceId}
              className="border-border text-sm hover:bg-secondary"
            >
              <Archive className="mr-2 h-4 w-4" /> Archive/Delete
            </Button>
          </>
        )}
      </div>

      {!selectedWorkspaceId && !workspacesLoading && (
        <div className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          No workspace selected yet. Create a workspace to start organizing cards.
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {effectiveViewMode === 'gantt' ? (
          <GanttChart
            cards={cards}
            projects={visibleWorkspaces}
            lists={orderedLists}
            workspaces={visibleWorkspaces}
            activeWorkspaceId={selectedWorkspaceId}
            onEditCard={(card) => {
              setEditingCard(card);
              setShowTaskModal(true);
            }}
            onQuickSetDate={(card, field) => quickSetDateMutation.mutate({ cardId: card.id, field })}
          />
        ) : effectiveViewMode === 'mobile-board' ? (
          <div className="space-y-4 pb-4">
            {orderedLists.map((list) => {
              const allListCards = cardsByListId[list.id] || [];
              const visibleLimit = mobileListLimits[list.id] || 15;
              const listCards = allListCards.slice(0, visibleLimit);
              const hasMore = visibleLimit < allListCards.length;

              return (
                <section key={list.id} className="rounded-2xl border border-border/50 bg-card/60 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold">{list.name}</h2>
                      <p className="text-xs text-muted-foreground">{listCards.length} card{listCards.length !== 1 ? 's' : ''}</p>
                    </div>
                    <Button size="sm" variant="outline" className="border-border px-3 text-xs" onClick={() => handleAddCard(list.id)}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
                    </Button>
                  </div>

                  {listCards.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/50 px-3 py-5 text-center text-xs text-muted-foreground">
                      No cards in this list yet.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {listCards.map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => {
                            setEditingCard(card);
                            setShowTaskModal(true);
                          }}
                          className="w-full rounded-xl border border-border/50 bg-secondary/20 px-3 py-3 text-left transition-colors hover:bg-secondary/35"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium leading-snug">{card.title}</p>
                              {card.description && (
                                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                  {card.description}
                                </p>
                              )}
                            </div>
                            <span
                              className={cn(
                                'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
                                card.priority === 'high'
                                  ? 'border-red-500/30 bg-red-500/10 text-red-400'
                                  : card.priority === 'low'
                                    ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                              )}
                            >
                              {card.priority || 'medium'}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            {card.start_date && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-1">
                                <CalendarDays className="h-3 w-3" /> {card.start_date}
                              </span>
                            )}
                            {card.due_date && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-background/60 px-2 py-1">
                                <CalendarDays className="h-3 w-3" /> Due {card.due_date}
                              </span>
                            )}
                            {!!card.checklist?.length && (
                              <span className="rounded-full bg-background/60 px-2 py-1">
                                {card.checklist.filter((item) => item.done).length}/{card.checklist.length} checklist
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                      
                      {hasMore && (
                        <Button
                          variant="ghost"
                          className="w-full text-xs text-muted-foreground mt-2"
                          onClick={() => setMobileListLimits(prev => ({ ...prev, [list.id]: visibleLimit + 15 }))}
                        >
                          Load more cards ({allListCards.length - visibleLimit} remaining)
                        </Button>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <DragDropContext onDragEnd={handleDragEnd}>
            <div className="flex items-start gap-4 overflow-x-auto pb-4">
              {orderedLists.map((list) => (
                <KanbanColumn
                  key={list.id}
                  list={list}
                  cards={cardsByListId[list.id] || []}
                  projects={visibleWorkspaces}
                  onAddCard={handleAddCard}
                  onEditCard={(card) => {
                    setEditingCard(card);
                    setShowTaskModal(true);
                  }}
                />
              ))}
              {orderedLists.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground">No lists found for this workspace yet.</div>
              )}
            </div>
          </DragDropContext>
        )}
      </div>

      <TaskDetailModal
        open={showTaskModal}
        onClose={() => {
          setShowTaskModal(false);
          setEditingCard(null);
        }}
        task={editingCard}
        projects={visibleWorkspaces}
        allTasks={cards}
        onSave={(form) => saveCardMutation.mutate(form)}
        onDelete={(cardId) => deleteCardMutation.mutate(cardId)}
      />

      <ResponsiveModal
        open={showCreateWorkspaceDialog}
        onOpenChange={(open) => {
          setShowCreateWorkspaceDialog(open);
          if (!open) {
            setNewWorkspaceName('');
            setCreateWorkspaceError('');
          }
        }}
      >
        <ResponsiveModalContent className="max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Create Workspace</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Create a new workspace with default lists: To Do, In Progress, and Done.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <div className="space-y-2">
            <Input
              value={newWorkspaceName}
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreateWorkspace();
              }}
              placeholder="Workspace name"
              disabled={createWorkspaceMutation.isPending}
            />
            {createWorkspaceError && <p className="text-xs text-red-400">{createWorkspaceError}</p>}
          </div>
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setShowCreateWorkspaceDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateWorkspace} disabled={createWorkspaceMutation.isPending}>
              {createWorkspaceMutation.isPending ? 'Creating...' : 'Create Workspace'}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <ResponsiveModal
        open={showCreateListDialog}
        onOpenChange={(open) => {
          setShowCreateListDialog(open);
          if (!open) setNewListName('');
        }}
      >
        <ResponsiveModalContent className="max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Create List</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Add a new list to the selected workspace.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <div className="space-y-2">
            <Input
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleCreateList();
              }}
              placeholder="List name"
              disabled={createListMutation.isPending}
            />
          </div>
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setShowCreateListDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateList} disabled={createListMutation.isPending || !selectedWorkspaceId}>
              {createListMutation.isPending ? 'Creating...' : 'Create List'}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <ResponsiveModal
        open={showRenameWorkspaceDialog}
        onOpenChange={(open) => {
          setShowRenameWorkspaceDialog(open);
          if (!open) setRenameWorkspaceName('');
        }}
      >
        <ResponsiveModalContent className="max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Rename Workspace</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Update the workspace name without changing its cards or lists.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <Input
            value={renameWorkspaceName}
            onChange={(event) => setRenameWorkspaceName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && selectedWorkspaceId && renameWorkspaceName.trim()) {
                renameWorkspaceMutation.mutate({
                  workspaceId: selectedWorkspaceId,
                  name: renameWorkspaceName.trim(),
                });
              }
            }}
            placeholder="Workspace name"
            disabled={renameWorkspaceMutation.isPending}
          />
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setShowRenameWorkspaceDialog(false)}>Cancel</Button>
            <Button
              onClick={() => renameWorkspaceMutation.mutate({
                workspaceId: selectedWorkspaceId,
                name: renameWorkspaceName.trim(),
              })}
              disabled={!selectedWorkspaceId || !renameWorkspaceName.trim() || renameWorkspaceMutation.isPending}
            >
              {renameWorkspaceMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <ResponsiveModal
        open={showDestructiveWorkspaceDialog}
        onOpenChange={(open) => {
          setShowDestructiveWorkspaceDialog(open);
          if (!open) setDeleteConfirmName('');
        }}
      >
        <ResponsiveModalContent className="max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Archive Or Delete Workspace</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Archive is reversible and hides the workspace from the main board. Delete is permanent and removes lists, cards, and related records.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-border/50 bg-secondary/20 p-3 text-sm text-muted-foreground">
              Selected workspace: <span className="font-medium text-foreground">{selectedWorkspace?.name || 'None'}</span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                className="flex-1 border-border"
                disabled={!selectedWorkspaceId || archiveOrDeleteWorkspaceMutation.isPending}
                onClick={() => archiveOrDeleteWorkspaceMutation.mutate({
                  workspaceId: selectedWorkspaceId,
                  mode: 'archive',
                })}
              >
                <RefreshCw className="mr-2 h-4 w-4" /> Archive Workspace
              </Button>
            </div>

            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm">
              <p className="mb-2 text-red-200">
                Type <span className="font-semibold">{selectedWorkspace?.name || 'the workspace name'}</span> to confirm permanent deletion.
              </p>
              <Input
                value={deleteConfirmName}
                onChange={(event) => setDeleteConfirmName(event.target.value)}
                placeholder={selectedWorkspace?.name || 'Workspace name'}
                disabled={archiveOrDeleteWorkspaceMutation.isPending}
              />
            </div>
          </div>

          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setShowDestructiveWorkspaceDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => archiveOrDeleteWorkspaceMutation.mutate({
                workspaceId: selectedWorkspaceId,
                mode: 'delete',
              })}
              disabled={
                !selectedWorkspaceId
                || deleteConfirmName.trim() !== (selectedWorkspace?.name || '')
                || archiveOrDeleteWorkspaceMutation.isPending
              }
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {archiveOrDeleteWorkspaceMutation.isPending ? 'Deleting...' : 'Delete Workspace'}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  );
}
