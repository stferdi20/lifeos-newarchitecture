import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { enrichMediaEntry } from './enrichMedia';
import { needsMediaReenrichment } from './mediaUtils';

export default function AutoEnrichBadge({ entry, onEnrich }) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const canEnrich = entry?.external_id && entry?.media_type && needsMediaReenrichment(entry);

  const handleEnrich = async (e) => {
    e.stopPropagation();
    if (!canEnrich || loading) return;
    setLoading(true);
    setErrorMessage('');

    try {
      const merged = await enrichMediaEntry(entry);
      onEnrich(merged);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Media enrichment failed.');
    } finally {
      setLoading(false);
    }
  };

  if (!canEnrich) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={handleEnrich}
        disabled={loading}
        className={cn(
          'flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all',
          'bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 border border-violet-500/20',
          'disabled:opacity-50'
        )}
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
        Auto-fill details
      </button>
      {errorMessage && (
        <p className="text-xs leading-relaxed text-red-300/80">{errorMessage}</p>
      )}
    </div>
  );
}
