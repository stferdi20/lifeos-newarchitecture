import React, { memo, useMemo } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TYPE_CONFIG } from './mediaConfig';
import { normalizeMediaEntries } from './mediaUtils';

function YearlyReview({ entries, year }) {
  const { byType, completedEntries, inProgressEntries, topPick, total } = useMemo(() => {
    const normalizedEntries = normalizeMediaEntries(entries);
    const completed = normalizedEntries.filter(e => e.year_consumed === year && e.status === 'completed');
    const inProgress = normalizedEntries.filter(e => e.year_consumed === year && e.status === 'in_progress');
    const grouped = {};

    [...completed, ...inProgress].forEach((entry) => {
      if (!grouped[entry.media_type]) grouped[entry.media_type] = [];
      grouped[entry.media_type].push(entry);
    });

    const sortedByType = Object.fromEntries(
      Object.entries(grouped).map(([type, list]) => [
        type,
        [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0)),
      ]),
    );

    return {
      completedEntries: completed,
      inProgressEntries: inProgress,
      byType: sortedByType,
      topPick: [...completed].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0],
      total: completed.length + inProgress.length,
    };
  }, [entries, year]);

  if (total === 0) return (
    <div className="text-center py-16 text-muted-foreground text-sm">No media tracked in {year} yet.</div>
  );

  const avgRating = (list) => {
    const rated = list.filter(e => e.rating > 0);
    if (!rated.length) return null;
    return (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1);
  };

  return (
    <div className="space-y-6">
      {/* Year summary */}
      <div className="rounded-2xl bg-gradient-to-br from-violet-600/20 via-fuchsia-600/10 to-transparent border border-white/5 p-6">
        <h2 className="text-2xl font-bold">{year} — Wrapped</h2>
        <p className="text-muted-foreground text-sm mt-1">
          {completedEntries.length} completed{inProgressEntries.length > 0 ? ` · ${inProgressEntries.length} in progress` : ''}
        </p>
        <div className="flex flex-wrap gap-4 mt-4">
          {Object.entries(byType).map(([type, list]) => {
            const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.movie;
            const Icon = cfg.icon;
            return (
              <div key={type} className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border', cfg.bg)}>
                <Icon className={cn('w-4 h-4', cfg.color)} />
                <span className="text-sm font-semibold">{list.length}</span>
                <span className={cn('text-xs', cfg.color)}>{cfg.plural}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top pick */}
      {topPick && topPick.rating > 0 && (
        <div className="rounded-2xl bg-card border border-amber-500/20 p-5 flex gap-4">
          {topPick.poster_url && (
            <img
              src={topPick.poster_url}
              alt={topPick.title}
              loading="lazy"
              decoding="async"
              width="128"
              height="192"
              className="w-16 h-24 object-cover rounded-xl shrink-0"
            />
          )}
          <div>
            <p className="text-[10px] uppercase tracking-widest text-amber-400 mb-1 flex items-center gap-1">
              <Star className="w-3 h-3 fill-amber-400" /> Top Pick of {year}
            </p>
            <p className="text-lg font-bold">{topPick.title}</p>
            <div className="flex items-center gap-1 mt-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <Star key={n} className={cn('w-3.5 h-3.5', n <= topPick.rating ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/20')} />
              ))}
              <span className="text-sm font-bold text-amber-400 ml-1">{topPick.rating}/10</span>
            </div>
            {topPick.notes && <p className="text-xs text-muted-foreground mt-2 italic">"{topPick.notes}"</p>}
          </div>
        </div>
      )}

      {/* By category */}
      {Object.entries(byType).map(([type, list]) => {
        const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.movie;
        const Icon = cfg.icon;
        const avg = avgRating(list);
        return (
          <div key={type}>
            <div className="flex items-center gap-2 mb-3">
              <div className={cn('p-1.5 rounded-lg', cfg.bg)}>
                <Icon className={cn('w-4 h-4', cfg.color)} />
              </div>
              <h3 className="text-sm font-semibold">{cfg.plural}</h3>
              <span className="text-xs text-muted-foreground">
                {list.filter(e => e.status === 'completed').length} completed
                {list.filter(e => e.status === 'in_progress').length > 0 && ` · ${list.filter(e => e.status === 'in_progress').length} ongoing`}
              </span>
              {avg && <span className="text-xs text-amber-400 ml-auto flex items-center gap-1"><Star className="w-3 h-3 fill-amber-400" /> {avg} avg</span>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {list.map(entry => (
                <div key={entry.id} className="rounded-xl overflow-hidden bg-secondary/20 border border-border/30 group">
                  {entry.poster_url ? (
                    <div className="aspect-[2/3] overflow-hidden">
                      <img
                        src={entry.poster_url}
                        alt={entry.title}
                        loading="lazy"
                        decoding="async"
                        width="240"
                        height="360"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="aspect-[2/3] flex items-center justify-center bg-secondary/40">
                      <Icon className={cn('w-6 h-6', cfg.color)} />
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-[11px] font-medium truncate">{entry.title}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      {entry.rating > 0 && (
                        <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                          <Star className="w-2.5 h-2.5 fill-amber-400" />{entry.rating}
                        </span>
                      )}
                      {entry.status === 'in_progress' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400">ongoing</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default memo(YearlyReview);
