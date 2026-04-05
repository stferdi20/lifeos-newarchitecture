import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Loader2, Film, Tv, Sword, BookOpen, Gamepad2, BookMarked, Layers, AlertTriangle, Sparkles, BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getMediaTypeHealthMessage, searchMediaByType } from './searchMedia';
import { enrichMediaEntry } from './enrichMedia';
import {
  getMediaDuplicateLabel,
  getMediaDuplicateMatch,
  getPreferredPlayedOn,
  mergeProviderMediaFields,
  needsMediaReenrichment,
  normalizeMediaEntry,
  normalizeMediaEntries,
} from './mediaUtils';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';
import { MediaEntry } from '@/lib/media-api';
import { toast } from 'sonner';

const MEDIA_TYPES = [
  { key: 'movie',  label: 'Movie',   icon: Film,      color: 'text-blue-400' },
  { key: 'series', label: 'Series',  icon: Tv,        color: 'text-purple-400' },
  { key: 'anime',  label: 'Anime',   icon: Sword,     color: 'text-pink-400' },
  { key: 'manga',  label: 'Manga',   icon: BookOpen,  color: 'text-red-400' },
  { key: 'comic',  label: 'Comic',   icon: Layers,    color: 'text-yellow-400' },
  { key: 'book',   label: 'Book',    icon: BookMarked,color: 'text-emerald-400' },
  { key: 'game',   label: 'Game',    icon: Gamepad2,  color: 'text-cyan-400' },
];

function getActionError(error, fallbackMessage) {
  return error instanceof Error ? error.message : fallbackMessage;
}

