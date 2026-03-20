import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Pin, Copy, Trash2, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

const categoryColors = {
  writing: 'bg-blue-500/20 text-blue-400',
  coding: 'bg-green-500/20 text-green-400',
  research: 'bg-violet-500/20 text-violet-400',
  brainstorming: 'bg-amber-500/20 text-amber-400',
  summarizing: 'bg-cyan-500/20 text-cyan-400',
  analysis: 'bg-rose-500/20 text-rose-400',
  creative: 'bg-fuchsia-500/20 text-fuchsia-400',
  other: 'bg-slate-500/20 text-slate-400',
};

export default function PromptCard({ template, onSelect, onCopy, onPin, onDelete }) {
  return (
    <div
      onClick={() => onSelect(template)}
      className={cn(
        "group relative rounded-xl border border-white/[0.06] bg-card p-4 cursor-pointer transition-all duration-200",
        "hover:border-violet-500/30 hover:shadow-lg hover:shadow-violet-500/5",
        template.pinned && "border-amber-500/20"
      )}
    >
      {template.pinned && (
        <Pin className="absolute top-3 right-3 w-3.5 h-3.5 text-amber-400 fill-amber-400" />
      )}

      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{template.title}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.task}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge className={cn('text-[10px] px-1.5 py-0', categoryColors[template.category] || categoryColors.other)}>
            {template.category}
          </Badge>
          {template.tags?.slice(0, 2).map(tag => (
            <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 border-white/10">
              {tag}
            </Badge>
          ))}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={e => { e.stopPropagation(); onCopy(template); }}
            className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground"
            title="Copy prompt"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onPin(template); }}
            className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground"
            title="Pin"
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          {!template.is_preset && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(template); }}
              className="p-1.5 rounded-md hover:bg-red-500/20 text-muted-foreground hover:text-red-400"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {template.use_count > 0 && (
        <p className="text-[10px] text-muted-foreground/50 mt-2">Used {template.use_count}×</p>
      )}

      {(template.sample_input_files?.length > 0 || template.sample_output_files?.length > 0) && (
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground/70">
          {template.sample_input_files?.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {template.sample_input_files.length} input sample{template.sample_input_files.length > 1 ? 's' : ''}
            </span>
          )}
          {template.sample_output_files?.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {template.sample_output_files.length} output sample{template.sample_output_files.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
