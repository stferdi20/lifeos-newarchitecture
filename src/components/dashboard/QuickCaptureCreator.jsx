import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Users, Send, X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CreatorInspo, enrichCreator } from '@/lib/creator-api';
import { Note } from '@/lib/knowledge-api';

const PLATFORMS = [
  { key: 'x', label: 'X', icon: '𝕏' },
  { key: 'threads', label: 'Threads', icon: '@' },
  { key: 'instagram', label: 'IG', icon: '📸' },
  { key: 'tiktok', label: 'TikTok', icon: '🎵' },
  { key: 'youtube', label: 'YouTube', icon: '▶️' },
  { key: 'linkedin', label: 'LinkedIn', icon: '💼' },
  { key: 'other', label: 'Other', icon: '🔗' },
];

const DEFAULT_TAGS = [
  'ai-content', 'tech', 'design', 'startup', 'dev', 'productivity',
  'gaming', 'education', 'crypto', 'saas', 'no-code', 'indie-hacker',
  'ux-ui', 'marketing', 'storytelling',
];

export default function QuickCaptureCreator() {
  const [platform, setPlatform] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [customTag, setCustomTag] = useState('');
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const addCustomTag = () => {
    const tag = customTag.trim().toLowerCase().replace(/\s+/g, '-');
    if (tag && !selectedTags.includes(tag)) {
      setSelectedTags(prev => [...prev, tag]);
    }
    setCustomTag('');
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanHandle = handle.replace('@', '');
      // Create Note
      const note = await Note.create({
        title: `${PLATFORMS.find(p => p.key === platform)?.icon || ''} @${cleanHandle}`,
        content: `**Platform:** ${platform}\n**Handle:** @${cleanHandle}\n\n${description}`,
        type: 'manual_note',
        tags: ['creator-inspo', ...selectedTags],
      });
      // Create CreatorInspo record
      const creator = await CreatorInspo.create({
        platform,
        handle: cleanHandle,
        description,
        tags: selectedTags,
        note_id: note.id,
      });
      // Enrich with AI in the background
      enrichCreator({
        creator_id: creator.id,
        handle: cleanHandle,
        platform,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['creatorInspo'] });
      }).catch(() => { /* enrichment failed silently */ });
    },
    onSuccess: () => {
      setPlatform('');
      setHandle('');
      setDescription('');
      setSelectedTags([]);
      setExpanded(false);
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['creatorInspo'] });
      toast.success('Creator saved! AI enrichment in progress...');
    },
  });

  const isValid = platform && handle.trim();

  if (!expanded) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-[#1a1025] via-card to-card border border-fuchsia-500/10 p-5 h-full hover:border-fuchsia-500/25 hover:shadow-lg hover:shadow-fuchsia-500/5 transition-all duration-300">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-fuchsia-400" />
          <h3 className="text-sm font-semibold tracking-tight">Quick Capture Creator</h3>
        </div>
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center gap-2 bg-secondary/50 border border-border/50 rounded-lg px-3 py-3 text-sm text-muted-foreground/60 hover:bg-secondary/70 hover:text-muted-foreground transition-colors"
        >
          <Plus className="w-4 h-4" />
          Save a creator for inspo...
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#1a1025] via-card to-card border border-fuchsia-500/10 p-5 h-full hover:border-fuchsia-500/25 hover:shadow-lg hover:shadow-fuchsia-500/5 transition-all duration-300">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-fuchsia-400" />
          <h3 className="text-sm font-semibold tracking-tight">Quick Capture Creator</h3>
        </div>
        <button onClick={() => setExpanded(false)} className="p-1 rounded-md hover:bg-secondary/50 text-muted-foreground">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-3">
        {/* Platform selector */}
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map(p => (
            <button
              key={p.key}
              onClick={() => setPlatform(p.key)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
                platform === p.key
                  ? 'bg-fuchsia-500/20 border-fuchsia-500/30 text-fuchsia-300'
                  : 'bg-secondary/30 border-border/30 text-muted-foreground hover:bg-secondary/50'
              )}
            >
              {p.icon} {p.label}
            </button>
          ))}
        </div>

        {/* Handle */}
        <input
          value={handle}
          onChange={e => setHandle(e.target.value)}
          placeholder="@handle"
          className="w-full bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50"
        />

        {/* Description */}
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What do you like about this creator?"
          rows={2}
          className="w-full bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50 resize-none"
        />

        {/* Tags */}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Tags</p>
          <div className="flex flex-wrap gap-1.5 mb-2 max-h-32 overflow-y-auto pr-1">
            {DEFAULT_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={cn(
                  'px-2 py-1 rounded-md text-[11px] font-medium border transition-all',
                  selectedTags.includes(tag)
                    ? 'bg-violet-500/20 border-violet-500/30 text-violet-300'
                    : 'bg-secondary/20 border-border/20 text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/40'
                )}
              >
                {tag}
              </button>
            ))}
            {selectedTags.filter(t => !DEFAULT_TAGS.includes(t)).map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="px-2 py-1 rounded-md text-[11px] font-medium border bg-violet-500/20 border-violet-500/30 text-violet-300"
              >
                {tag} ×
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5 sm:flex-row">
            <input
              value={customTag}
              onChange={e => setCustomTag(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomTag()}
              placeholder="Add custom tag..."
              className="flex-1 bg-secondary/30 border border-border/30 rounded-md px-2 py-1 text-[11px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
            />
            <button onClick={addCustomTag} disabled={!customTag.trim()}
              className="px-2 py-2 sm:py-1 rounded-md bg-secondary/50 text-muted-foreground hover:text-foreground text-[11px] disabled:opacity-30">
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => saveMutation.mutate()}
          disabled={!isValid || saveMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-fuchsia-500/20 text-fuchsia-300 font-medium text-sm hover:bg-fuchsia-500/30 transition-colors disabled:opacity-30"
        >
          <Send className="w-4 h-4" />
          {saveMutation.isPending ? 'Saving...' : 'Save Creator'}
        </button>
      </div>
    </div>
  );
}