export default function MediaSearchModal({
  open,
  onClose,
  onCreated,
  mediaHealth = null,
  existingEntries = [],
  onOpenExisting,
}) {
  const [activeType, setActiveType] = useState('movie');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [savingKey, setSavingKey] = useState('');
  const [actionError, setActionError] = useState('');
  const [pendingFallbackEntry, setPendingFallbackEntry] = useState(null);
  const requestIdRef = useRef(0);
  const backendHealthMessage = getMediaTypeHealthMessage(activeType, mediaHealth);
  const normalizedExistingEntries = useMemo(() => normalizeMediaEntries(existingEntries), [existingEntries]);

  const getDuplicateMatch = (entry) => getMediaDuplicateMatch(entry, normalizedExistingEntries);

  const handleQueryChange = (val) => {
    setQuery(val);
  };

  const handleTypeChange = (type) => {
    setActiveType(type);
    setResults([]);
    setErrorMessage('');
    setActionError('');
    setPendingFallbackEntry(null);
    setManualMode(false);
  };

  const handleClose = () => {
    setQuery('');
    setResults([]);
    setErrorMessage('');
    setActionError('');
    setPendingFallbackEntry(null);
    setManualMode(false);
    setManualTitle('');
    setSavingKey('');
    requestIdRef.current += 1;
    onClose();
  };

  const resetAfterCreate = () => {
    setQuery('');
    setResults([]);
    setErrorMessage('');
    setActionError('');
    setPendingFallbackEntry(null);
    setManualMode(false);
    setManualTitle('');
    setSavingKey('');
    requestIdRef.current += 1;
  };

  const openDuplicateEntry = (entry) => {
    if (!entry) return;
    onOpenExisting?.(entry);
    handleClose();
  };

  const handleManualAdd = async () => {
    if (!manualTitle.trim()) return;

    const manualEntry = normalizeMediaEntry({
      title: manualTitle.trim(),
      media_type: activeType,
      status: 'plan_to_watch',
      year_consumed: new Date().getFullYear(),
    });
    const duplicateMatch = getDuplicateMatch(manualEntry);
    if (duplicateMatch?.entry) {
      toast.info('That title is already saved. Opening the existing entry.');
      openDuplicateEntry(duplicateMatch.entry);
      return;
    }

    setSavingKey(`manual:${activeType}`);
    setActionError('');

    try {
      const created = await MediaEntry.create(manualEntry);

      if (created?.deduped) {
        toast.info('That title was already saved. Opening the existing entry.');
        openDuplicateEntry(created);
        return;
      }

      onCreated?.(created);
      toast.success(`Added "${created.title}" as a manual ${activeType} entry.`);
      resetAfterCreate();
    } catch (error) {
      setActionError(getActionError(error, 'Manual media creation failed.'));
    } finally {
      setSavingKey('');
    }
  };

  const createFromSuggestion = async (rawEntry, allowCreateWithoutEnrich = false) => {
    const entry = normalizeMediaEntry({
      ...rawEntry,
      status: 'plan_to_watch',
      year_consumed: new Date().getFullYear(),
    });

    if (!entry) return;

    const saveKey = String(entry.external_id || entry.title || '').trim();
    setSavingKey(saveKey);
    setActionError('');
    setPendingFallbackEntry(null);

    try {
      let nextEntry = entry;
      const shouldAttemptEnrich = entry.external_id && needsMediaReenrichment(entry);

      if (shouldAttemptEnrich) {
        try {
          const enriched = await enrichMediaEntry(entry);
          nextEntry = normalizeMediaEntry(mergeProviderMediaFields(entry, enriched)) || entry;
        } catch (error) {
          if (!allowCreateWithoutEnrich) {
            setPendingFallbackEntry({
              entry,
              errorMessage: getActionError(error, 'Media enrichment failed before save.'),
            });
            return;
          }

          setActionError(`Saved without extra provider details: ${getActionError(error, 'Media enrichment failed before save.')}`);
        }
      }

      if (nextEntry.media_type === 'game' && !nextEntry.played_on) {
        const preferredPlatform = getPreferredPlayedOn(nextEntry);
        if (preferredPlatform) {
          nextEntry = {
            ...nextEntry,
            played_on: preferredPlatform,
          };
        }
      }

      const duplicateMatch = getDuplicateMatch(nextEntry);
      if (duplicateMatch?.entry) {
        toast.info('That media is already saved. Opening the existing entry.');
        openDuplicateEntry(duplicateMatch.entry);
        return;
      }

      const created = await MediaEntry.create(nextEntry);

      if (created?.deduped) {
        toast.info('That media was already saved. Opening the existing entry.');
        openDuplicateEntry(created);
        return;
      }

      onCreated?.(created);
      toast.success(`Added "${created.title}".`);
      resetAfterCreate();
    } catch (error) {
      setActionError(getActionError(error, 'Media creation failed.'));
    } finally {
      setSavingKey('');
    }
  };

  useEffect(() => {
    if (!open) return undefined;

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setLoading(false);
      setResults([]);
      setErrorMessage('');
      return undefined;
    }

    const currentRequestId = ++requestIdRef.current;
    const timer = window.setTimeout(async () => {
      setLoading(true);

      try {
        const nextResults = await searchMediaByType(trimmedQuery, activeType);
        if (requestIdRef.current === currentRequestId) {
          setResults(nextResults);
          setErrorMessage('');
          setActionError('');
        }
      } catch (error) {
        if (requestIdRef.current === currentRequestId) {
          setResults([]);
          setErrorMessage(error instanceof Error ? error.message : 'Media search failed.');
        }
      } finally {
        if (requestIdRef.current === currentRequestId) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeType, open, query]);

  return (
    <ResponsiveModal open={open} onOpenChange={handleClose}>
      <ResponsiveModalContent className="bg-[#161820] border-border max-w-2xl max-h-[85vh] flex flex-col p-0" mobileClassName="bg-[#161820] border-border">
        <ResponsiveModalHeader className="px-4 pt-5 pb-0 sm:px-6">
          <ResponsiveModalTitle>Add Media</ResponsiveModalTitle>
        </ResponsiveModalHeader>

        {/* Type selector */}
        <div className="flex gap-1.5 px-4 pt-4 flex-wrap sm:px-6">
          {MEDIA_TYPES.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} onClick={() => handleTypeChange(t.key)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                  activeType === t.key
                    ? 'bg-primary/20 text-primary border-primary/30'
                    : 'bg-secondary/30 text-muted-foreground border-border/30 hover:bg-secondary/50'
                )}>
                <Icon className={cn('w-3 h-3', activeType === t.key ? 'text-primary' : t.color)} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="px-4 pt-3 sm:px-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={query} onChange={e => handleQueryChange(e.target.value)}
              placeholder={`Search ${MEDIA_TYPES.find(t => t.key === activeType)?.label}...`}
              className="pl-9 bg-secondary/40 border-border/50" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Pick an API suggestion to enrich first and save directly. Manual add is still available when no reliable provider match exists.
          </p>
        </div>

        {/* Loading bar */}
        {loading && (
          <div className="h-0.5 mx-4 rounded-full bg-primary/20 overflow-hidden sm:mx-6">
            <div className="h-full bg-primary animate-pulse w-full" />
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-4 pb-6 pt-3 space-y-2 min-h-[300px] sm:px-6">
          {!loading && backendHealthMessage && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left">
              <p className="text-sm font-medium text-amber-200">Remote media backend issue detected</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-100/80">{backendHealthMessage}</p>
            </div>
          )}
          {loading && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span className="text-xs">Searching...</span>
            </div>
          )}
          {!loading && errorMessage && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-left">
              <p className="text-sm font-medium text-red-300">Search failed</p>
              <p className="mt-1 text-xs leading-relaxed text-red-100/80">{errorMessage}</p>
            </div>
          )}
          {pendingFallbackEntry && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left">
              <div className="flex items-center gap-2 text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-sm font-medium">Enrichment could not finish</p>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-amber-100/80">
                {pendingFallbackEntry.errorMessage}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-amber-100/80">
                You can still save the matched title without the extra provider details, or cancel and try another result.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => createFromSuggestion(pendingFallbackEntry.entry, true)}
                  disabled={Boolean(savingKey)}
                  className="rounded-lg bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
                >
                  Save matched title anyway
                </button>
                <button
                  type="button"
                  onClick={() => setPendingFallbackEntry(null)}
                  disabled={Boolean(savingKey)}
                  className="rounded-lg border border-border/50 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {actionError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-left">
              <p className="text-sm font-medium text-red-300">Save failed</p>
              <p className="mt-1 text-xs leading-relaxed text-red-100/80">{actionError}</p>
            </div>
          )}
          {!loading && !errorMessage && results.length === 0 && query && (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">
                {backendHealthMessage ? 'The current backend did not return searchable results.' : 'No results found.'}
              </p>
              <button onClick={() => { setManualMode(true); setManualTitle(query); }}
                className="mt-2 text-xs text-primary hover:underline">Add manually instead</button>
            </div>
          )}
          {manualMode && (
            <div className="flex gap-2 mb-3">
              <Input value={manualTitle} onChange={e => setManualTitle(e.target.value)}
                placeholder="Enter title manually..."
                className="bg-secondary/40 border-border/50" />
              <button onClick={handleManualAdd} disabled={!manualTitle.trim() || Boolean(savingKey)}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm disabled:opacity-40">
                {savingKey === `manual:${activeType}` ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add'}
              </button>
            </div>
          )}
          {results.map((r, i) => (
            <MediaSearchResultRow
              key={String(r.external_id || r.title || i)}
              result={r}
              duplicateMatch={getDuplicateMatch(r)}
              onAdd={() => createFromSuggestion(r)}
              onOpenExisting={openDuplicateEntry}
              savingKey={savingKey}
            />
          ))}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function MediaSearchResultRow({ result, duplicateMatch, onAdd, onOpenExisting, savingKey }) {
  const isDuplicate = Boolean(duplicateMatch?.entry);
  const actionLabel = isDuplicate ? 'Open saved' : 'Add';
  const actionKey = String(result.external_id || result.title || '');

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/20 hover:bg-secondary/40 transition-colors border border-border/30">
      {result.poster_url ? (
        <img
          src={result.poster_url}
          alt={result.title}
          className="w-10 h-14 object-cover rounded-lg shrink-0 bg-secondary"
        />
      ) : (
        <div className="w-10 h-14 rounded-lg bg-secondary/60 flex items-center justify-center shrink-0">
          <Film className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{result.title}</p>
          {isDuplicate && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-200">
              <BadgeCheck className="h-3 w-3" />
              {getMediaDuplicateLabel(duplicateMatch)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {result.year_released && <span>{result.year_released}</span>}
          {result.studio_author && <span className="ml-2">{result.studio_author}</span>}
          {result.genres?.length > 0 && <span className="ml-2">{result.genres.slice(0, 2).join(', ')}</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={() => (isDuplicate ? onOpenExisting?.(duplicateMatch.entry) : onAdd())}
        disabled={Boolean(savingKey)}
        className={cn(
          'shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50',
          isDuplicate
            ? 'bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
            : 'bg-primary/10 text-primary hover:bg-primary/20',
        )}
      >
        {savingKey === actionKey ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {isDuplicate ? 'Opening' : 'Enriching'}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            {isDuplicate ? <BadgeCheck className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
            {actionLabel}
          </span>
        )}
      </button>
    </div>
  );
}
