import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Sparkles, CheckCircle2, XCircle, ListPlus, ArrowRight, Wand2, AlertTriangle, SearchCheck } from 'lucide-react';
import { MediaEntry } from '@/lib/media-api';
import { cn } from '@/lib/utils';
import { TYPE_CONFIG, getStatusOptions } from './mediaConfig';
import { resolveBulkMediaMatch } from './searchMedia';
import { enrichMediaEntry } from './enrichMedia';
import { getPreferredPlayedOn, hasEnoughMediaMetadata, mergeDefinedMediaFields, normalizeMediaEntry } from './mediaUtils';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';

const SEARCH_CONCURRENCY = 4;

async function runWithConcurrency(items, worker, concurrency = SEARCH_CONCURRENCY) {
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

export default function BulkAddMediaModal({ open, onClose, onCreated }) {
  const [titleText, setTitleText] = useState('');
  const [mediaType, setMediaType] = useState('movie');
  const [status, setStatus] = useState('plan_to_watch');
  const [processing, setProcessing] = useState(false);
  const [phase, setPhase] = useState('input');
  const [results, setResults] = useState([]);
  const [enrichMode, setEnrichMode] = useState('always');

  const parseTitles = (text) => {
    return text
      .split(/\n/)
      .map(line => line.replace(/^[-•*\d.)\s]+/, '').trim())
      .filter(Boolean);
  };

  const titles = useMemo(() => parseTitles(titleText), [titleText]);
  const statusOptions = getStatusOptions(mediaType);
  const reviewItems = useMemo(
    () => results.filter((result) => result.status === 'review'),
    [results],
  );
  const canSubmitReview = reviewItems.length > 0 && reviewItems.every((item) => item.selectedChoice);
  const allDone = results.length > 0 && results.every((item) => item.status === 'success' || item.status === 'error');
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.filter((result) => result.status === 'error').length;

  const buildManualEntry = (title) => ({
    title,
    media_type: mediaType,
    status,
    year_consumed: new Date().getFullYear(),
  });

  const finalizeEntryForCreate = (entry) => {
    const normalized = normalizeMediaEntry(entry) || entry;
    if (normalized?.media_type === 'game') {
      const preferredPlatform = getPreferredPlayedOn(normalized);
      if (preferredPlatform && !normalized.played_on) {
        return {
          ...normalized,
          played_on: preferredPlatform,
        };
      }
    }
    return normalized;
  };

  const updateResultAt = (index, updater) => {
    setResults((prev) => prev.map((result, resultIndex) => (
      resultIndex === index ? updater(result) : result
    )));
  };

  const chooseReviewAction = (index, choice) => {
    updateResultAt(index, (result) => {
      const finalEntry =
        choice === 'api' && result.bestCandidate
          ? mergeDefinedMediaFields(buildManualEntry(result.inputTitle), result.bestCandidate)
          : buildManualEntry(result.inputTitle);

      return {
        ...result,
        selectedChoice: choice,
        finalEntry,
      };
    });
  };

  const persistEntries = async (items) => {
    if (items.length === 0) return 0;

    let successTotal = 0;

    await runWithConcurrency(items, async ({ index, finalEntry }) => {
      if (!finalEntry) return;

      try {
        let entryToCreate = finalEntry;
        const enoughMetadata = hasEnoughMediaMetadata(entryToCreate);
        const shouldEnrichBeforeCreate =
          enrichMode !== 'skip' &&
          Boolean(entryToCreate.external_id) &&
          (enrichMode === 'always' || !enoughMetadata);

        if (shouldEnrichBeforeCreate) {
          updateResultAt(index, (result) => ({ ...result, status: 'enriching' }));

          try {
            const enriched = await enrichMediaEntry(entryToCreate);
            if (Object.keys(enriched).length === 0 && !enoughMetadata) {
              throw new Error('Provider returned no additional media details.');
            }
            entryToCreate = mergeDefinedMediaFields(entryToCreate, enriched);
          } catch (error) {
            updateResultAt(index, (result) => ({
              ...result,
              status: 'error',
              errorMessage: error instanceof Error ? error.message : 'Media enrichment failed before create.',
            }));
            return;
          }
        }

        entryToCreate = finalizeEntryForCreate(entryToCreate);

        updateResultAt(index, (result) => ({ ...result, status: 'saving', finalEntry: entryToCreate }));
        const created = await MediaEntry.create(entryToCreate);
        successTotal += 1;
        updateResultAt(index, (result) => ({
          ...result,
          status: 'success',
          createdId: created.id,
          errorMessage: '',
        }));
      } catch (error) {
        updateResultAt(index, (result) => ({
          ...result,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : 'Media creation failed.',
        }));
      }
    });

    return successTotal;
  };

  const resolveAndStageItems = async (items) => {
    const preparedEntries = new Array(results.length || titles.length);
    let reviewCount = 0;

    await runWithConcurrency(
      items,
      async ({ title, index }) => {
        updateResultAt(index, (result) => ({ ...result, status: 'loading', errorMessage: '', reason: '' }));

        const manualEntry = buildManualEntry(title);
        let entryData = manualEntry;
        let nextResult = {
          inputTitle: title,
          title,
          status: 'pending',
          selectedChoice: 'manual',
          decision: 'no_match',
          confidence: 0,
          queryUsed: title,
          fallbackUsed: false,
          reason: '',
          bestCandidate: null,
          finalEntry: manualEntry,
          errorMessage: '',
        };

        try {
          const resolution = await resolveBulkMediaMatch(title, mediaType);

          if (resolution.lookupFailed) {
            nextResult = {
              ...nextResult,
              status: 'error',
              selectedChoice: null,
              finalEntry: null,
              errorMessage: resolution.reason,
              reason: resolution.reason,
            };
            entryData = null;
          } else if (resolution.decision === 'auto_accept' && resolution.match) {
            entryData = mergeDefinedMediaFields(manualEntry, resolution.match);
            nextResult = {
              ...nextResult,
              title: entryData.title,
              decision: resolution.decision,
              confidence: resolution.confidence,
              queryUsed: resolution.queryUsed,
              fallbackUsed: resolution.fallbackUsed,
              reason: resolution.reason,
              bestCandidate: resolution.bestCandidate,
              selectedChoice: 'api',
              finalEntry: entryData,
            };
          } else if (resolution.decision === 'needs_review' && resolution.bestCandidate) {
            reviewCount += 1;
            nextResult = {
              ...nextResult,
              status: 'review',
              decision: resolution.decision,
              confidence: resolution.confidence,
              queryUsed: resolution.queryUsed,
              fallbackUsed: resolution.fallbackUsed,
              reason: resolution.reason,
              bestCandidate: resolution.bestCandidate,
              selectedChoice: null,
              finalEntry: null,
            };
            entryData = null;
          } else {
            nextResult = {
              ...nextResult,
              decision: 'no_match',
              confidence: resolution.confidence,
              queryUsed: resolution.queryUsed,
              fallbackUsed: resolution.fallbackUsed,
              reason: resolution.reason,
              bestCandidate: resolution.bestCandidate,
              selectedChoice: 'manual',
              finalEntry: manualEntry,
            };
          }
        } catch (error) {
          nextResult = {
            ...nextResult,
            status: 'error',
            selectedChoice: null,
            finalEntry: null,
            errorMessage: error instanceof Error ? error.message : 'Bulk match lookup failed.',
          };
          entryData = null;
        }

        preparedEntries[index] = entryData;
        updateResultAt(index, () => nextResult);
      },
    );

    return {
      autoCreateIndexes: preparedEntries
        .map((entry, index) => (entry ? { index, finalEntry: entry } : null))
        .filter(Boolean),
      reviewCount,
    };
  };

  const handleBulkAdd = async () => {
    if (titles.length === 0) return;

    setProcessing(true);
    setPhase('processing');
    setResults(titles.map((title) => ({
      inputTitle: title,
      title,
      status: 'pending',
      selectedChoice: null,
      confidence: 0,
      bestCandidate: null,
      finalEntry: null,
    })));

    try {
      const { autoCreateIndexes, reviewCount } = await resolveAndStageItems(
        titles.map((title, index) => ({ title, index })),
      );
      const autoSuccessCount = await persistEntries(autoCreateIndexes);

      if (autoSuccessCount > 0) {
        onCreated?.();
      }

      const unresolvedReviewExists = reviewCount > 0;
      setPhase(unresolvedReviewExists ? 'review' : 'complete');
    } catch {
      setResults(prev => prev.map((result) => (
        result.status === 'success' || result.status === 'review'
          ? result
          : { ...result, status: 'error' }
      )));
      setPhase('complete');
    } finally {
      setProcessing(false);
    }
  };

  const handleReviewSubmit = async () => {
    const reviewIndexes = results
      .map((result, index) => (
        result.status === 'review' && result.finalEntry
          ? { index, finalEntry: result.finalEntry }
          : null
      ))
      .filter(Boolean);

    if (reviewIndexes.length === 0) return;

    setProcessing(true);
    setPhase('saving-review');

    try {
      const reviewSuccessCount = await persistEntries(reviewIndexes);
      if (reviewSuccessCount > 0) {
        onCreated?.();
      }
    } finally {
      setProcessing(false);
      setPhase('complete');
    }
  };

  const handleRetryFailed = async () => {
    const failedItems = results
      .map((result, index) => (result.status === 'error' ? { title: result.inputTitle, index } : null))
      .filter(Boolean);

    if (failedItems.length === 0) return;

    setProcessing(true);
    setPhase('processing');

    try {
      const { autoCreateIndexes, reviewCount } = await resolveAndStageItems(failedItems);
      const retrySuccessCount = await persistEntries(autoCreateIndexes);

      if (retrySuccessCount > 0) {
        onCreated?.();
      }

      const reviewStillPending = reviewCount > 0 || results.some((item) => item.status === 'review');
      setPhase(reviewStillPending ? 'review' : 'complete');
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = () => {
    if (processing) return;
    setTitleText('');
    setResults([]);
    setPhase('input');
    onClose();
  };

  return (
    <ResponsiveModal open={open} onOpenChange={handleClose}>
      <ResponsiveModalContent className="bg-[#161820] border-border max-w-lg max-h-[80vh] overflow-y-auto" mobileClassName="bg-[#161820] border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <ListPlus className="w-4 h-4 text-violet-400" />
            Bulk Add Media
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
          {results.length === 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                Add multiple titles at once — one per line. Base44 AI will check the closest API title first, then auto-enrich when a match is accepted.
              </p>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={mediaType} onValueChange={v => { setMediaType(v); setStatus('plan_to_watch'); }}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 h-8 text-xs w-full sm:w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-1.5">
                          <cfg.icon className={cn('w-3 h-3', cfg.color)} /> {cfg.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="bg-secondary/40 border-border/50 h-8 text-xs w-full sm:w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Select value={enrichMode} onValueChange={setEnrichMode}>
                <SelectTrigger className="bg-secondary/40 border-border/50 h-8 text-xs w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Always enrich matched titles</SelectItem>
                  <SelectItem value="missing_only">Only enrich obviously incomplete titles</SelectItem>
                  <SelectItem value="skip">Create now, skip enrich</SelectItem>
                </SelectContent>
              </Select>

              <Textarea
                value={titleText}
                onChange={e => setTitleText(e.target.value)}
                placeholder={"Attack on Titan\nDemon Slayer\nOne Piece\nNaruto"}
                className="bg-secondary/50 border-border min-h-[160px] font-mono text-sm"
              />

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {titles.length} title{titles.length !== 1 ? 's' : ''} detected
                </span>
                <Button onClick={handleBulkAdd} disabled={titles.length === 0}>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Add {titles.length} title{titles.length !== 1 ? 's' : ''}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className={cn(
                    'rounded-lg border px-3 py-2 text-sm',
                    r.status === 'success' && 'bg-emerald-500/5 border-emerald-500/20',
                    r.status === 'error' && 'bg-red-500/5 border-red-500/20',
                    r.status === 'loading' && 'bg-violet-500/5 border-violet-500/20',
                    r.status === 'saving' && 'bg-violet-500/5 border-violet-500/20',
                    r.status === 'enriching' && 'bg-violet-500/5 border-violet-500/20',
                    r.status === 'review' && 'bg-amber-500/5 border-amber-500/20',
                    r.status === 'pending' && 'bg-secondary/30 border-border/30'
                  )}>
                    <div className="flex items-center gap-2">
                      {(r.status === 'loading' || r.status === 'saving' || r.status === 'enriching') && <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />}
                      {r.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                      {r.status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                      {r.status === 'review' && <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />}
                      {r.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/20 shrink-0" />}
                      <span className="truncate text-foreground/80">{r.title}</span>
                    </div>

                    {r.status === 'review' && (
                      <div className="mt-2 space-y-2 rounded-md bg-black/10 p-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <SearchCheck className="h-3.5 w-3.5 text-amber-300" />
                          <span>Closest API match</span>
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                            {Math.round((r.confidence || 0) * 100)}% confidence
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="truncate text-foreground/75">{r.inputTitle}</span>
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate font-medium text-foreground">{r.bestCandidate?.title || 'No candidate'}</span>
                        </div>
                        {r.reason && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {r.reason}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={r.selectedChoice === 'api' ? 'default' : 'outline'}
                            className={cn(
                              'border-border/50',
                              r.selectedChoice === 'api' && 'bg-primary text-primary-foreground',
                            )}
                            onClick={() => chooseReviewAction(i, 'api')}
                          >
                            <Wand2 className="h-3.5 w-3.5" />
                            Use API match
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={r.selectedChoice === 'manual' ? 'secondary' : 'outline'}
                            className="border-border/50"
                            onClick={() => chooseReviewAction(i, 'manual')}
                          >
                            Keep typed title
                          </Button>
                        </div>
                      </div>
                    )}

                    {r.status === 'error' && r.errorMessage && (
                      <p className="mt-2 text-xs leading-relaxed text-red-200/80">
                        {r.errorMessage}
                      </p>
                    )}

                    {r.status === 'success' && r.errorMessage && (
                      <p className="mt-2 text-xs leading-relaxed text-amber-200/80">
                        Added, but enrichment could not complete: {r.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {(phase === 'processing' || phase === 'saving-review') && (
                <p className="text-xs text-muted-foreground text-center">
                  {phase === 'processing'
                    ? 'Base44 AI is matching API results, then adding and enriching titles... this may take a moment.'
                    : 'Saving reviewed titles... this may take a moment.'}
                </p>
              )}

              {phase === 'review' && (
                <div className="space-y-3 pt-2">
                  <p className="text-xs text-muted-foreground">
                    Review the close matches below. Strong matches were already added automatically; these need a final choice before we create them.
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {reviewItems.length} title{reviewItems.length !== 1 ? 's' : ''} waiting for review
                    </span>
                    <Button onClick={handleReviewSubmit} disabled={!canSubmitReview || processing}>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Add reviewed titles
                    </Button>
                  </div>
                </div>
              )}

              {allDone && (
                <div className="flex items-center justify-between gap-2 pt-2">
                  <span className="text-xs text-muted-foreground">
                    {successCount}/{results.length} added successfully
                  </span>
                  <div className="flex items-center gap-2">
                    {failedCount > 0 && (
                      <Button onClick={handleRetryFailed} variant="outline" className="border-border" disabled={processing}>
                        Retry failed items
                      </Button>
                    )}
                    <Button onClick={handleClose} variant="outline" className="border-border">
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
