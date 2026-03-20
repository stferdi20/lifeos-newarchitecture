import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, ChevronDown } from 'lucide-react';
import { EventTemplate } from '@/lib/event-templates-api';
import { getCategoryConfig } from './CategoryBadge';
import { cn } from '@/lib/utils';

export default function TemplateSelector({ onSelect }) {
  const [open, setOpen] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ['eventTemplates'],
    queryFn: () => EventTemplate.list(),
  });

  if (templates.length === 0) return null;

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-secondary/30 border border-border/30 hover:bg-secondary/50 text-sm text-muted-foreground transition-colors">
        <Layers className="w-4 h-4" />
        Use Template
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-[#1e2030] border border-border/40 rounded-xl shadow-xl z-50 overflow-hidden">
          {templates.map(t => {
            const cfg = getCategoryConfig(t.category);
            return (
              <button key={t.id} onClick={() => { onSelect(t); setOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-secondary/30 transition-colors text-left">
                <span className={cn('text-xs px-2 py-0.5 rounded-full border', cfg.color)}>{cfg.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.duration_minutes}min
                    {t.recurrence_weeks > 1 ? ` · ${t.recurrence_weeks}wk recurring` : ''}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
