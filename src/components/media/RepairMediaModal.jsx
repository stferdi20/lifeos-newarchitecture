import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, SearchCheck, Sparkles, Wrench, CheckCircle2, XCircle, AlertTriangle, ArrowRight, SkipForward } from 'lucide-react';
import { MediaEntry } from '@/lib/media-api';
import { cn } from '@/lib/utils';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';
import { resolveBulkMediaMatch } from './searchMedia';
import { enrichMediaEntry } from './enrichMedia';
import { hasEnoughMediaMetadata, isRepairableMediaEntry, mergeDefinedMediaFields, normalizeMediaEntries } from './mediaUtils';

const REPAIR_CONCURRENCY = 4;
const MEDIA_ENTRY_FIELDS = [
  'id',
  'title',
  'media_type',
  'status',
  'year_consumed',
  'poster_url',
  'rating',
  'genres',
  'studio_author',
  'cast',
  'played_on',
  'platforms',
  'seasons_total',
  'episodes',
  'chapters',
  'page_count',
  'episodes_watched',
  'chapters_read',
  'seasons_watched',
  'notes',
  'external_id',
  'source_url',
  'plot',
  'duration',
  'language',
  'country',
  'imdb_rating',
  'awards',
  'themes',
  'volumes',
];

async function runWithConcurrency(items, worker, concurrency = REPAIR_CONCURRENCY) {
  const queue = [...items];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      await worker(next);
    }
  });

  await Promise.all(workers);
}

