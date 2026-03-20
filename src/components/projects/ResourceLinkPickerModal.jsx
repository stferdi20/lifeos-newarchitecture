import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { isNormalizedResourceUrl, normalizeResourceUrl } from '@/lib/resource-url';
import {
  Check,
  FileText,
  Globe,
  GraduationCap,
  Lightbulb,
  Link2,
  Loader2,
  MessageSquare,
  Newspaper,
  Plus,
  Search,
  Sparkles,
  Youtube,
  Github,
  FileDown,
  Clapperboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { generateStructuredAi } from '@/lib/ai-api';
import { CardResource, ProjectResource, Resource, analyzeResourceUrl } from '@/lib/resources-api';
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal';

const TYPE_META = {
  youtube: { label: 'YouTube', icon: Youtube, color: 'text-red-400 bg-red-500/10' },
  reddit: { label: 'Reddit', icon: MessageSquare, color: 'text-orange-400 bg-orange-500/10' },
  article: { label: 'Article', icon: Newspaper, color: 'text-sky-400 bg-sky-500/10' },
  website: { label: 'Website', icon: Globe, color: 'text-cyan-400 bg-cyan-500/10' },
  research_paper: { label: 'Paper', icon: GraduationCap, color: 'text-violet-400 bg-violet-500/10' },
  pdf: { label: 'PDF', icon: FileDown, color: 'text-amber-400 bg-amber-500/10' },
  note: { label: 'Note', icon: FileText, color: 'text-emerald-400 bg-emerald-500/10' },
  github_repo: { label: 'GitHub', icon: Github, color: 'text-slate-100 bg-white/10' },
  instagram_reel: { label: 'IG Reel', icon: Clapperboard, color: 'text-pink-300 bg-pink-500/10' },
  instagram_carousel: { label: 'IG Carousel', icon: Clapperboard, color: 'text-fuchsia-300 bg-fuchsia-500/10' },
};

const TAB_CONFIG = {
  browse: { label: 'Browse', icon: Search },
  suggest: { label: 'Suggest', icon: Sparkles },
  create: { label: 'Create', icon: Plus },
};

const CREATE_MODE_CONFIG = {
  url: { label: 'URL', icon: Link2 },
  note: { label: 'Note', icon: FileText },
};

function getCardIdentifier(card) {
  return card?.id || '';
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function scoreResource(resource, contextText, tagHints, projectResourceIds) {
  const haystack = [
    resource.title,
    resource.summary,
    resource.why_it_matters,
    resource.who_its_for,
    resource.content ? String(resource.content).slice(0, 4000) : '',
    resource.main_topic,
    resource.author,
    ...(resource.tags || []),
    ...(resource.key_points || []),
    ...(resource.actionable_points || []),
    ...(resource.use_cases || []),
    ...(resource.learning_outcomes || []),
    ...(resource.notable_quotes_or_moments || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  let score = 0;
  for (const token of contextText) {
    if (!token) continue;
    if (haystack.includes(token)) score += token.length > 4 ? 4 : 2;
    if ((resource.tags || []).some((tag) => String(tag).toLowerCase() === token)) score += 4;
    if (String(resource.main_topic || '').toLowerCase() === token) score += 4;
  }

  for (const hint of tagHints) {
    if (haystack.includes(hint)) score += 2;
  }

  if (projectResourceIds.has(resource.id)) score += 6;
  if (resource.resource_score) score += Math.min(Number(resource.resource_score) || 0, 10) / 2;
  if (resource.likes) score += Math.min(Number(resource.likes) || 0, 6) / 3;
  if (!resource.is_archived) score += 1;
  return score;
}

async function rankSuggestionsWithAI(card, candidates) {
  const compactCandidates = candidates.slice(0, 12).map((resource) => ({
    id: resource.id,
    title: resource.title,
    type: resource.resource_type,
    summary: resource.summary || '',
    content_preview: resource.content ? String(resource.content).slice(0, 1200) : '',
    why_it_matters: resource.why_it_matters || '',
    who_its_for: resource.who_its_for || '',
    topic: resource.main_topic || '',
    tags: resource.tags || [],
    key_points: resource.key_points || [],
    actionable_points: resource.actionable_points || [],
    use_cases: resource.use_cases || [],
    learning_outcomes: resource.learning_outcomes || [],
  }));

  const prompt = [
      'You are recommending existing saved resources for a project card.',
      'Choose the most useful resources for the card. Prefer relevance over popularity.',
      'Only return resource ids from the provided candidate list.',
      'For each suggested resource, give one short reason grounded in the card and resource metadata.',
      `Card title: ${card?.title || 'Untitled card'}`,
      `Card description: ${card?.description || 'No description provided.'}`,
      `Candidate resources: ${JSON.stringify(compactCandidates)}`,
      'Return JSON with a "suggestions" array of { resource_id, reason } objects.',
    ].join('\n\n');

  const response = await generateStructuredAi({
    taskType: 'generic.structured',
    prompt,
    policy: { tier: 'cheap', maxTokens: 900, temperature: 0.2 },
    metadata: { requestSummary: `resource-link:${card?.id || 'card'}` },
  });

  return Array.isArray(response?.suggestions) ? response.suggestions : [];
}

export default function ResourceLinkPickerModal({
  open,
  onClose,
  card,
  linkedResourceIds = [],
  initialTab = 'browse',
  onLinked,
}) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [createMode, setCreateMode] = useState('url');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [urlInput, setUrlInput] = useState('');
  const [noteForm, setNoteForm] = useState({ title: '', content: '', tags: '' });
  const [submitLoading, setSubmitLoading] = useState(false);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionReasons, setSuggestionReasons] = useState({});
  const [suggestedIds, setSuggestedIds] = useState([]);

  useEffect(() => {
    if (!open) return;
    setActiveTab(initialTab);
    setSearch('');
    setSelectedIds([]);
    setUrlInput('');
    setNoteForm({ title: '', content: '', tags: '' });
    setSuggestionReasons({});
    setSuggestedIds([]);
  }, [open, initialTab]);

  const { data: resources = [] } = useQuery({
    queryKey: ['resources'],
    queryFn: () => Resource.list('-created_date', 250),
    enabled: open,
  });

  const { data: projectResources = [] } = useQuery({
    queryKey: ['projectResources'],
    queryFn: () => ProjectResource.list(),
    enabled: open,
  });

  const normalizedLinkedIds = useMemo(() => new Set(linkedResourceIds), [linkedResourceIds]);
  const projectId = card?.project_id || card?.workspace_id || '';
  const projectResourceIds = useMemo(() => {
    if (!projectId) return new Set();
    return new Set(
      (projectResources || [])
        .filter((link) => link.project_id === projectId)
        .map((link) => link.resource_id || link.note_id)
        .filter(Boolean)
    );
  }, [projectId, projectResources]);

  const availableResources = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (resources || [])
      .filter((resource) => !normalizedLinkedIds.has(resource.id))
      .filter((resource) => {
        if (!term) return true;
        const haystack = [
          resource.title,
          resource.summary,
          resource.why_it_matters,
          resource.who_its_for,
          resource.content ? String(resource.content).slice(0, 4000) : '',
          resource.main_topic,
          resource.author,
          ...(resource.tags || []),
          ...(resource.key_points || []),
          ...(resource.actionable_points || []),
          ...(resource.use_cases || []),
          ...(resource.learning_outcomes || []),
          ...(resource.notable_quotes_or_moments || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => {
        const aProject = projectResourceIds.has(a.id) ? 1 : 0;
        const bProject = projectResourceIds.has(b.id) ? 1 : 0;
        if (aProject !== bProject) return bProject - aProject;
        return new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime();
      });
  }, [resources, normalizedLinkedIds, search, projectResourceIds]);

  const suggestedResources = useMemo(() => {
    if (!suggestedIds.length) return [];
    const order = new Map(suggestedIds.map((id, index) => [id, index]));
    return (resources || [])
      .filter((resource) => suggestedIds.includes(resource.id))
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  }, [resources, suggestedIds]);

  const toggleSelection = (resourceId) => {
    setSelectedIds((current) => (
      current.includes(resourceId)
        ? current.filter((id) => id !== resourceId)
        : [...current, resourceId]
    ));
  };

  const invalidateResourceQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    queryClient.invalidateQueries({ queryKey: ['projectResources'] });
    queryClient.invalidateQueries({ queryKey: ['card-resource-links', getCardIdentifier(card)] });
  };

  const createCardResourceLink = async (resourceId) => {
    const cardId = getCardIdentifier(card);
    if (!cardId) throw new Error('Create the card first before linking resources.');
    return CardResource.create({
      card_id: cardId,
      resource_id: resourceId,
      created_at: new Date().toISOString(),
    });
  };

  const handleLinkSelected = async () => {
    if (!selectedIds.length) return;
    setSubmitLoading(true);
    try {
      await Promise.all(selectedIds.map((resourceId) => createCardResourceLink(resourceId)));
      invalidateResourceQueries();
      onLinked?.();
      toast.success(`${selectedIds.length} resource${selectedIds.length === 1 ? '' : 's'} linked to this card.`);
      onClose();
    } catch (error) {
      toast.error(error?.message || 'Failed to link resources.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleCreateFromUrl = async () => {
    const normalizedUrl = normalizeResourceUrl(urlInput);
    if (!normalizedUrl || !isNormalizedResourceUrl(normalizedUrl)) {
      toast.error('Please enter a valid URL.');
      return;
    }
    setSubmitLoading(true);
    try {
      const resource = await analyzeResourceUrl({ url: normalizedUrl, project_id: projectId || undefined });
      if (!resource?.id) throw new Error('Resource was created but no id was returned.');
      await createCardResourceLink(resource.id);
      invalidateResourceQueries();
      onLinked?.();
      toast.success('Resource analyzed, saved, and linked to this card.');
      onClose();
    } catch (error) {
      toast.error(error?.message || 'Failed to analyze and link this resource.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleCreateNote = async () => {
    const title = noteForm.title.trim();
    if (!title) return;
    setSubmitLoading(true);
    try {
      const created = await Resource.create({
        title,
        content: noteForm.content.trim(),
        tags: noteForm.tags.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean),
        resource_type: 'note',
        is_archived: false,
      });
      await createCardResourceLink(created.id);
      invalidateResourceQueries();
      onLinked?.();
      toast.success('Note created and linked to this card.');
      onClose();
    } catch (error) {
      toast.error(error?.message || 'Failed to create and link this note.');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleSuggest = async () => {
    const context = `${card?.title || ''} ${card?.description || ''}`.trim();
    if (context.length < 4) {
      toast.error('Add a card title or description first so suggestions have enough context.');
      return;
    }

    const tokens = tokenize(context);
    const tagHints = tokenize((card?.labels || []).map((label) => label?.text).filter(Boolean).join(' '));
    const candidatePool = (resources || [])
      .filter((resource) => !normalizedLinkedIds.has(resource.id))
      .map((resource) => ({
        resource,
        score: scoreResource(resource, tokens, tagHints, projectResourceIds),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map((item) => item.resource);

    if (!candidatePool.length) {
      toast.error('No strong candidate resources were found yet.');
      return;
    }

    setSuggestionLoading(true);
    try {
      let suggestions = [];
      try {
        suggestions = await rankSuggestionsWithAI(card, candidatePool);
      } catch {
        suggestions = [];
      }

      if (suggestions.length) {
        const deduped = suggestions
          .filter((item) => item?.resource_id && candidatePool.some((resource) => resource.id === item.resource_id))
          .slice(0, 6);
        setSuggestedIds(deduped.map((item) => item.resource_id));
        setSuggestionReasons(
          deduped.reduce((acc, item) => {
            acc[item.resource_id] = item.reason;
            return acc;
          }, {})
        );
      } else {
        const fallback = candidatePool.slice(0, 6);
        setSuggestedIds(fallback.map((resource) => resource.id));
        setSuggestionReasons(
          fallback.reduce((acc, resource) => {
            acc[resource.id] = projectResourceIds.has(resource.id)
              ? 'Already related to this project and matches the card context.'
              : 'Matches the card title, description, or tags.';
            return acc;
          }, {})
        );
      }
    } finally {
      setSuggestionLoading(false);
    }
  };

  const renderResourceRow = (resource, reason = '', selectable = true) => {
    const meta = TYPE_META[resource.resource_type] || TYPE_META.website;
    const Icon = meta.icon;
    const selected = selectedIds.includes(resource.id);

    return (
      <button
        key={resource.id}
        type="button"
        onClick={() => selectable && toggleSelection(resource.id)}
        className={cn(
          'w-full rounded-xl border border-border/50 bg-secondary/20 p-3 text-left transition-colors',
          selectable ? 'hover:border-primary/40 hover:bg-secondary/30' : '',
          selected && 'border-primary/50 bg-primary/10'
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 rounded-lg p-2', meta.color)}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{resource.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {resource.summary || resource.main_topic || resource.author || 'No summary available yet.'}
                </p>
              </div>
              {selectable && (
                <div className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60'
                )}>
                  {selected && <Check className="h-3 w-3" />}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', meta.color)}>
                {meta.label}
              </span>
              {projectResourceIds.has(resource.id) && (
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                  project match
                </span>
              )}
              {(resource.tags || []).slice(0, 3).map((tag) => (
                <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                  #{tag}
                </span>
              ))}
            </div>
            {reason && (
              <p className="mt-2 text-xs text-sky-300">{reason}</p>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="bg-card border-border max-w-3xl max-h-[88vh] overflow-y-auto" mobileClassName="bg-card border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Link Resources</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Attach saved knowledge to this card, or create a new resource and link it immediately.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
          <div className="flex flex-wrap gap-2">
            {Object.entries(TAB_CONFIG).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                    activeTab === key
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/50 text-muted-foreground hover:bg-secondary/40'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {config.label}
                </button>
              );
            })}
          </div>

          {activeTab === 'browse' && (
            <div className="space-y-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search title, summary, tags, author, or topic..."
                  className="border-border/50 bg-secondary/40 pl-9"
                />
              </div>

              <div className="space-y-2">
                {availableResources.slice(0, 40).map((resource) => renderResourceRow(resource))}
                {availableResources.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
                    No matching resources available to link.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
                <p className="text-xs text-muted-foreground">
                  {selectedIds.length} selected
                </p>
                <Button onClick={handleLinkSelected} disabled={!selectedIds.length || submitLoading}>
                  {submitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                  Link Selected
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'suggest' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/50 bg-secondary/20 p-4">
                <p className="text-sm text-foreground">
                  Use the card title and description to find useful saved resources.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Suggestions only use resources already in your database.
                </p>
                <Button onClick={handleSuggest} disabled={suggestionLoading} className="mt-3">
                  {suggestionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Suggest Resources
                </Button>
              </div>

              {suggestedResources.length > 0 && (
                <div className="space-y-2">
                  {suggestedResources.map((resource) => renderResourceRow(resource, suggestionReasons[resource.id] || ''))}
                </div>
              )}

              {!suggestionLoading && suggestedResources.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/50 px-4 py-8 text-center text-sm text-muted-foreground">
                  Run suggestions to see relevant saved resources for this card.
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
                <p className="text-xs text-muted-foreground">
                  {selectedIds.length} selected
                </p>
                <Button onClick={handleLinkSelected} disabled={!selectedIds.length || submitLoading}>
                  {submitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lightbulb className="mr-2 h-4 w-4" />}
                  Link Suggested
                </Button>
              </div>
            </div>
          )}

          {activeTab === 'create' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {Object.entries(CREATE_MODE_CONFIG).map(([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCreateMode(key)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                        createMode === key
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/50 text-muted-foreground hover:bg-secondary/40'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {config.label}
                    </button>
                  );
                })}
              </div>

              {createMode === 'url' && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/50 bg-secondary/20 p-4">
                    <p className="text-sm text-foreground">Paste a URL to analyze, save, and link.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This reuses the same AI enrichment flow as the Resources page.
                    </p>
                  </div>
                  <Input
                    value={urlInput}
                    onChange={(event) => setUrlInput(event.target.value)}
                    placeholder="https://example.com/article"
                    className="border-border/50 bg-secondary/40"
                  />
                  <Button onClick={handleCreateFromUrl} disabled={!urlInput.trim() || submitLoading}>
                    {submitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {submitLoading ? 'Analyzing Resource...' : 'Analyze, Save, and Link'}
                  </Button>
                </div>
              )}

              {createMode === 'note' && (
                <div className="space-y-3">
                  <Input
                    value={noteForm.title}
                    onChange={(event) => setNoteForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Note title"
                    className="border-border/50 bg-secondary/40"
                  />
                  <Textarea
                    value={noteForm.content}
                    onChange={(event) => setNoteForm((current) => ({ ...current, content: event.target.value }))}
                    placeholder="Write a quick note for this card..."
                    className="min-h-[160px] border-border/50 bg-secondary/40"
                  />
                  <Input
                    value={noteForm.tags}
                    onChange={(event) => setNoteForm((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="Tags, comma separated"
                    className="border-border/50 bg-secondary/40"
                  />
                  <Button onClick={handleCreateNote} disabled={!noteForm.title.trim() || submitLoading}>
                    {submitLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                    Create Note and Link
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
