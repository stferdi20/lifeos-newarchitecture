import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, BookOpen, Link2, Github, ZoomIn, ZoomOut, Maximize2, Search, Network, Filter, Clapperboard } from 'lucide-react';
import { Note } from '@/lib/knowledge-api';
import { Resource } from '@/lib/resources-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';
import { MobileOnly, TabletUp } from '@/components/layout/responsive-view';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import GraphCanvas from '../components/graph/GraphCanvas';
import GraphNodeDetail from '../components/graph/GraphNodeDetail';
import GraphControlPanel from '../components/graph/GraphControlPanel';

const TYPE_CONFIG = {
  manual_note:     { color: '#3b82f6', bg: '#1d3a6e', label: 'Note',     icon: FileText },
  youtube_video:   { color: '#ef4444', bg: '#5a1c1c', label: 'YouTube',  icon: Link2 },
  news_article:    { color: '#06b6d4', bg: '#0a3a45', label: 'News',     icon: BookOpen },
  academic_paper:  { color: '#8b5cf6', bg: '#3b1f6e', label: 'Paper',    icon: BookOpen },
  reddit_post:     { color: '#f97316', bg: '#5a2a10', label: 'Reddit',   icon: Link2 },
  generic_link:    { color: '#10b981', bg: '#0d4a30', label: 'Link',     icon: Link2 },
  github_repo:     { color: '#e2e8f0', bg: '#1e293b', label: 'GitHub',   icon: Github },
  youtube:         { color: '#ef4444', bg: '#5a1c1c', label: 'YouTube',  icon: Link2 },
  reddit:          { color: '#f97316', bg: '#5a2a10', label: 'Reddit',   icon: Link2 },
  article:         { color: '#06b6d4', bg: '#0a3a45', label: 'Article',  icon: BookOpen },
  website:         { color: '#06b6d4', bg: '#0a3a45', label: 'Website',  icon: Link2 },
  research_paper:  { color: '#8b5cf6', bg: '#3b1f6e', label: 'Paper',    icon: BookOpen },
  pdf:             { color: '#f59e0b', bg: '#5a3a10', label: 'PDF',      icon: FileText },
  note:            { color: '#10b981', bg: '#0d4a30', label: 'Note',     icon: FileText },
  instagram_reel:  { color: '#f472b6', bg: '#4a1130', label: 'IG Reel',  icon: Clapperboard },
  instagram_carousel: { color: '#e879f9', bg: '#4a1447', label: 'IG Carousel', icon: Clapperboard },
};

function buildGraph(notes, resources) {
  const nodes = [];
  const edges = [];
  const edgeSet = new Set();

  notes.forEach(n => nodes.push({ id: 'n_' + n.id, label: n.title, type: n.type || 'manual_note', kind: 'note', data: n }));
  resources.forEach(r => nodes.push({ id: 'r_' + r.id, label: r.title, type: r.resource_type || 'website', kind: 'resource', data: r }));

  notes.forEach(n => {
    (n.related_content || []).forEach(rel => {
      let target = null;
      if (rel.type === 'note' || rel.type === 'research') target = notes.find(x => x.title?.toLowerCase() === rel.title?.toLowerCase());
      if (target) {
        const key = ['n_' + n.id, 'n_' + target.id].sort().join('--');
        if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ source: 'n_' + n.id, target: 'n_' + target.id, label: rel.reason || '' }); }
      }
    });
  });

  // Tag-based edges across all items
  const tagMap = {};
  const allItems = [
    ...notes.map(n => ({ id: 'n_' + n.id, tags: n.tags || [] })),
    ...resources.map(r => ({ id: 'r_' + r.id, tags: r.tags || [] })),
  ];
  allItems.forEach(item => {
    item.tags.forEach(tag => { if (!tagMap[tag]) tagMap[tag] = []; tagMap[tag].push(item.id); });
  });
  Object.values(tagMap).forEach(ids => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join('--');
        if (!edgeSet.has(key)) { edgeSet.add(key); edges.push({ source: ids[i], target: ids[j], label: 'shared tag' }); }
      }
    }
  });

  return { nodes, edges };
}