export default function RepairMediaModal({ open, onClose, onRepaired }) {
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [phase, setPhase] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [results, setResults] = useState([]);

  const reviewItems = useMemo(
    () => results.filter((result) => result.status === 'review'),
    [results],
  );
  const canSubmitReview = reviewItems.length > 0 && reviewItems.every((item) => item.selectedChoice);
  const successCount = results.filter((result) => result.status === 'success').length;
  const failedCount = results.filter((result) => result.status === 'error').length;
  const skippedCount = results.filter((result) => result.status === 'skipped').length;
  const allDone = results.length > 0 && results.every((result) => (
    result.status === 'success' || result.status === 'error' || result.status === 'skipped'
  ));

  const updateResultAt = (index, updater) => {
    setResults((prev) => prev.map((result, resultIndex) => (
      resultIndex === index ? updater(result) : result
    )));
  };

  const loadRepairableEntries = async () => {
    setLoadingEntries(true);
    setLoadError('');
    setResults([]);
    setPhase('loading');

    try {
      const rows = await MediaEntry.list('-created_date', 5000, 0, MEDIA_ENTRY_FIELDS);
      const repairable = normalizeMediaEntries(rows).filter(isRepairableMediaEntry);

      setResults(repairable.map((entry) => ({
        entryId: entry.id,
        inputTitle: entry.title,
        title: entry.title,
        mediaType: entry.media_type,
        currentEntry: entry,
        status: 'pending',
        decision: '',
        confidence: 0,
        bestCandidate: null,
        reason: '',
        errorMessage: '',
        selectedChoice: null,
        finalEntry: null,
      })));
      setPhase(repairable.length > 0 ? 'ready' : 'empty');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Media repair scan failed.');
      setPhase('error');
    } finally {
      setLoadingEntries(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadRepairableEntries();
  }, [open]);

  const applyRepairUpdate = async (index, entry) => {
    let nextEntry = entry;

    try {
      const shouldEnrich = Boolean(nextEntry.external_id) && !hasEnoughMediaMetadata(nextEntry);

      if (shouldEnrich) {
        updateResultAt(index, (result) => ({ ...result, status: 'enriching', errorMessage: '' }));
        const enriched = await enrichMediaEntry(nextEntry);
        if (Object.keys(enriched).length === 0 && !hasEnoughMediaMetadata(nextEntry)) {
          throw new Error('Provider returned no additional media details.');
        }
        nextEntry = mergeDefinedMediaFields(nextEntry, enriched);
      }

      updateResultAt(index, (result) => ({ ...result, status: 'saving', finalEntry: nextEntry, errorMessage: '' }));
      await MediaEntry.update(nextEntry.id, nextEntry);

      updateResultAt(index, (result) => ({
        ...result,
        title: nextEntry.title,
        status: 'success',
        currentEntry: nextEntry,
        finalEntry: nextEntry,
        errorMessage: '',
      }));

      return true;
    } catch (error) {
      updateResultAt(index, (result) => ({
        ...result,
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Media repair failed.',
      }));
      return false;
    }
  };

  const resolveAndRepairItems = async (items) => {
    let repairedCount = 0;
    let reviewCount = 0;

    await runWithConcurrency(items, async ({ index, currentEntry, inputTitle, mediaType }) => {
      if (currentEntry.external_id) {
        const success = await applyRepairUpdate(index, currentEntry);
        if (success) repairedCount += 1;
        return;
      }

      updateResultAt(index, (result) => ({
        ...result,
        status: 'loading',
        errorMessage: '',
        reason: '',
        selectedChoice: null,
        finalEntry: null,
      }));

      try {
        const resolution = await resolveBulkMediaMatch(inputTitle, mediaType);

        if (resolution.lookupFailed) {
          updateResultAt(index, (result) => ({
            ...result,
            status: 'error',
            errorMessage: resolution.reason,
            reason: resolution.reason,
          }));
          return;
        }

        if (resolution.decision === 'auto_accept' && resolution.match) {
          const matchedEntry = mergeDefinedMediaFields(currentEntry, resolution.match);
          const success = await applyRepairUpdate(index, matchedEntry);
          if (success) repairedCount += 1;
          return;
        }

        if (resolution.decision === 'needs_review' && resolution.bestCandidate) {
          reviewCount += 1;
          updateResultAt(index, (result) => ({
            ...result,
            status: 'review',
            decision: resolution.decision,
            confidence: resolution.confidence,
            bestCandidate: resolution.bestCandidate,
            reason: resolution.reason,
            selectedChoice: null,
            finalEntry: null,
            errorMessage: '',
          }));
          return;
        }

        updateResultAt(index, (result) => ({
          ...result,
          status: 'error',
          decision: 'no_match',
          confidence: resolution.confidence,
          bestCandidate: resolution.bestCandidate,
          reason: resolution.reason,
          errorMessage: resolution.reason || 'No provider match was found for this entry.',
        }));
      } catch (error) {
        updateResultAt(index, (result) => ({
          ...result,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Media repair lookup failed.',
        }));
      }
    });

    return { repairedCount, reviewCount };
  };

  const handleStartRepair = async () => {
    if (results.length === 0) return;

    setProcessing(true);
    setPhase('processing');

    try {
      const pendingItems = results.map((result, index) => ({ index, ...result }));
      const { repairedCount, reviewCount } = await resolveAndRepairItems(pendingItems);

      if (repairedCount > 0) {
        onRepaired?.();
      }

      setPhase(reviewCount > 0 ? 'review' : 'complete');
    } finally {
      setProcessing(false);
    }
  };

  const chooseReviewAction = (index, choice) => {
    updateResultAt(index, (result) => ({
      ...result,
      selectedChoice: choice,
      finalEntry: choice === 'api' && result.bestCandidate
        ? mergeDefinedMediaFields(result.currentEntry, result.bestCandidate)
        : null,
    }));
  };

  const handleReviewSubmit = async () => {
    if (!canSubmitReview) return;

    setProcessing(true);
    setPhase('saving-review');

    try {
      let repairedCount = 0;

      await runWithConcurrency(
        results.map((result, index) => ({ index, ...result })).filter((result) => result.status === 'review'),
        async ({ index, selectedChoice, finalEntry }) => {
          if (selectedChoice === 'skip') {
            updateResultAt(index, (result) => ({
              ...result,
              status: 'skipped',
              errorMessage: 'Skipped for now.',
            }));
            return;
          }

          if (!finalEntry) {
            updateResultAt(index, (result) => ({
              ...result,
              status: 'error',
              errorMessage: 'No review choice was applied.',
            }));
            return;
          }

          const success = await applyRepairUpdate(index, finalEntry);
          if (success) repairedCount += 1;
        },
      );

      if (repairedCount > 0) {
        onRepaired?.();
      }
    } finally {
      setProcessing(false);
      setPhase('complete');
    }
  };

  const handleRetryFailed = async () => {
    const failedItems = results
      .map((result, index) => (result.status === 'error' ? { index, ...result } : null))
      .filter(Boolean);

    if (failedItems.length === 0) return;

    setProcessing(true);
    setPhase('processing');

    try {
      const { repairedCount, reviewCount } = await resolveAndRepairItems(failedItems);

      if (repairedCount > 0) {
        onRepaired?.();
      }

      setPhase(reviewCount > 0 ? 'review' : 'complete');
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = () => {
    if (processing || loadingEntries) return;
    setResults([]);
    setLoadError('');
    setPhase('loading');
    onClose();
  };

  return (
    <ResponsiveModal open={open} onOpenChange={handleClose}>
      <ResponsiveModalContent className="bg-[#161820] border-border max-w-3xl max-h-[85vh] overflow-y-auto" mobileClassName="bg-[#161820] border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-amber-300" />
            Repair Media
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Scan existing entries that are manual or still missing core metadata, rematch them to the right provider for their media type, and enrich before updating.
          </p>

          {loadingEntries && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-border/40 bg-secondary/20 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Scanning your library for repairable entries...
            </div>
          )}

          {!loadingEntries && loadError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
              <p className="text-sm font-medium text-red-300">Repair scan failed</p>
              <p className="mt-1 text-xs leading-relaxed text-red-100/80">{loadError}</p>
            </div>
          )}

          {!loadingEntries && phase === 'empty' && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-8 text-center">
              <p className="text-sm font-medium text-emerald-200">Nothing needs repair right now.</p>
              <p className="mt-1 text-xs text-emerald-100/70">
                Every media entry already has a provider link or enough metadata.
              </p>
            </div>
          )}

          {!loadingEntries && results.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {results.length} repairable entr{results.length === 1 ? 'y' : 'ies'} found
                </span>
                <div className="flex items-center gap-2">
                  {phase === 'ready' && (
                    <Button onClick={handleStartRepair} disabled={processing}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Run repair
                    </Button>
                  )}
                  {failedCount > 0 && phase === 'complete' && (
                    <Button onClick={handleRetryFailed} variant="outline" className="border-border" disabled={processing}>
                      Retry failed
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {results.map((result, index) => (
                  <div
                    key={result.entryId}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-sm',
                      result.status === 'success' && 'border-emerald-500/20 bg-emerald-500/5',
                      result.status === 'error' && 'border-red-500/20 bg-red-500/5',
                      result.status === 'skipped' && 'border-border/40 bg-secondary/30',
                      ['loading', 'saving', 'enriching'].includes(result.status) && 'border-violet-500/20 bg-violet-500/5',
                      result.status === 'review' && 'border-amber-500/20 bg-amber-500/5',
                      result.status === 'pending' && 'border-border/30 bg-secondary/20',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {['loading', 'saving', 'enriching'].includes(result.status) && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-300" />}
                      {result.status === 'success' && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                      {result.status === 'error' && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                      {result.status === 'review' && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
                      {result.status === 'skipped' && <SkipForward className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      {result.status === 'pending' && <div className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted-foreground/20" />}
                      <span className="truncate text-foreground/85">{result.title}</span>
                    </div>

                    {result.status === 'review' && (
                      <div className="mt-2 space-y-2 rounded-md bg-black/10 p-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <SearchCheck className="h-3.5 w-3.5 text-amber-300" />
                          <span>Closest provider match</span>
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                            {Math.round((result.confidence || 0) * 100)}% confidence
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="truncate text-foreground/75">{result.inputTitle}</span>
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium text-foreground">{result.bestCandidate?.title || 'No candidate'}</span>
                        </div>
                        {result.reason && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {result.reason}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={result.selectedChoice === 'api' ? 'default' : 'outline'}
                            className={cn('border-border/50', result.selectedChoice === 'api' && 'bg-primary text-primary-foreground')}
                            onClick={() => chooseReviewAction(index, 'api')}
                          >
                            Use API match
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={result.selectedChoice === 'skip' ? 'secondary' : 'outline'}
                            className="border-border/50"
                            onClick={() => chooseReviewAction(index, 'skip')}
                          >
                            Skip for now
                          </Button>
                        </div>
                      </div>
                    )}

                    {result.errorMessage && result.status !== 'review' && (
                      <p className={cn(
                        'mt-2 text-xs leading-relaxed',
                        result.status === 'error' ? 'text-red-200/80' : 'text-muted-foreground',
                      )}>
                        {result.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {(phase === 'processing' || phase === 'saving-review') && (
                <p className="text-center text-xs text-muted-foreground">
                  {phase === 'processing'
                    ? 'Repairing provider links and metadata...'
                    : 'Saving reviewed repairs...'}
                </p>
              )}

              {phase === 'review' && (
                <div className="flex items-center justify-between gap-3 pt-2">
                  <span className="text-xs text-muted-foreground">
                    {reviewItems.length} entr{reviewItems.length === 1 ? 'y' : 'ies'} need review
                  </span>
                  <Button onClick={handleReviewSubmit} disabled={!canSubmitReview || processing}>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Save reviewed repairs
                  </Button>
                </div>
              )}

              {allDone && (
                <div className="flex items-center justify-between gap-2 pt-2">
                  <span className="text-xs text-muted-foreground">
                    {successCount} repaired, {failedCount} failed, {skippedCount} skipped
                  </span>
                  <Button onClick={handleClose} variant="outline" className="border-border">
                    Done
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
