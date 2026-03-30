import React, { useState } from 'react';
import { ClipboardPaste, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { captureResourceFromUrl, createResourceFromUrl } from '@/lib/resources-api';
import { isNormalizedResourceUrl, normalizeResourceUrl } from '@/lib/resource-url';

export default function QuickPasteButton({ onCreated, projectId }) {
  const [loading, setLoading] = useState(false);

  const handleQuickPaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const normalizedUrl = normalizeResourceUrl(text);

      if (!normalizedUrl || !isNormalizedResourceUrl(normalizedUrl)) {
        toast.error('Clipboard does not contain a valid URL.');
        return;
      }

      setLoading(true);
      const payload = { url: normalizedUrl, source: 'quick_paste' };
      if (projectId) payload.project_id = projectId;

      toast.info('Saving pasted URL...', { id: 'quick-paste-toast' });
      const result = /instagram\.com\/(?:(?:share\/)?(?:reel|p|tv))\//i.test(normalizedUrl)
        ? await createResourceFromUrl(payload)
        : await captureResourceFromUrl(payload);

      toast.success(
        result.queued
          ? (result.deduped ? 'Already queued.' : 'Saved to queue.')
          : 'Resource saved!',
        { id: 'quick-paste-toast' },
      );
      onCreated?.(result.resource);
    } catch (e) {
      const backendError = e?.response?.data?.error || e?.message || '';
      toast.error(backendError || 'Failed to analyze URL.', { id: 'quick-paste-toast' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleQuickPaste}
      disabled={loading}
      className={`fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background active:scale-95 sm:hidden ${
        loading ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary/90'
      }`}
      aria-label="Quick paste URL from clipboard"
    >
      {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ClipboardPaste className="h-6 w-6" />}
    </button>
  );
}
