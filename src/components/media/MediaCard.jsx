import React, { memo, useState } from 'react';
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
  const [hovered, setHovered] = useState(false);
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
    <div
      onClick={() => onClick(normalizedEntry)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn("rounded-2xl bg-card border border-border/50 hover:border-primary/30 transition-all cursor-pointer overflow-hidden", className)}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-secondary/30 overflow-hidden">
        {normalizedEntry.poster_url ? (
          <img src={normalizedEntry.poster_url} alt={normalizedEntry.title}
            loading="lazy"
            decoding="async"
            width="320"
            height="480"
            className="w-full h-full object-cover transition-transform duration-500"
            style={{ transform: hovered ? 'scale(1.05)' : 'scale(1)' }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center transition-transform duration-500" style={{ transform: hovered ? 'scale(1.05)' : 'scale(1)' }}>
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
            className="absolute right-2 top-10 z-30 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-500/15 bg-black/55 text-red-400/80 backdrop-blur-sm transition-colors hover:bg-red-500/20 hover:text-red-300 opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        {/* Top gradient for badge visibility */}
        <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/80 to-transparent pointer-events-none z-10 transition-opacity duration-300 group-hover:opacity-60" />
        
        {/* Type badge */}
        <div className={cn('absolute top-2 left-2 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium shadow-sm transition-transform duration-300', cfg.bg, cfg.color)}>
          <Icon className="w-2.5 h-2.5" />
          {cfg.label}
        </div>
        
        {!isProviderBacked && (
          <div className="absolute bottom-2 right-2 z-20 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-amber-200 transition-all duration-300 group-hover:opacity-0 group-hover:translate-y-2">
            Manual
          </div>
        )}
        
        {/* Rating overlay */}
        {entry.rating > 0 && (
          <div className="absolute top-2 right-2 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 shadow-sm text-amber-400 text-[11px] font-bold transition-transform duration-300">
            <Star className="w-2.5 h-2.5 fill-amber-400" />
            {entry.rating}
          </div>
        )}
        
        {/* Bottom overlay: genres + type-specific info */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-6 pb-2 px-2 flex flex-wrap gap-1 items-end z-10 transition-all duration-300 group-hover:opacity-0 group-hover:translate-y-full">
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

        {/* Hover Preview Overlay */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/30 backdrop-blur-[2px] flex flex-col p-4 text-white z-50 pointer-events-none transition-opacity duration-300"
          style={{ opacity: hovered ? 1 : 0 }}
        >
          <div className="mt-10 flex-1 flex flex-col justify-center text-center">
            {normalizedEntry.plot ? (
              <p className="text-xs line-clamp-6 leading-relaxed text-gray-200">
                {normalizedEntry.plot}
              </p>
            ) : normalizedEntry.notes ? (
              <p className="text-xs line-clamp-6 leading-relaxed text-gray-300 italic">
                "{normalizedEntry.notes}"
              </p>
            ) : (
              <p className="text-xs text-gray-400 italic">
                No plot or notes.
              </p>
            )}
          </div>
          
          <div className="mt-4 mb-2 shrink-0 text-center pointer-events-auto">
            <span className="inline-flex justify-center w-full text-[10px] uppercase font-bold tracking-widest text-primary border border-primary/20 bg-primary/10 px-4 py-2 rounded-xl">
              View Details
            </span>
          </div>
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
