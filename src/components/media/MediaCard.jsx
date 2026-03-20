import React, { memo } from 'react';
import { cn } from '@/lib/utils';
import { Star } from 'lucide-react';
import { TYPE_CONFIG, STATUS_COLORS, getStatusLabel } from './mediaConfig';
import { isProviderBackedMedia, normalizeMediaEntry } from './mediaUtils';

function MediaCard({ entry, onClick, className }) {
  const normalizedEntry = normalizeMediaEntry(entry);
  const cfg = TYPE_CONFIG[normalizedEntry?.media_type] || TYPE_CONFIG.movie;
  const statusColor = STATUS_COLORS[normalizedEntry?.status] || STATUS_COLORS.plan_to_watch;
  const statusLabel = getStatusLabel(normalizedEntry?.media_type, normalizedEntry?.status);
  const Icon = cfg.icon;
  const showChapters = normalizedEntry?.media_type === 'manga' && normalizedEntry?.chapters;
  const isProviderBacked = isProviderBackedMedia(normalizedEntry);

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
          {normalizedEntry.genres.slice(0, normalizedEntry.media_type === 'comic' ? 2 : 3).map(g => (
            <span key={g} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/15 text-white/90 backdrop-blur-sm font-medium leading-none">{g}</span>
          ))}
          {normalizedEntry.media_type === 'movie' && normalizedEntry.studio_author && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/30 text-blue-200 font-medium leading-none truncate max-w-[80px]">{normalizedEntry.studio_author}</span>
          )}
          {normalizedEntry.media_type === 'movie' && normalizedEntry.cast.slice(0, 2).map(c => (
            <span key={c} className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/25 text-indigo-200 font-medium leading-none truncate max-w-[70px]">{c}</span>
          ))}
          {normalizedEntry.media_type === 'game' && normalizedEntry.played_on && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/30 text-cyan-200 font-medium leading-none">{normalizedEntry.played_on}</span>
          )}
          {normalizedEntry.media_type === 'game' && !normalizedEntry.played_on && normalizedEntry.platforms.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/30 text-cyan-200 font-medium leading-none">{normalizedEntry.platforms[0]}</span>
          )}
          {normalizedEntry.media_type === 'series' && normalizedEntry.seasons_total && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/30 text-purple-200 font-medium leading-none">{normalizedEntry.seasons_total} season{normalizedEntry.seasons_total !== 1 ? 's' : ''}</span>
          )}
          {normalizedEntry.media_type === 'anime' && normalizedEntry.seasons_total > 1 ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-pink-500/30 text-pink-200 font-medium leading-none">{normalizedEntry.seasons_total} seasons</span>
          ) : normalizedEntry.media_type === 'anime' && normalizedEntry.episodes > 0 ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-pink-500/30 text-pink-200 font-medium leading-none">{normalizedEntry.episodes} eps</span>
          ) : null}
          {['manga', 'comic', 'book'].includes(normalizedEntry.media_type) && normalizedEntry.studio_author && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-500/25 text-orange-200 font-medium leading-none truncate max-w-[90px]">{normalizedEntry.studio_author}</span>
          )}
          {normalizedEntry.media_type === 'manga' && normalizedEntry.chapters > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/30 text-red-200 font-medium leading-none">{normalizedEntry.chapters} ch</span>
          )}
          {normalizedEntry.media_type === 'book' && normalizedEntry.page_count > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 font-medium leading-none">{normalizedEntry.page_count}p</span>
          )}
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