// Cluster center positions for 'type' clustering
const TYPE_CLUSTER_POSITIONS = {
  manual_note:     { x: 300,  y: 250 },
  youtube_video:   { x: 200,  y: 500 },
  news_article:    { x: 700,  y: 200 },
  academic_paper:  { x: 900,  y: 300 },
  reddit_post:     { x: 400,  y: 650 },
  generic_link:    { x: 800,  y: 650 },
  github_repo:     { x: 600,  y: 600 },
  youtube:         { x: 200,  y: 500 },
  reddit:          { x: 400,  y: 650 },
  article:         { x: 700,  y: 200 },
  website:         { x: 500,  y: 400 },
  research_paper:  { x: 900,  y: 300 },
  pdf:             { x: 800,  y: 500 },
  note:            { x: 300,  y: 250 },
  instagram_reel:  { x: 250,  y: 620 },
  instagram_carousel: { x: 320, y: 700 },
};

export default function KnowledgeGraph() {
  const [selectedNode, setSelectedNode] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [clusterBy, setClusterBy] = useState('none');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    types: new Set(Object.keys(TYPE_CONFIG)),
    tags: new Set(),
    sentiments: new Set(),
  });
  const isMobile = useIsMobile();

  const { data: notes = [] } = useQuery({ queryKey: ['notes'], queryFn: () => Note.list('-created_date', 200), initialData: [] });
  const { data: resources = [] } = useQuery({ queryKey: ['resources'], queryFn: () => Resource.list('-created_date', 200), initialData: [] });

  const { nodes: allNodes, edges: allEdges } = useMemo(() => buildGraph(notes, resources), [notes, resources]);

  // Derive all unique tags
  const allTags = useMemo(() => {
    const set = new Set();
    notes.forEach(n => (n.tags || []).forEach(t => set.add(t)));
    resources.forEach(r => (r.tags || []).forEach(t => set.add(t)));
    return [...set].sort();
  }, [notes, resources]);

  // Apply filters
  const { nodes, edges } = useMemo(() => {
    let filtered = allNodes.filter(n => {
      if (!filters.types.has(n.type)) return false;
      if (filters.sentiments.size > 0 && n.kind === 'note') {
        const s = n.data?.ai_sentiment;
        if (s && !filters.sentiments.has(s)) return false;
      }
      if (filters.tags.size > 0) {
        const nodeTags = n.data?.tags || [];
        const hasTag = nodeTags.some(t => filters.tags.has(t));
        if (!hasTag) return false;
      }
      return true;
    });
    const visibleIds = new Set(filtered.map(n => n.id));
    const filteredEdges = allEdges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
    return { nodes: filtered, edges: filteredEdges };
  }, [allNodes, allEdges, filters]);

  const filteredNodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return nodes;
    return nodes.filter((node) => {
      const haystack = [
        node.label,
        node.data?.title,
        node.data?.summary,
        node.data?.ai_summary,
        ...(node.data?.tags || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [nodes, search]);

  // Compute cluster targets for canvas
  const clusterTargets = useMemo(() => {
    if (clusterBy === 'none') return null;
    if (clusterBy === 'type') {
      const targets = {};
      nodes.forEach(n => { targets[n.id] = TYPE_CLUSTER_POSITIONS[n.type] || { x: 600, y: 400 }; });
      return targets;
    }
    if (clusterBy === 'tag') {
      // Assign each node to its first tag's cluster center
      const tagList = [...allTags];
      const tagCenters = {};
      tagList.forEach((tag, i) => {
        const angle = (i / Math.max(tagList.length, 1)) * 2 * Math.PI;
        tagCenters[tag] = { x: 600 + 300 * Math.cos(angle), y: 400 + 300 * Math.sin(angle) };
      });
      const targets = {};
      nodes.forEach(n => {
        const nodeTags = n.data?.tags || [];
        const center = nodeTags.length > 0 ? tagCenters[nodeTags[0]] : { x: 600, y: 400 };
        targets[n.id] = center || { x: 600, y: 400 };
      });
      return targets;
    }
    return null;
  }, [clusterBy, nodes, allTags]);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Network}
        title="Knowledge Graph"
        description={`${nodes.length} nodes · ${edges.length} connections`}
        actions={
          <TabletUp>
            <div className="flex gap-1">
              <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setZoom(z => Math.min(z + 0.2, 3))}><ZoomIn className="w-3.5 h-3.5" /></Button>
              <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))}><ZoomOut className="w-3.5 h-3.5" /></Button>
              <Button size="icon" variant="outline" className="h-9 w-9" onClick={() => setZoom(1)}><Maximize2 className="w-3.5 h-3.5" /></Button>
            </div>
          </TabletUp>
        }
      />

      <MobileOnly>
        <div className="space-y-4">
          <div className="rounded-2xl border border-border/50 bg-card/60 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-secondary/30 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Visible Nodes</p>
                <p className="mt-1 text-xl font-semibold">{filteredNodes.length}</p>
              </div>
              <div className="rounded-xl bg-secondary/30 p-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Connections</p>
                <p className="mt-1 text-xl font-semibold">{edges.length}</p>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search nodes or tags..."
                className="border-border/50 bg-secondary/40 pl-9"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                Active types
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
                  const active = filters.types.has(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        const next = new Set(filters.types);
                        next.has(type) ? next.delete(type) : next.add(type);
                        setFilters((prev) => ({ ...prev, types: next }));
                      }}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors',
                        active ? 'text-white border-transparent' : 'border-border/60 text-muted-foreground'
                      )}
                      style={active ? { background: cfg.color } : undefined}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {filteredNodes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
                No nodes match the current mobile filters.
              </div>
            ) : (
              filteredNodes.map((node) => {
                const cfg = TYPE_CONFIG[node.type] || TYPE_CONFIG.note;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedNode(node)}
                    className="w-full rounded-2xl border border-border/50 bg-card/60 p-4 text-left transition-colors hover:border-primary/30 hover:bg-card"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: cfg.color }} />
                      <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: cfg.color }}>
                        {cfg.label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-snug">{node.label}</p>
                    {(node.data?.ai_summary || node.data?.summary) && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                        {node.data?.ai_summary || node.data?.summary}
                      </p>
                    )}
                    {(node.data?.tags || []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(node.data.tags || []).slice(0, 4).map((tag) => (
                          <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </MobileOnly>

      <TabletUp>
        <div className="flex min-h-0 gap-4 h-[calc(100vh-12rem)]">
          <div className="relative flex-1 overflow-hidden rounded-2xl border border-border/50 bg-card">
            <GraphControlPanel
              typeConfig={TYPE_CONFIG}
              allTags={allTags}
              filters={filters}
              onFiltersChange={setFilters}
              clusterBy={clusterBy}
              onClusterByChange={setClusterBy}
            />
            <GraphCanvas
              nodes={nodes}
              edges={edges}
              typeConfig={TYPE_CONFIG}
              zoom={zoom}
              onZoomChange={setZoom}
              onSelectNode={setSelectedNode}
              selectedNodeId={selectedNode?.id}
              clusterTargets={clusterTargets}
            />
          </div>

          {selectedNode && (
            <div className="w-80 shrink-0">
              <GraphNodeDetail node={selectedNode} typeConfig={TYPE_CONFIG} onClose={() => setSelectedNode(null)} />
            </div>
          )}
        </div>
      </TabletUp>

      {isMobile && (
        <ResponsiveModal open={!!selectedNode} onOpenChange={(open) => !open && setSelectedNode(null)}>
          <ResponsiveModalContent mobileClassName="border-border bg-card">
            {selectedNode ? (
              <div className="px-4 pb-4">
                <GraphNodeDetail node={selectedNode} typeConfig={TYPE_CONFIG} onClose={() => setSelectedNode(null)} />
              </div>
            ) : null}
          </ResponsiveModalContent>
        </ResponsiveModal>
      )}
    </div>
  );
}
