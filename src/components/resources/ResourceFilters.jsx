import React from 'react';
import { cn } from '@/lib/utils';
import {
  Youtube, MessageSquare, Newspaper, GraduationCap, FileText, Globe, FileDown,
  Layers, Filter, X, Github, Archive, Clapperboard
} from 'lucide-react';

const TYPE_OPTIONS = [
  { value: 'all', label: 'All Types', icon: Layers },
  { value: 'github_repo', label: 'GitHub', icon: Github },
  { value: 'youtube', label: 'YouTube', icon: Youtube },
  { value: 'instagram_reel', label: 'IG Reel', icon: Clapperboard },
  { value: 'instagram_carousel', label: 'IG Carousel', icon: Clapperboard },
  { value: 'website', label: 'Website', icon: Globe },
  { value: 'article', label: 'Article', icon: Newspaper },
  { value: 'reddit', label: 'Reddit', icon: MessageSquare },
  { value: 'research_paper', label: 'Paper', icon: GraduationCap },
  { value: 'pdf', label: 'PDF', icon: FileDown },
  { value: 'note', label: 'Note', icon: FileText },
];

export default function ResourceFilters({
  typeFilter, setTypeFilter,
  areaFilter, setAreaFilter,
  archivedFilter, setArchivedFilter,
  projectFilter, setProjectFilter,
  tagFilter, setTagFilter,
  projects, allTags, areas
}) {
  const hasFilters = typeFilter !== 'all' || areaFilter !== 'all' || archivedFilter !== 'active' || projectFilter || tagFilter;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-medium text-muted-foreground">Filters</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_OPTIONS.map(opt => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={cn(
                'shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all',
                typeFilter === opt.value
                  ? 'bg-primary/15 border-primary/30 text-primary'
                  : 'bg-secondary/30 border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              <Icon className="w-3 h-3" />
              {opt.label}
            </button>
          );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {/* Area filter */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setAreaFilter('all')}
            className={cn(
              'shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all',
              areaFilter === 'all'
                ? 'bg-violet-500/15 border-violet-500/30 text-violet-400'
                : 'bg-secondary/30 border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            )}
          >
            <Layers className="w-3 h-3" /> All Areas
          </button>
          {(areas || []).map(area => (
            <button
              key={area.id}
              onClick={() => setAreaFilter(area.id)}
              title={area.name}
              className={cn(
                'shrink-0 flex items-center gap-1 py-1 rounded-lg text-[11px] font-medium border transition-all',
                areaFilter === area.id
                  ? 'bg-violet-500/15 border-violet-500/30 text-violet-400 px-2'
                  : 'bg-secondary/30 border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50 px-1.5'
              )}
            >
              <span className="text-sm">{area.icon}</span>
              {areaFilter === area.id && <span>{area.name}</span>}
            </button>
          ))}
        </div>

        {/* Archived toggle */}
        <div className="flex flex-wrap gap-1.5">
          {['active', 'archived', 'all_status'].map(v => (
            <button
              key={v}
              onClick={() => setArchivedFilter(v)}
              className={cn(
                'shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-all',
                archivedFilter === v
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                  : 'bg-secondary/30 border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              {v === 'archived' && <Archive className="w-3 h-3" />}
              {v === 'active' ? 'Active' : v === 'archived' ? 'Archived' : 'All'}
            </button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          {projects.length > 0 && (
            <select
              value={projectFilter || ''}
              onChange={e => setProjectFilter(e.target.value || null)}
              className="w-full bg-secondary/40 border border-border/50 rounded-lg px-2.5 py-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {allTags.length > 0 && (
            <select
              value={tagFilter || ''}
              onChange={e => setTagFilter(e.target.value || null)}
              className="w-full bg-secondary/40 border border-border/50 rounded-lg px-2.5 py-2 text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">All Tags</option>
              {allTags.map(t => (
                <option key={t} value={t}>#{t}</option>
              ))}
            </select>
          )}

          {hasFilters && (
            <button
              onClick={() => { setTypeFilter('all'); setAreaFilter('all'); setArchivedFilter('active'); setProjectFilter(null); setTagFilter(null); }}
              className="flex items-center justify-center gap-1 rounded-lg border border-red-500/20 px-2.5 py-2 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-500/5"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
