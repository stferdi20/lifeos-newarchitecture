import React, { useState } from 'react';
import { Filter, Layers, ChevronDown, ChevronUp } from 'lucide-react';

const SENTIMENTS = ['positive', 'neutral', 'negative', 'mixed'];
const SENTIMENT_COLORS = {
  positive: '#10b981', neutral: '#94a3b8', negative: '#ef4444', mixed: '#f59e0b',
};

export default function GraphControlPanel({ typeConfig, allTags, filters, onFiltersChange, clusterBy, onClusterByChange }) {
  const [open, setOpen] = useState(true);

  const toggleType = (type) => {
    const next = new Set(filters.types);
    next.has(type) ? next.delete(type) : next.add(type);
    onFiltersChange({ ...filters, types: next });
  };

  const toggleTag = (tag) => {
    const next = new Set(filters.tags);
    next.has(tag) ? next.delete(tag) : next.add(tag);
    onFiltersChange({ ...filters, tags: next });
  };

  const toggleSentiment = (s) => {
    const next = new Set(filters.sentiments);
    next.has(s) ? next.delete(s) : next.add(s);
    onFiltersChange({ ...filters, sentiments: next });
  };

  const hasActiveFilters = filters.types.size < Object.keys(typeConfig).length || filters.tags.size > 0 || filters.sentiments.size > 0;

  const clearAll = () => {
    onFiltersChange({ types: new Set(Object.keys(typeConfig)), tags: new Set(), sentiments: new Set() });
    onClusterByChange('none');
  };

  return (
    <div className="absolute top-3 left-3 z-10 w-[min(14rem,calc(100%-1.5rem))] rounded-xl border border-border/60 bg-card/95 backdrop-blur-sm shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Controls</span>
          {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
        </div>
        <div className="flex items-center gap-1">
          {hasActiveFilters && (
            <button onClick={clearAll} className="text-[10px] text-muted-foreground hover:text-foreground px-1">
              Reset
            </button>
          )}
          <button onClick={() => setOpen(o => !o)} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="p-3 space-y-4">
          {/* Node Types */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Node Type</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(typeConfig).map(([type, cfg]) => {
                const active = filters.types.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                      active ? 'border-transparent text-white' : 'border-border/50 text-muted-foreground bg-transparent'
                    }`}
                    style={active ? { background: cfg.color } : {}}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sentiment */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Sentiment</p>
            <div className="flex flex-wrap gap-1.5">
              {SENTIMENTS.map(s => {
                const active = filters.sentiments.has(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleSentiment(s)}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-all capitalize ${
                      active ? 'border-transparent text-white' : 'border-border/50 text-muted-foreground'
                    }`}
                    style={active ? { background: SENTIMENT_COLORS[s] } : {}}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tags */}
          {allTags.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {allTags.map(tag => {
                  const active = filters.tags.has(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${
                        active
                          ? 'bg-primary/20 border-primary/50 text-primary'
                          : 'border-border/50 text-muted-foreground hover:border-border'
                      }`}
                    >
                      #{tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cluster By */}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
              <Layers className="w-3 h-3" /> Cluster By
            </p>
            <div className="flex gap-1.5">
              {['none', 'type', 'tag'].map(opt => (
                <button
                  key={opt}
                  onClick={() => onClusterByChange(opt)}
                  className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all capitalize ${
                    clusterBy === opt
                      ? 'bg-primary/20 border-primary/50 text-primary font-medium'
                      : 'border-border/50 text-muted-foreground hover:border-border'
                  }`}
                >
                  {opt === 'none' ? 'None' : opt === 'type' ? 'Type' : 'Tag'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
