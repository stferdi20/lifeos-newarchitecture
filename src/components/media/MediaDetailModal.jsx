import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Star, ExternalLink, Trash2, Clock, Users, Globe, Award, Monitor, BookOpen as BookIcon, Loader2, Sparkles } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import AutoEnrichBadge from './AutoEnrichBadge';
import { enrichMediaEntry } from './enrichMedia';
import { TYPE_CONFIG, getStatusOptions } from './mediaConfig';
import {
  getMediaReleaseYearLabel,
  getMediaProviderLabel,
  isProviderBackedMedia,
  mergeProviderMediaFields,
  needsMediaReenrichment,
  normalizeMediaEntry,
} from './mediaUtils';
import { MobileStickyActions, ResponsiveModal, ResponsiveModalContent } from '@/components/ui/responsive-modal';

function uniqueStrings(values = []) {
  if (Array.isArray(values)) {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  }

  const text = String(values || '').trim();
  return text ? [text] : [];
}

function getPrimaryCredit(form = {}) {
  if (form.media_type === 'movie') {
    return {
      label: 'Director',
      value: uniqueStrings(form.director_names || form.studio_author).join(', '),
    };
  }

  if (form.media_type === 'series') {
    return {
      label: form.network ? 'Network' : 'Creators',
      value: form.network || uniqueStrings(form.creator_names || form.studio_author).join(', '),
    };
  }

  if (form.media_type === 'anime') {
    return {
      label: 'Studio',
      value: uniqueStrings(form.creator_names || form.studio_author).join(', '),
    };
  }

  if (form.media_type === 'manga' || form.media_type === 'book') {
    return {
      label: 'Authors',
      value: uniqueStrings(form.author_names || form.creator_names || form.studio_author).join(', '),
    };
  }

  if (form.media_type === 'comic') {
    return {
      label: 'Publisher',
      value: String(form.publisher || form.studio_author || '').trim(),
    };
  }

  if (form.media_type === 'game') {
    return {
      label: 'Developers',
      value: uniqueStrings(form.developer_names || form.studio_author).join(', '),
    };
  }

  return { label: '', value: String(form.studio_author || '').trim() };
}

function getPeopleSection(form = {}) {
  if (form.media_type === 'movie' || form.media_type === 'series') {
    return { label: 'Cast', values: uniqueStrings(form.cast) };
  }
  if (form.media_type === 'anime') {
    return { label: 'Studios', values: uniqueStrings(form.creator_names || form.studio_author) };
  }
  if (form.media_type === 'manga' || form.media_type === 'book') {
    return { label: 'Authors', values: uniqueStrings(form.author_names || form.creator_names || form.studio_author) };
  }
  if (form.media_type === 'comic') {
    return { label: 'Creators', values: uniqueStrings(form.creator_names || form.cast) };
  }
  if (form.media_type === 'game') {
    return { label: 'Developers', values: uniqueStrings(form.developer_names || form.studio_author) };
  }
  return { label: 'People', values: uniqueStrings(form.cast) };
}

function getSecondarySections(form = {}) {
  if (form.media_type === 'comic') {
    return [
      { label: 'Characters', values: uniqueStrings(form.character_names || form.themes), tone: 'violet' },
      { label: 'Concepts', values: uniqueStrings(form.concept_names || form.genres), tone: 'secondary' },
    ];
  }

  if (form.media_type === 'game') {
    return [{ label: 'Tags', values: uniqueStrings(form.themes), tone: 'violet' }];
  }

  if (form.media_type === 'anime' || form.media_type === 'manga') {
    return [{ label: 'Themes', values: uniqueStrings(form.themes), tone: 'violet' }];
  }

  return [
    { label: 'Themes', values: uniqueStrings(form.themes), tone: 'violet' },
    { label: 'Genres', values: uniqueStrings(form.genres), tone: 'secondary' },
  ];
}

