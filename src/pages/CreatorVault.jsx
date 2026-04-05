import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search, Trash2, ExternalLink, Plus } from 'lucide-react';
import { CreatorInspo } from '@/lib/creator-api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { toast } from 'sonner';
import BulkAddCreatorModal from '../components/creator/BulkAddCreatorModal';
import { PageHeader } from '@/components/layout/page-header';
import { MobileFilterDrawer } from '@/components/layout/MobileFilterDrawer';

const PLATFORM_CONFIG = {
  x: { label: 'X', icon: '𝕏', color: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30', urlBase: 'https://x.com/' },
  threads: { label: 'Threads', icon: '@', color: 'bg-gray-500/20 text-gray-300 border-gray-500/30', urlBase: 'https://threads.net/@' },
  instagram: { label: 'Instagram', icon: '📸', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30', urlBase: 'https://instagram.com/' },
  tiktok: { label: 'TikTok', icon: '🎵', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30', urlBase: 'https://tiktok.com/@' },
  youtube: { label: 'YouTube', icon: '▶️', color: 'bg-red-500/20 text-red-300 border-red-500/30', urlBase: 'https://youtube.com/@' },
  linkedin: { label: 'LinkedIn', icon: '💼', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30', urlBase: 'https://linkedin.com/in/' },
  other: { label: 'Other', icon: '🔗', color: 'bg-violet-500/20 text-violet-300 border-violet-500/30', urlBase: '' },
};

function CreatorCard({ creator, onDelete }) {
  const cfg = PLATFORM_CONFIG[creator.platform] || PLATFORM_CONFIG.other;
  const profileUrl = cfg.urlBase ? `${cfg.urlBase}${creator.handle}` : null;
  const [imageFailed, setImageFailed] = useState(false);
  const cleanedHandle = String(creator.handle || '').replace(/^@/, '').trim();
  const monogram = cleanedHandle
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || cfg.icon;
  const showProfileImage = Boolean(creator.profile_picture_url) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [creator.profile_picture_url]);

  return (
    <div className="group rounded-xl bg-secondary/20 border border-border/30 hover:border-border/50 p-4 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {showProfileImage ? (
            <img
              src={creator.profile_picture_url}
              alt={creator.handle}
              onError={() => setImageFailed(true)}
              className="w-10 h-10 rounded-xl object-cover shrink-0 border border-border/30"
            />
          ) : (
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border overflow-hidden',
              cfg.color,
            )}>
              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-white/10 via-white/5 to-transparent">
                <span className="text-xs font-semibold tracking-[0.18em] leading-none">
                  {monogram}
                </span>
                <span className="mt-0.5 text-[8px] leading-none opacity-70">
                  {cfg.label.slice(0, 2).toUpperCase()}
                </span>
              </div>
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground truncate">@{creator.handle}</p>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border font-medium', cfg.color)}>
                {cfg.label}
              </span>
            </div>
            {creator.niche && (
              <p className="text-[11px] text-fuchsia-400/80 font-medium mt-0.5">{creator.niche}</p>
            )}
            {creator.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{creator.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {profileUrl && (
            <a href={profileUrl} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={() => onDelete(creator.id)}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {creator.content_style && (
        <p className="text-[11px] text-muted-foreground/70 mt-2 line-clamp-2 italic">"{creator.content_style}"</p>
      )}

      {creator.tags && creator.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {creator.tags.map(tag => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {tag}
            </span>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/40 mt-2">
        {format(new Date(creator.created_date), 'MMM d, yyyy')}
      </p>
    </div>
  );
}

export default function CreatorVault() {
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const queryClient = useQueryClient();

  const { data: creators = [], isLoading } = useQuery({
    queryKey: ['creatorInspo'],
    queryFn: () => CreatorInspo.list('-created_date', 100),
    initialData: [],
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => CreatorInspo.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['creatorInspo'] });
      toast.success('Creator removed');
    },
  });

  const filtered = useMemo(() => {
    return creators.filter(c => {
      const q = search.toLowerCase();
      const matchesSearch = !search ||
        c.handle?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.niche?.toLowerCase().includes(q) ||
        c.content_style?.toLowerCase().includes(q) ||
        c.tags?.some(t => t.toLowerCase().includes(q));
      const matchesPlatform = platformFilter === 'all' || c.platform === platformFilter;
      return matchesSearch && matchesPlatform;
    });
  }, [creators, search, platformFilter]);

  const platformCounts = useMemo(() => {
    const counts = { all: creators.length };
    creators.forEach(c => {
      counts[c.platform] = (counts[c.platform] || 0) + 1;
    });
    return counts;
  }, [creators]);

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader
        icon={Users}
        title="Creator Vault"
        description={`${creators.length} creator${creators.length !== 1 ? 's' : ''} saved`}
        actions={(
          <Button onClick={() => setShowBulkAdd(true)} className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-sm shrink-0 w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" /> Bulk Add
          </Button>
        )}
      />

      {/* Desktop Search & Filters */}
      <div className="hidden sm:flex flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search creators, tags..."
            className="w-full pl-9 pr-3 py-2 bg-secondary/50 border border-border/50 rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setPlatformFilter('all')}
            className={cn('px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
              platformFilter === 'all'
                ? 'bg-fuchsia-500/20 border-fuchsia-500/30 text-fuchsia-300'
                : 'bg-secondary/30 border-border/30 text-muted-foreground hover:bg-secondary/50'
            )}
          >
            All ({platformCounts.all || 0})
          </button>
          {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => (
            platformCounts[key] ? (
              <button
                key={key}
                onClick={() => setPlatformFilter(key)}
                className={cn('px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  platformFilter === key
                    ? 'bg-fuchsia-500/20 border-fuchsia-500/30 text-fuchsia-300'
                    : 'bg-secondary/30 border-border/30 text-muted-foreground hover:bg-secondary/50'
                )}
              >
                {cfg.icon} {platformCounts[key]}
              </button>
            ) : null
          ))}
        </div>
      </div>

      {/* Mobile Search & Filters */}
      <div className="flex sm:hidden gap-2 w-full">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-9 pr-3 py-2 bg-secondary/50 border border-border/50 rounded-xl text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-fuchsia-500/50"
          />
        </div>
        <div className="flex-[0_0_auto] max-w-[110px]">
          <MobileFilterDrawer activeCount={platformFilter !== 'all' ? 1 : 0} triggerClassName="w-full h-full rounded-xl">
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setPlatformFilter('all'); }}
                className={cn('flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium border transition-all text-left',
                  platformFilter === 'all'
                    ? 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-500'
                    : 'bg-secondary/20 border-border/30 text-muted-foreground'
                )}
              >
                <span>All Platforms</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary">
                  {platformCounts.all || 0}
                </span>
              </button>
              {Object.entries(PLATFORM_CONFIG).map(([key, cfg]) => (
                platformCounts[key] ? (
                  <button
                    key={key}
                    onClick={() => { setPlatformFilter(key); }}
                    className={cn('flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-medium border transition-all text-left',
                      platformFilter === key
                        ? 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-500'
                        : 'bg-secondary/20 border-border/30 text-muted-foreground'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn('w-6 h-6 rounded-md flex items-center justify-center text-xs', cfg.color)}>{cfg.icon}</span>
                      {cfg.label}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-secondary">
                      {platformCounts[key]}
                    </span>
                  </button>
                ) : null
              ))}
            </div>
          </MobileFilterDrawer>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-28 rounded-xl bg-secondary/20 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{creators.length === 0 ? 'No creators saved yet.' : 'No creators match your filters.'}</p>
          <p className="text-xs text-muted-foreground/50 mt-1">Use the Quick Capture Creator widget on the Dashboard to add some!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(creator => (
            <CreatorCard key={creator.id} creator={creator} onDelete={(id) => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}

      <BulkAddCreatorModal
        open={showBulkAdd}
        onClose={() => setShowBulkAdd(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['creatorInspo'] })}
      />
    </div>
  );
}
