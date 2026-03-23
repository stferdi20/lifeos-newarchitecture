import React, { memo } from 'react';
import { cn } from '@/lib/utils';
import { Star, Trash2 } from 'lucide-react';
import { TYPE_CONFIG, STATUS_COLORS, getStatusLabel } from './mediaConfig';
import { getMediaCardHighlightTags, isProviderBackedMedia, normalizeMediaEntry } from './mediaUtils';

const TAG_TONE_CLASSES = {
  genre: 'bg-white/15 text-white/90',
  creator: 'bg-blue-500/30 text-blue-200',
  cast: 'bg-indigo-500/25 text-indigo-200',
  platform: 'bg-cyan-500/30 text-cyan-200',
  count: 'bg-violet-500/30 text-violet-200',
  neutral: 'bg-white/15 text-white/90',
};

function MediaCard({ entry, onClick, className, onDelete }) {
  const normalizedEntry = normalizeMediaEntry(entry);
  const cfg = TYPE_CONFIG[normalizedEntry?.media_type] || TYPE_CONFIG.movie;
  const statusColor = STATUS_COLORS[normalizedEntry?.status] || STATUS_COLORS.plan_to_watch;
  const statusLabel = getStatusLabel(normalizedEntry?.media_type, normalizedEntry?.status);
  const Icon = cfg.icon;
  const showChapters = normalizedEntry?.media_type === 'manga' && normalizedEntry?.chapters;
  const isProviderBacked = isProviderBackedMedia(normalizedEntry);
  const highlightTags = getMediaCardHighlightTags(normalizedEntry);

  if (!normalizedEntry) return null;

  return (
    <div onClick={() => onClick(normalizedEntry)}
      className={cn("rounded-2xl bg-card border border-border/50 hover:border-primary/30 transition-all cursor-pointer group overflow-hidden", className)}>
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-secondary/30 overflow-hidden">
        {normalizedEntry.poster_url ? (
          <img src={normalizedEntry.poster_url} alt={normalizedEntry.title}
            loading="lazy"
            decoding="async"
            width="320"
            height="480"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon className={cn('w-8 h-8', cfg.color)} />
          </div>
        )}
        {onDelete && (
          <button
            type="button"
            aria-label="Delete media"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm("Are you sure you want to completely delete this media?")) {
                onDelete(normalizedEntry.id);
              }
            }}
            className="absolute right-2 top-10 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-500/15 bg-black/55 text-red-400/80 backdrop-blur-sm transition-colors hover:bg-red-500/20 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Top gradient for badge visibility */}
        <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/80 to-transparent pointer-events-none" />
        {/* Type badge */}
        <div className={cn('absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', cfg.bg, cfg.color)}>
          <Icon className="w-2.5 h-2.5" />
          {cfg.label}
        </div>
        {!isProviderBacked && (
          <div className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-amber-200">
            Manual
          </div>
        )}
        {/* Rating overlay */}
        {entry.rating > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-amber-400 text-[11px] font-bold">
            <Star className="w-2.5 h-2.5 fill-amber-400" />
            {entry.rating}
          </div>
        )}
        {/* Bottom overlay: genres + type-specific info */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-6 pb-2 px-2 flex flex-wrap gap-1 items-end">
          {highlightTags.map((tag) => (
            <span
              key={`${normalizedEntry.id || normalizedEntry.title}-${tag.label}`}
              className={cn(
                'text-[9px] px-1.5 py-0.5 rounded-full backdrop-blur-sm font-medium leading-none truncate max-w-[88px]',
                TAG_TONE_CLASSES[tag.tone] || TAG_TONE_CLASSES.neutral,
              )}
            >
              {tag.label}
            </span>
          ))}
        </div>
      </div>
      {/* Info */}
      <div className="p-3">
        <p className="text-sm font-semibold truncate">{normalizedEntry.title}</p>
        <div className="flex items-center justify-between mt-1.5">
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', statusColor)}>
            {statusLabel}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {normalizedEntry.media_type === 'series' && normalizedEntry.seasons_watched
              ? `S${normalizedEntry.seasons_watched === 'all' ? '✓' : normalizedEntry.seasons_watched}${normalizedEntry.seasons_total ? `/${normalizedEntry.seasons_total}` : ''}`
              : normalizedEntry.year_consumed || ''}
          </span>
        </div>
        {showChapters && normalizedEntry.status === 'in_progress' && (
          <div className="mt-2">
            <div className="h-1 bg-secondary/60 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full"
                style={{ width: `${Math.min(100, ((normalizedEntry.chapters_read || 0) / normalizedEntry.chapters) * 100)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {normalizedEntry.chapters_read || 0}/{normalizedEntry.chapters} ch
            </p>
          </div>
        )}
        {normalizedEntry.episodes > 0 && normalizedEntry.status === 'in_progress' && !showChapters && (
          <div className="mt-2">
            <div className="h-1 bg-secondary/60 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full"
                style={{ width: `${Math.min(100, ((normalizedEntry.episodes_watched || 0) / normalizedEntry.episodes) * 100)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {normalizedEntry.episodes_watched || 0}/{normalizedEntry.episodes} eps
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(MediaCard);
