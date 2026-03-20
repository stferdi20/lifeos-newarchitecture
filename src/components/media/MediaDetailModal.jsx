import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Star, ExternalLink, Trash2, Clock, Users, Globe, Award, Monitor, BookOpen as BookIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import AutoEnrichBadge from './AutoEnrichBadge';
import { TYPE_CONFIG, getStatusOptions } from './mediaConfig';
import { getMediaProviderLabel, isProviderBackedMedia, normalizeMediaEntry } from './mediaUtils';
import { MobileStickyActions, ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';

export default function MediaDetailModal({ open, onClose, entry, onSave, onDelete }) {
  const [form, setForm] = useState({});
  const [hoverRating, setHoverRating] = useState(0);

  useEffect(() => {
    if (entry) {
      const normalizedEntry = normalizeMediaEntry(entry);
      setForm({ ...normalizedEntry, year_consumed: normalizedEntry?.year_consumed || new Date().getFullYear() });
    }
  }, [entry, open]);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cfg = TYPE_CONFIG[form.media_type] || TYPE_CONFIG.movie;
  const Icon = cfg.icon;
  const statusOptions = getStatusOptions(form.media_type);
  const showEpisodes = ['series', 'anime'].includes(form.media_type);
  const isSeries = form.media_type === 'series';
  const isManga = form.media_type === 'manga';
  const isBook = form.media_type === 'book';
  const isGame = form.media_type === 'game';
  const isReadType = ['manga', 'comic', 'book'].includes(form.media_type);
  const isProviderBacked = isProviderBackedMedia(form);
  const sourceLabel = getMediaProviderLabel(form);
  const peopleLabel = form.media_type === 'comic'
    ? 'Creators'
    : form.media_type === 'book'
      ? 'Authors'
      : 'Cast';
  const themeLabel = form.media_type === 'comic'
    ? 'Characters'
    : form.media_type === 'game'
      ? 'Tags'
      : 'Themes';
  const genreLabel = form.media_type === 'comic'
    ? 'Concepts'
    : 'Genres';

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="bg-[#161820] border-border max-w-2xl max-h-[90vh] overflow-y-auto p-0" mobileClassName="bg-[#161820] border-border">
        <div className="flex flex-col gap-0 sm:flex-row">
          {/* Poster side */}
          <div className="w-full shrink-0 bg-secondary/20 relative sm:w-48">
            {form.poster_url ? (
              <img src={form.poster_url} alt={form.title} className="w-full h-52 object-cover sm:h-full" />
            ) : (
              <div className="flex min-h-[180px] w-full items-center justify-center sm:min-h-[300px]">
                <Icon className={cn('w-12 h-12', cfg.color)} />
              </div>
            )}
          </div>

          {/* Detail side */}
          <div className="flex-1 space-y-4 p-4 sm:p-6">
            {/* Title & type */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={cn('w-4 h-4', cfg.color)} />
                <span className={cn('text-xs font-medium', cfg.color)}>{cfg.label}</span>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  isProviderBacked
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : 'bg-amber-500/10 text-amber-200',
                )}>
                  {isProviderBacked ? `${sourceLabel} match` : 'Manual entry'}
                </span>
                {form.source_url && (
                  <a href={form.source_url} target="_blank" rel="noopener noreferrer"
                    className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
              <Input value={form.title || ''} onChange={e => update('title', e.target.value)}
                className="bg-transparent border-none text-lg font-bold px-0 focus-visible:ring-0 text-foreground" />
              {form.studio_author && <p className="text-xs text-muted-foreground mt-0.5">{form.studio_author}</p>}
              {!isProviderBacked && (
                <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
                  This entry is currently manual, so provider enrichment is limited until it is rematched.
                </p>
              )}
              {!entry?.id && (
                <div className="mt-2">
                  <AutoEnrichBadge
                    entry={form}
                    onEnrich={(enriched) => setForm(f => {
                      const merged = { ...f };
                      for (const [k, v] of Object.entries(enriched)) {
                        if (!merged[k] || (Array.isArray(merged[k]) && merged[k].length === 0)) {
                          merged[k] = v;
                        }
                      }
                      return merged;
                    })}
                  />
                </div>
              )}
            </div>

            {/* Star rating */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Your Rating</p>
              <div className="flex gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <button key={n}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => update('rating', n)}
                    className="transition-transform hover:scale-110">
                    <Star className={cn('w-5 h-5', n <= (hoverRating || form.rating || 0)
                      ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30')} />
                  </button>
                ))}
                {form.rating > 0 && <span className="text-sm font-bold text-amber-400 ml-1">{form.rating}/10</span>}
              </div>
            </div>

            {/* Status & Year */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Status</p>
                <Select value={form.status || 'plan_to_watch'} onValueChange={v => update('status', v)}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Year Consumed</p>
                <Input type="number" value={form.year_consumed || ''} onChange={e => update('year_consumed', parseInt(e.target.value))}
                  className="bg-secondary/40 border-border/50 h-8 text-xs" />
              </div>
            </div>

            {/* Seasons (series) */}
            {isSeries && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Total Seasons</p>
                  <Input type="number" value={form.seasons_total || ''} onChange={e => update('seasons_total', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" placeholder="e.g. 5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Seasons Watched</p>
                  <div className="flex gap-1.5">
                    <Input
                      value={form.seasons_watched === 'all' ? '' : (form.seasons_watched || '')}
                      onChange={e => update('seasons_watched', e.target.value)}
                      disabled={form.seasons_watched === 'all'}
                      className={cn("bg-secondary/40 border-border/50 h-8 text-xs flex-1", form.seasons_watched === 'all' && "opacity-40")}
                      placeholder="e.g. 3"
                      type="number"
                    />
                    <button
                      type="button"
                      onClick={() => update('seasons_watched', form.seasons_watched === 'all' ? '' : 'all')}
                      className={cn(
                        'px-2 py-1 rounded-md text-[10px] font-medium border whitespace-nowrap transition-colors',
                        form.seasons_watched === 'all'
                          ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                          : 'bg-secondary/40 border-border/50 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      All
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Episodes (series/anime) */}
            {showEpisodes && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Episodes Total</p>
                  <Input type="number" value={form.episodes || ''} onChange={e => update('episodes', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Watched</p>
                  <Input type="number" value={form.episodes_watched || ''} onChange={e => update('episodes_watched', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
              </div>
            )}

            {/* Chapters (manga) */}
            {isManga && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Chapters</p>
                  <Input type="number" value={form.chapters || ''} onChange={e => update('chapters', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Read</p>
                  <Input type="number" value={form.chapters_read || ''} onChange={e => update('chapters_read', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Volumes</p>
                  <Input type="number" value={form.volumes || ''} onChange={e => update('volumes', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
              </div>
            )}

            {/* Pages (book) */}
            {isBook && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Pages</p>
                  <Input type="number" value={form.page_count || ''} onChange={e => update('page_count', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Volumes</p>
                  <Input type="number" value={form.volumes || ''} onChange={e => update('volumes', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
              </div>
            )}

            {/* Comic issues */}
            {form.media_type === 'comic' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Issues</p>
                  <Input type="number" value={form.episodes || ''} onChange={e => update('episodes', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Volumes</p>
                  <Input type="number" value={form.volumes || ''} onChange={e => update('volumes', parseInt(e.target.value))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
              </div>
            )}

            {/* Rich metadata section */}
            <div className="space-y-3 pt-1">
              {/* Plot */}
              {form.plot && (
                <div className="bg-secondary/20 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Plot</p>
                  <p className="text-xs text-foreground/80 leading-relaxed">{form.plot}</p>
                </div>
              )}

              {/* Info grid */}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {form.duration && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" /> {form.duration}
                  </span>
                )}
                {form.imdb_rating && (
                  <span className="flex items-center gap-1 text-xs text-amber-400">
                    <Star className="w-3 h-3 fill-amber-400" /> {form.imdb_rating}
                  </span>
                )}
                {form.language && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Globe className="w-3 h-3" /> {form.language}
                  </span>
                )}
                {form.country && (
                  <span className="text-xs text-muted-foreground">{form.country}</span>
                )}
                {form.page_count && !isBook && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <BookIcon className="w-3 h-3" /> {form.page_count} pages
                  </span>
                )}
              </div>

              {/* Cast */}
              {(form.cast || []).length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Users className="w-3 h-3" /> {peopleLabel}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {form.cast.map(c => (
                      <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{c}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Platforms & Played On */}
              {(form.platforms || []).length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Monitor className="w-3 h-3" /> {isGame ? 'Available On' : 'Platforms'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {form.platforms.map(p => (
                      <button key={p} type="button"
                        onClick={() => isGame && update('played_on', form.played_on === p ? '' : p)}
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full transition-colors",
                          isGame && form.played_on === p
                            ? "bg-cyan-500/30 text-cyan-300 ring-1 ring-cyan-400/50"
                            : "bg-cyan-500/10 text-cyan-400",
                          isGame && "cursor-pointer hover:bg-cyan-500/20"
                        )}>
                        {p}
                      </button>
                    ))}
                  </div>
                  {isGame && <p className="text-[9px] text-muted-foreground/60 mt-1">Click a platform to set where you played it</p>}
                </div>
              )}
              {isGame && (form.platforms || []).length === 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Monitor className="w-3 h-3" /> Played On
                  </p>
                  <Input value={form.played_on || ''} onChange={e => update('played_on', e.target.value)}
                    placeholder="e.g. PS5, PC, Switch..."
                    className="bg-secondary/40 border-border/50 h-8 text-xs" />
                </div>
              )}

              {/* Awards */}
              {form.awards && (
                <div className="flex items-start gap-1.5">
                  <Award className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground/80">{form.awards}</p>
                </div>
              )}

              {/* Themes */}
              {(form.themes || []).length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{themeLabel}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {form.themes.map(t => (
                      <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400">{t}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Genres */}
            {form.genres?.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{genreLabel}</p>
                <div className="flex flex-wrap gap-1.5">
                  {form.genres.map(g => (
                    <span key={g} className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{g}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Notes</p>
              <Textarea value={form.notes || ''} onChange={e => update('notes', e.target.value)}
                placeholder="Personal thoughts..."
                className="bg-secondary/30 border-border/50 min-h-[80px] text-sm resize-none" />
            </div>

            {/* Actions */}
            <MobileStickyActions className="flex gap-2 bg-[#161820]/95">
              {entry?.id && (
                <Button variant="ghost" size="sm" onClick={() => onDelete(entry.id)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
              <Button onClick={() => onSave(form)} className="flex-1 bg-primary hover:bg-primary/90 text-white text-sm">
                {entry?.id ? 'Save Changes' : 'Add to Library'}
              </Button>
            </MobileStickyActions>
          </div>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
