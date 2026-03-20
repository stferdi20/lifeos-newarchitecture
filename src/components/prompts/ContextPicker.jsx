import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, FolderKanban, Wrench, Search, Check, X } from 'lucide-react';
import { Note, Tool } from '@/lib/knowledge-api';
import { listStandaloneTaskRecords } from '@/lib/tasks';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const sourceTypes = [
  { key: 'notes', label: 'Resources', icon: FileText, load: () => Note.list('-created_date', 50), titleField: 'title', contentField: 'content' },
  { key: 'tasks', label: 'Tasks', icon: FolderKanban, load: () => listStandaloneTaskRecords(), titleField: 'title', contentField: 'description' },
  { key: 'tools', label: 'Tools', icon: Wrench, load: () => Tool.list('-created_date', 50), titleField: 'name', contentField: 'ai_summary' },
];

export default function ContextPicker({ onInsert, onClose }) {
  const [activeSource, setActiveSource] = useState('notes');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);

  const source = sourceTypes.find(s => s.key === activeSource);

  const { data: items = [] } = useQuery({
    queryKey: ['context-picker', activeSource],
    queryFn: () => source.load(),
  });

  const filtered = items.filter(item => {
    const title = (item[source.titleField] || '').toLowerCase();
    return title.includes(search.toLowerCase());
  });

  const toggleItem = (item) => {
    const exists = selected.find(s => s.id === item.id && s.source === activeSource);
    if (exists) {
      setSelected(selected.filter(s => !(s.id === item.id && s.source === activeSource)));
    } else {
      setSelected([...selected, {
        id: item.id,
        source: activeSource,
        title: item[source.titleField] || 'Untitled',
        content: item[source.contentField] || item[source.titleField] || '',
      }]);
    }
  };

  const handleInsert = () => {
    const contextText = selected.map(s =>
      `[${s.source}] ${s.title}:\n${s.content}`
    ).join('\n\n---\n\n');
    onInsert(contextText);
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Pull Context from Your Data</h3>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Source tabs */}
      <div className="flex gap-1.5">
        {sourceTypes.map(s => (
          <button
            key={s.key}
            onClick={() => { setActiveSource(s.key); setSearch(''); }}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              activeSource === s.key
                ? "bg-violet-500/20 text-violet-400"
                : "text-muted-foreground hover:bg-white/[0.06]"
            )}
          >
            <s.icon className="w-3.5 h-3.5" />
            {s.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${source.label.toLowerCase()}...`}
          className="pl-9 bg-secondary/50 border-border/50"
        />
      </div>

      {/* Items list */}
      <div className="max-h-48 overflow-y-auto space-y-1">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground/50 text-center py-4">No items found</p>
        )}
        {filtered.map(item => {
          const isSelected = selected.some(s => s.id === item.id && s.source === activeSource);
          return (
            <button
              key={item.id}
              onClick={() => toggleItem(item)}
              className={cn(
                "w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                isSelected
                  ? "bg-violet-500/15 text-violet-300"
                  : "text-muted-foreground hover:bg-white/[0.04]"
              )}
            >
              {isSelected ? (
                <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              ) : (
                <div className="w-3.5 h-3.5 rounded border border-white/20 shrink-0" />
              )}
              <span className="truncate">{item[source.titleField] || 'Untitled'}</span>
            </button>
          );
        })}
      </div>

      {/* Selected count & Insert */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">
          {selected.length} item{selected.length !== 1 ? 's' : ''} selected
        </span>
        <Button
          onClick={handleInsert}
          disabled={selected.length === 0}
          size="sm"
          className="bg-violet-600 hover:bg-violet-700"
        >
          Insert as Context
        </Button>
      </div>
    </div>
  );
}