export default function MediaDetailModal({ open, onClose, entry, onSave, onDelete }) {
  const [form, setForm] = useState({});
  const [hoverRating, setHoverRating] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveTimerRef = useRef(null);
  const isFlushingSaveRef = useRef(false);
  const lastSavedSnapshotRef = useRef('');
  const pendingCloseRef = useRef(false);

  useEffect(() => {
    if (entry) {
      const normalizedEntry = normalizeMediaEntry(entry);
      setForm({ ...normalizedEntry, year_consumed: normalizedEntry?.year_consumed || new Date().getFullYear() });
      setRefreshError('');
      setRefreshing(false);
      setSaveError('');
      setSaving(false);
      lastSavedSnapshotRef.current = JSON.stringify(normalizedEntry || {});
      pendingCloseRef.current = false;
    }
  }, [entry, open]);

  useEffect(() => () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
  }, []);

  const persistForm = async (nextForm) => {
    if (!nextForm?.id || typeof onSave !== 'function') return;

    const snapshot = JSON.stringify(nextForm);
    if (snapshot === lastSavedSnapshotRef.current) return;

    setSaving(true);
    setSaveError('');

    try {
      await onSave(nextForm);
      lastSavedSnapshotRef.current = snapshot;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save media changes.');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const queueAutosave = (nextForm) => {
    if (!nextForm?.id) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistForm(nextForm);
    }, 500);
  };

  const flushAutosave = async (nextForm = form) => {
    if (!nextForm?.id) return;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (isFlushingSaveRef.current) return;
    isFlushingSaveRef.current = true;

    try {
      await persistForm(nextForm);
    } finally {
      isFlushingSaveRef.current = false;
    }
  };

  const handleClose = async () => {
    pendingCloseRef.current = true;
    try {
      await flushAutosave();
    } finally {
      pendingCloseRef.current = false;
      onClose?.();
    }
  };

  const update = (key, value) => {
    setForm((current) => {
      const nextForm = { ...current, [key]: value };
      queueAutosave(nextForm);
      return nextForm;
    });
  };
  const cfg = TYPE_CONFIG[form.media_type] || TYPE_CONFIG.movie;
  const Icon = cfg.icon;
  const statusOptions = getStatusOptions(form.media_type);
  const showEpisodes = ['series', 'anime'].includes(form.media_type);
  const isSeries = form.media_type === 'series';
  const isManga = form.media_type === 'manga';
  const isBook = form.media_type === 'book';
  const isGame = form.media_type === 'game';
  const isProviderBacked = isProviderBackedMedia(form);
  const sourceLabel = getMediaProviderLabel(form);
  const releaseYearLabel = getMediaReleaseYearLabel(form);
  const primaryCredit = getPrimaryCredit(form);
  const peopleSection = getPeopleSection(form);
  const secondarySections = getSecondarySections(form);
  const shouldShowRefresh = Boolean(entry?.id) && isProviderBacked && needsMediaReenrichment(form);

  const handleRefreshProviderDetails = async () => {
    if (!isProviderBacked || refreshing) return;
    setRefreshing(true);
    setRefreshError('');

    try {
      const enriched = await enrichMediaEntry(form);
      setForm((current) => normalizeMediaEntry(mergeProviderMediaFields(current, enriched)) || current);
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Provider refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!open || !entry?.id) return;

    return () => {
      if (pendingCloseRef.current) return;
      void flushAutosave();
    };
  }, [entry?.id, open]);

  const updateComicIssues = (value) => {
    update('issues_total', value);
    update('episodes', value);
  };

  return (
    <ResponsiveModal open={open} onOpenChange={(isOpen) => {
      if (isOpen) return;
      void handleClose();
    }}>
      <ResponsiveModalContent className="bg-[#161820] border-border max-w-2xl max-h-[90vh] overflow-y-auto p-0" mobileClassName="bg-[#161820] border-border">
        <div className="flex flex-col gap-0 sm:flex-row">
          <div className="w-full shrink-0 bg-secondary/20 relative sm:w-48">
            {form.poster_url ? (
              <img src={form.poster_url} alt={form.title} className="w-full h-52 object-cover sm:h-full" />
            ) : (
              <div className="flex min-h-[180px] w-full items-center justify-center sm:min-h-[300px]">
                <Icon className={cn('w-12 h-12', cfg.color)} />
              </div>
            )}
          </div>

          <div className="flex-1 space-y-4 p-4 sm:p-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Icon className={cn('w-4 h-4', cfg.color)} />
                <span className={cn('text-xs font-medium', cfg.color)}>{cfg.label}</span>
                {releaseYearLabel && (
                  <span className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/80">
                    {releaseYearLabel}
                  </span>
                )}
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    isProviderBacked ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200',
                  )}
                >
                  {isProviderBacked ? `${sourceLabel} match` : 'Manual entry'}
                </span>
                {form.source_url && (
                  <a
                    href={form.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>

              <Input
                value={form.title || ''}
                onChange={(event) => update('title', event.target.value)}
                className="bg-transparent border-none text-lg font-bold px-0 focus-visible:ring-0 text-foreground"
              />
              {primaryCredit.value && <p className="text-xs text-muted-foreground mt-0.5">{primaryCredit.value}</p>}
              {!isProviderBacked && (
                <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
                  This entry is currently manual, so provider enrichment is limited until it is rematched.
                </p>
              )}
              {refreshError && <p className="mt-2 text-xs leading-relaxed text-red-300/80">{refreshError}</p>}
              {!entry?.id && (
                <div className="mt-2">
                  <AutoEnrichBadge
                    entry={form}
                    onEnrich={(enriched) => setForm((current) => normalizeMediaEntry(mergeProviderMediaFields(current, enriched)) || current)}
                  />
                </div>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Your Rating</p>
              <div className="flex gap-1">
                {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
                  <button
                    key={value}
                    onMouseEnter={() => setHoverRating(value)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => update('rating', value)}
                    className="transition-transform hover:scale-110"
                  >
                    <Star
                      className={cn(
                        'w-5 h-5',
                        value <= (hoverRating || form.rating || 0) ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30',
                      )}
                    />
                  </button>
                ))}
                {form.rating > 0 && <span className="text-sm font-bold text-amber-400 ml-1">{form.rating}/10</span>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Status</p>
                <Select value={form.status || 'plan_to_watch'} onValueChange={(value) => update('status', value)}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Year Consumed</p>
                <Input
                  type="number"
                  value={form.year_consumed || ''}
                  onChange={(event) => update('year_consumed', parseInt(event.target.value, 10))}
                  className="bg-secondary/40 border-border/50 h-8 text-xs"
                />
              </div>
            </div>

            {isSeries && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Total Seasons</p>
                  <Input
                    type="number"
                    value={form.seasons_total || ''}
                    onChange={(event) => update('seasons_total', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                    placeholder="e.g. 5"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Seasons Watched</p>
                  <div className="flex gap-1.5">
                    <Input
                      value={form.seasons_watched === 'all' ? '' : (form.seasons_watched || '')}
                      onChange={(event) => update('seasons_watched', event.target.value)}
                      disabled={form.seasons_watched === 'all'}
                      className={cn('bg-secondary/40 border-border/50 h-8 text-xs flex-1', form.seasons_watched === 'all' && 'opacity-40')}
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
                          : 'bg-secondary/40 border-border/50 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      All
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showEpisodes && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Episodes Total</p>
                  <Input
                    type="number"
                    value={form.episodes || ''}
                    onChange={(event) => update('episodes', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Watched</p>
                  <Input
                    type="number"
                    value={form.episodes_watched || ''}
                    onChange={(event) => update('episodes_watched', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
              </div>
            )}

            {isManga && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Chapters</p>
                  <Input
                    type="number"
                    value={form.chapters || ''}
                    onChange={(event) => update('chapters', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Read</p>
                  <Input
                    type="number"
                    value={form.chapters_read || ''}
                    onChange={(event) => update('chapters_read', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Volumes</p>
                  <Input
                    type="number"
                    value={form.volumes || ''}
                    onChange={(event) => update('volumes', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
              </div>
            )}

            {isBook && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Pages</p>
                  <Input
                    type="number"
                    value={form.page_count || ''}
                    onChange={(event) => update('page_count', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Volumes</p>
                  <Input
                    type="number"
                    value={form.volumes || ''}
                    onChange={(event) => update('volumes', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
              </div>
            )}

            {form.media_type === 'comic' && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Issues</p>
                  <Input
                    type="number"
                    value={form.issues_total || form.episodes || ''}
                    onChange={(event) => updateComicIssues(parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Volumes</p>
                  <Input
                    type="number"
                    value={form.volumes || ''}
                    onChange={(event) => update('volumes', parseInt(event.target.value, 10))}
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="space-y-3 pt-1">
              {form.plot && (
                <div className="bg-secondary/20 rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Plot</p>
                  <p className="text-xs text-foreground/80 leading-relaxed">{form.plot}</p>
                </div>
              )}

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
                {form.country && <span className="text-xs text-muted-foreground">{form.country}</span>}
                {form.network && <span className="text-xs text-muted-foreground">{form.network}</span>}
                {form.publisher && form.media_type === 'comic' && <span className="text-xs text-muted-foreground">{form.publisher}</span>}
                {form.page_count && !isBook && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <BookIcon className="w-3 h-3" /> {form.page_count} pages
                  </span>
                )}
              </div>

              {peopleSection.values.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Users className="w-3 h-3" /> {peopleSection.label}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {peopleSection.values.map((value) => (
                      <span key={value} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">{value}</span>
                    ))}
                  </div>
                </div>
              )}

              {(form.platforms || []).length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Monitor className="w-3 h-3" /> {isGame ? 'Available On' : 'Platforms'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {form.platforms.map((platform) => (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => isGame && update('played_on', form.played_on === platform ? '' : platform)}
                        className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full transition-colors',
                          isGame && form.played_on === platform
                            ? 'bg-cyan-500/30 text-cyan-300 ring-1 ring-cyan-400/50'
                            : 'bg-cyan-500/10 text-cyan-400',
                          isGame && 'cursor-pointer hover:bg-cyan-500/20',
                        )}
                      >
                        {platform}
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
                  <Input
                    value={form.played_on || ''}
                    onChange={(event) => update('played_on', event.target.value)}
                    placeholder="e.g. PS5, PC, Switch..."
                    className="bg-secondary/40 border-border/50 h-8 text-xs"
                  />
                </div>
              )}

              {form.awards && (
                <div className="flex items-start gap-1.5">
                  <Award className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground/80">{form.awards}</p>
                </div>
              )}

              {secondarySections
                .filter((section) => section.values.length > 0)
                .map((section) => (
                  <div key={section.label}>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{section.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {section.values.map((value) => (
                        <span
                          key={`${section.label}-${value}`}
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full',
                            section.tone === 'violet'
                              ? 'bg-violet-500/10 text-violet-400'
                              : 'bg-secondary text-muted-foreground',
                          )}
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">Notes</p>
              <Textarea
                value={form.notes || ''}
                onChange={(event) => update('notes', event.target.value)}
                placeholder="Personal thoughts..."
                className="bg-secondary/30 border-border/50 min-h-[80px] text-sm resize-none"
              />
            </div>

            {saveError && (
              <p className="text-xs leading-relaxed text-red-300/80">{saveError}</p>
            )}

            <MobileStickyActions className="flex gap-2 bg-[#161820]/95">
              {shouldShowRefresh && (
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={handleRefreshProviderDetails}
                          disabled={refreshing}
                          aria-label="Refresh provider details"
                          title="Refresh provider details"
                          className="h-9 w-9 text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
                        >
                          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Refresh provider details</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              {entry?.id && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(entry.id)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              {entry?.id ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleClose()}
                  disabled={saving}
                  className="flex-1 border-border/60 bg-secondary/20 text-sm"
                >
                  {saving ? 'Saving...' : 'Done'}
                </Button>
              ) : (
                <Button onClick={() => onSave(form)} className="flex-1 bg-primary hover:bg-primary/90 text-white text-sm">
                  Add to Library
                </Button>
              )}
            </MobileStickyActions>
          </div>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
