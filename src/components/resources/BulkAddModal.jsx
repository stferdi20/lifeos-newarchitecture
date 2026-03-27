import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, CheckCircle2, XCircle, Link2 } from 'lucide-react';
import { createResourceFromUrl } from '@/lib/resources-api';
import { cn } from '@/lib/utils';
import { isNormalizedResourceUrl, normalizeResourceUrl } from '@/lib/resource-url';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';

export default function BulkAddModal({ open, onClose, onCreated, projectId }) {
  const [urlText, setUrlText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState([]);

  const parseUrls = (text) => {
    return text
      .split(/[\n,]+/)
      .map(line => line.trim())
      .map(line => normalizeResourceUrl(line))
      .filter(line => isNormalizedResourceUrl(line));
  };

  const urls = parseUrls(urlText);

  const handleBulkAdd = async () => {
    if (urls.length === 0) return;
    setProcessing(true);
    setResults(urls.map(url => ({ url, status: 'pending' })));

    for (let i = 0; i < urls.length; i++) {
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'loading' } : r));
      try {
        const payload = { url: urls[i] };
        if (projectId) payload.project_id = projectId;
        await createResourceFromUrl(payload);
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success' } : r));
      } catch {
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error' } : r));
      }
    }

    setProcessing(false);
    onCreated?.();
  };

  const handleClose = () => {
    if (processing) return;
    setUrlText('');
    setResults([]);
    onClose();
  };

  const allDone = results.length > 0 && results.every(r => r.status === 'success' || r.status === 'error');
  const successCount = results.filter(r => r.status === 'success').length;

  return (
    <ResponsiveModal open={open} onOpenChange={handleClose}>
      <ResponsiveModalContent className="bg-card border-border max-w-lg max-h-[80vh] overflow-y-auto" mobileClassName="bg-card border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-violet-400" />
            Bulk Add Resources
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
          {results.length === 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                Paste multiple URLs below — one per line or comma-separated. Each will be analyzed by AI and saved as a resource.
              </p>
              <Textarea
                value={urlText}
                onChange={e => setUrlText(e.target.value)}
                placeholder={"example.com/article\ngithub.com/user/repo\nyoutube.com/watch?v=..."}
                className="bg-secondary/50 border-border min-h-[160px] font-mono text-sm"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {urls.length} valid URL{urls.length !== 1 ? 's' : ''} detected
                </span>
                <Button onClick={handleBulkAdd} disabled={urls.length === 0}>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Analyze {urls.length} URL{urls.length !== 1 ? 's' : ''}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                {results.map((r, i) => (
                  <div key={i} className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm',
                    r.status === 'success' && 'bg-emerald-500/5 border-emerald-500/20',
                    r.status === 'error' && 'bg-red-500/5 border-red-500/20',
                    r.status === 'loading' && 'bg-violet-500/5 border-violet-500/20',
                    r.status === 'pending' && 'bg-secondary/30 border-border/30'
                  )}>
                    {r.status === 'loading' && <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin shrink-0" />}
                    {r.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    {r.status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    {r.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/20 shrink-0" />}
                    <span className="truncate text-foreground/80">{r.url}</span>
                  </div>
                ))}
              </div>

              {processing && (
                <p className="text-xs text-muted-foreground text-center">
                  Processing... this may take a while depending on the number of URLs.
                </p>
              )}

              {allDone && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">
                    {successCount}/{results.length} added successfully
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
