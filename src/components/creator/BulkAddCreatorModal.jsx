import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, XCircle, ListPlus } from 'lucide-react';
import { CreatorInspo, enrichCreator } from '@/lib/creator-api';
import { cn } from '@/lib/utils';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';

const PLATFORMS = [
  { value: 'x', label: '𝕏 X' },
  { value: 'threads', label: '@ Threads' },
  { value: 'instagram', label: '📸 Instagram' },
  { value: 'tiktok', label: '🎵 TikTok' },
  { value: 'youtube', label: '▶️ YouTube' },
  { value: 'linkedin', label: '💼 LinkedIn' },
  { value: 'other', label: '🔗 Other' },
];

export default function BulkAddCreatorModal({ open, onClose, onCreated }) {
  const [text, setText] = useState('');
  const [platform, setPlatform] = useState('x');
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState([]);

  const parseHandles = (input) => {
    return input
      .split(/\n/)
      .map(line => line.replace(/^[-•*\d.)\s]+/, '').trim().replace(/^@/, ''))
      .filter(Boolean);
  };

  const handles = parseHandles(text);

  const handleBulkAdd = async () => {
    if (handles.length === 0) return;
    setProcessing(true);
    setResults(handles.map(h => ({ handle: h, status: 'pending' })));

    for (let i = 0; i < handles.length; i++) {
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'loading', statusText: 'Creating...' } : r));
      try {
        const created = await CreatorInspo.create({ handle: handles[i], platform });
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, statusText: 'Enriching with AI...' } : r));
        try {
          await enrichCreator({
            creator_id: created.id,
            handle: handles[i],
            platform,
          });
        } catch { /* enrichment failed, record still saved */ }
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'success', statusText: '' } : r));
      } catch {
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'error', statusText: '' } : r));
      }
    }

    setProcessing(false);
    onCreated?.();
  };

  const handleClose = () => {
    if (processing) return;
    setText('');
    setResults([]);
    onClose();
  };

  const allDone = results.length > 0 && results.every(r => r.status === 'success' || r.status === 'error');
  const successCount = results.filter(r => r.status === 'success').length;

  return (
    <ResponsiveModal open={open} onOpenChange={handleClose}>
      <ResponsiveModalContent className="bg-[#161820] border-border max-w-lg max-h-[80vh] overflow-y-auto" mobileClassName="bg-[#161820] border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            <ListPlus className="w-4 h-4 text-fuchsia-400" />
            Bulk Add Creators
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
          {results.length === 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                Add multiple creators at once — one handle per line. The @ symbol is optional.
              </p>

              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="bg-secondary/40 border-border/50 h-8 text-xs w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={"@creatorone\ncreator_two\nthird_creator"}
                className="bg-secondary/50 border-border min-h-[160px] font-mono text-sm"
              />

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {handles.length} handle{handles.length !== 1 ? 's' : ''} detected
                </span>
                <Button onClick={handleBulkAdd} disabled={handles.length === 0}>
                  <ListPlus className="w-4 h-4 mr-2" />
                  Add {handles.length} creator{handles.length !== 1 ? 's' : ''}
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
                    r.status === 'loading' && 'bg-fuchsia-500/5 border-fuchsia-500/20',
                    r.status === 'pending' && 'bg-secondary/30 border-border/30'
                  )}>
                    {r.status === 'loading' && <Loader2 className="w-3.5 h-3.5 text-fuchsia-400 animate-spin shrink-0" />}
                    {r.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                    {r.status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    {r.status === 'pending' && <div className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/20 shrink-0" />}
                    <span className="truncate text-foreground/80">@{r.handle}</span>
                    {r.statusText && <span className="text-[10px] text-fuchsia-400/70 ml-auto shrink-0">{r.statusText}</span>}
                  </div>
                ))}
              </div>

              {processing && (
                <p className="text-xs text-muted-foreground text-center">Adding & enriching creators with AI... this may take a moment.</p>
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
