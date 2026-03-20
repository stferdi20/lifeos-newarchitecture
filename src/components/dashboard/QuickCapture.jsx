import React, { useState } from 'react';
import { Send, Zap } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Note } from '@/lib/knowledge-api';

export default function QuickCapture() {
  const [value, setValue] = useState('');
  const queryClient = useQueryClient();

  const captureMutation = useMutation({
    mutationFn: async () => {
      const text = value.trim();
      if (!text) return;
      const isUrl = text.startsWith('http://') || text.startsWith('https://');
      await Note.create({
        title: text.slice(0, 80),
        content: text,
        type: isUrl ? 'generic_link' : 'manual_note',
        source_url: isUrl ? text : '',
        saved_date: new Date().toISOString(),
        tags: ['quick-capture'],
      });
    },
    onSuccess: () => {
      setValue('');
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Captured!');
    },
  });

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#1a1714] via-card to-card border border-amber-500/10 p-5 h-full hover:border-amber-500/25 hover:shadow-lg hover:shadow-amber-500/5 transition-all duration-300">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold tracking-tight">Quick Capture</h3>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && captureMutation.mutate()}
          placeholder="Capture a thought, link, or idea..."
          className="flex-1 bg-secondary/50 border border-border/50 rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={() => captureMutation.mutate()}
          disabled={!value.trim()}
          className="px-3 py-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-30 sm:self-auto self-stretch"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
