import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Youtube, MessageSquare, Link2, Newspaper, GraduationCap, Globe, FileDown, Loader2, Sparkles, Clapperboard } from 'lucide-react';
import { createResourceFromUrl } from '@/lib/resources-api';
import { isNormalizedResourceUrl, normalizeResourceUrl } from '@/lib/resource-url';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';
import { toast } from 'sonner';

const examples = [
  { icon: Youtube, label: 'YouTube', color: 'text-red-400' },
  { icon: Newspaper, label: 'Article', color: 'text-sky-400' },
  { icon: GraduationCap, label: 'Paper', color: 'text-violet-400' },
  { icon: Clapperboard, label: 'Instagram', color: 'text-pink-400' },
  { icon: MessageSquare, label: 'Reddit', color: 'text-orange-400' },
  { icon: Globe, label: 'Website', color: 'text-cyan-400' },
  { icon: FileDown, label: 'PDF', color: 'text-amber-400' },
  { icon: Link2, label: 'Any URL', color: 'text-blue-400' },
];

export default function AddResourceModal({ open, onClose, onCreated, projectId }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isInstagramUrl = /instagram\.com\/(?:(?:share\/)?(?:reel|p))\//i.test(url);

  const handleAnalyze = async () => {
    const normalizedUrl = normalizeResourceUrl(url);
    if (!normalizedUrl || !isNormalizedResourceUrl(normalizedUrl)) {
      setError('Please enter a valid URL.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = { url: normalizedUrl };
      if (projectId) payload.project_id = projectId;
      const result = await createResourceFromUrl(payload);
      onCreated?.(result.resource);
      if (result.queued) {
        toast.success(isInstagramUrl
          ? 'Instagram import queued. It will process when your downloader worker is online.'
          : 'Resource queued. We’ll keep processing it in the background.');
      } else {
        toast.success('Resource saved.');
      }
      setUrl('');
      onClose();
    } catch (e) {
      const backendError = e?.response?.data?.error || e?.message || '';
      if (/private|unavailable|blocked/i.test(backendError)) {
        setError('Instagram post is private, unavailable, or blocked by the extractor.');
      } else if (/unsupported instagram/i.test(backendError)) {
        setError('This Instagram link is not supported yet. Use a public reel or carousel post URL.');
      } else if (/transcript unavailable/i.test(backendError)) {
        setError('The Instagram post was saved, but transcript extraction was not available.');
      } else if (/drive upload failed/i.test(backendError)) {
        setError('The Instagram post was analyzed, but media upload to Drive failed.');
      } else {
        setError(backendError || 'Failed to analyze URL. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="bg-card border-border max-w-md" mobileClassName="bg-card border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Add Resource from URL
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
          <div className="flex gap-3 justify-center py-2 flex-wrap">
            {examples.map(({ icon: Icon, label, color }) => (
              <div key={label} className="flex flex-col items-center gap-1">
                <Icon className={`w-5 h-5 ${color}`} />
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Paste any URL. Public Instagram reels, carousels, and share links are supported when extraction is available.
          </p>

          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            placeholder="Paste URL here, like facebook.com"
            className="bg-secondary/50 border-border"
            disabled={loading}
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <Button onClick={handleAnalyze} disabled={!url.trim() || loading} className="w-full">
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {isInstagramUrl ? 'Fetching Instagram content...' : 'Queueing capture...'}</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" /> Analyze & Save</>
            )}
          </Button>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
