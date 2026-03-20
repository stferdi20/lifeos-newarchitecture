import React from 'react';
import { X, ExternalLink, Lightbulb, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SENTIMENT_COLORS = {
  positive: 'text-emerald-400',
  negative: 'text-red-400',
  neutral: 'text-slate-400',
  mixed: 'text-amber-400',
};

export default function GraphNodeDetail({ node, typeConfig, onClose }) {
  const cfg = typeConfig[node.type] || typeConfig.note;
  const d = node.data;

  const isNote = node.kind === 'note';
  const isTool = node.kind === 'tool';
  const isIdea = node.kind === 'idea';

  return (
    <div className="h-full rounded-2xl border border-border/50 bg-card flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border/50 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: cfg.color }} />
          <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: cfg.color }}>
            {cfg.label}
          </span>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title / Content */}
        <div>
          <h3 className="font-semibold text-sm leading-snug">
            {isNote ? d.title : isTool ? d.name : d.content?.slice(0, 120)}
          </h3>
          {isNote && d.ai_summary && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{d.ai_summary}</p>
          )}
          {isTool && d.ai_summary && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{d.ai_summary}</p>
          )}
          {isIdea && d.content && d.content.length > 120 && (
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{d.content}</p>
          )}
        </div>

        {/* Sentiment */}
        {isNote && d.ai_sentiment && (
          <div className={`text-xs font-medium ${SENTIMENT_COLORS[d.ai_sentiment] || 'text-slate-400'}`}>
            ● {d.ai_sentiment} sentiment
          </div>
        )}

        {/* Key Insights */}
        {isNote && d.ai_key_insights?.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
              <Lightbulb className="w-3 h-3" /> Key Insights
            </p>
            <ul className="space-y-1.5">
              {d.ai_key_insights.map((insight, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-2">
                  <span className="shrink-0 mt-0.5 w-1 h-1 rounded-full bg-primary/60 mt-[6px]" />
                  {insight}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Use Cases (tool) */}
        {isTool && d.use_cases?.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1">
              <Wrench className="w-3 h-3" /> Use Cases
            </p>
            <ul className="space-y-1.5">
              {d.use_cases.slice(0, 4).map((u, i) => (
                <li key={i} className="text-xs text-muted-foreground flex gap-2">
                  <span className="shrink-0 w-1 h-1 rounded-full bg-cyan-400/60 mt-[6px]" />
                  {u}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Tool meta */}
        {isTool && (
          <div className="flex flex-wrap gap-2">
            {d.github_stars && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">⭐ {(d.github_stars / 1000).toFixed(1)}k stars</span>
            )}
            {d.status && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground capitalize">{d.status}</span>
            )}
          </div>
        )}

        {/* Tags */}
        {(d.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {d.tags.map(t => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">#{t}</span>
            ))}
          </div>
        )}

        {/* Idea rating */}
        {isIdea && d.rating && (
          <div className="text-xs text-amber-400">{'★'.repeat(d.rating)}{'☆'.repeat(5 - d.rating)}</div>
        )}

        {/* Links */}
        {(d.source_url || d.url) && (
          <a
            href={d.source_url || d.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="w-3 h-3" /> Open source
          </a>
        )}
      </div>
    </div>
  );
}
