import React, { useState, useCallback, useEffect } from 'react';
import { Sparkles, X, Check, RefreshCw } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { generateStructuredAi } from '@/lib/ai-api';
import { Note, Tool } from '@/lib/knowledge-api';

const typeColors = {
  content:   { pill: 'text-pink-400 bg-pink-500/10 border-pink-500/20',   glow: 'rgba(236,72,153,0.12)' },
  startup:   { pill: 'text-violet-400 bg-violet-500/10 border-violet-500/20', glow: 'rgba(139,92,246,0.12)' },
  research:  { pill: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',   glow: 'rgba(34,211,238,0.12)' },
  boardgame: { pill: 'text-amber-400 bg-amber-500/10 border-amber-500/20', glow: 'rgba(251,191,36,0.12)' },
};

const FALLBACK_IDEAS = [
  { type: 'startup',   text: 'An app that gamifies daily habits for ADHD brains using micro-rewards and streak mechanics.' },
  { type: 'content',   text: 'A carousel series exposing underrated AI tools that 99% of creators have never heard of.' },
  { type: 'research',  text: 'How does spaced repetition interact with emotional memory — can we hack retention with mood?' },
  { type: 'boardgame', text: 'A deck-builder where every card represents a real-world transferable skill you\'ve learned.' },
  { type: 'startup',   text: 'A "reverse job board" where companies pitch themselves to candidates instead of vice versa.' },
];

async function generateBatch(existingIdeas) {
  const [notes, tools] = await Promise.all([
    Note.list('-created_date', 12),
    Tool.list('-created_date', 8),
  ]);

  const noteCtx = notes.length
    ? `My recent notes:\n${notes.map(n => `- "${n.title}": ${(n.content || '').slice(0, 120)}`).join('\n')}`
    : '';
  const toolCtx = tools.length
    ? `Tools I track:\n${tools.map(t => `- ${t.name}: ${(t.ai_summary || '').slice(0, 80)} [${(t.tags || []).join(', ')}]`).join('\n')}`
    : '';
  const alreadySaved = existingIdeas.length
    ? `Do NOT repeat these saved ideas:\n${existingIdeas.map(i => `- ${i.text}`).join('\n')}`
    : '';

  const context = [noteCtx, toolCtx, alreadySaved].filter(Boolean).join('\n\n');

  const prompt = `Generate exactly 5 distinct, creative ideas. Each can be: a startup idea, Instagram/content idea, research topic, or board game mechanic.
Draw connections from the knowledge base below and make the ideas feel personal and surprising.
${context ? `\n${context}\n` : ''}
Each idea should be 1–2 punchy sentences. Be specific, not generic.

Return JSON with an "ideas" array of { type, text }.`;

  const res = await generateStructuredAi({
    taskType: 'generic.structured',
    prompt,
    policy: { tier: 'standard', maxTokens: 1100, temperature: 0.7 },
    metadata: { requestSummary: 'dashboard-idea-spark' },
  });

  return res?.ideas?.length ? res.ideas : FALLBACK_IDEAS;
}

export default function IdeaSpark() {
  const [deck, setDeck] = useState([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [direction, setDirection] = useState(null); // 'left' | 'right'
  const [savedIdeas, setSavedIdeas] = useState([]);
  const queryClient = useQueryClient();

  const loadDeck = useCallback(async () => {
    setLoading(true);
    setDirection(null);
    try {
      const ideas = await generateBatch(savedIdeas);
      setDeck(ideas);
      setIndex(0);
    } catch {
      setDeck(FALLBACK_IDEAS);
      setIndex(0);
    }
    setLoading(false);
  }, [savedIdeas]);

  const advance = useCallback((dir) => {
    setDirection(dir);
    setTimeout(() => {
      setDirection(null);
      setIndex(i => {
        const next = i + 1;
        if (next >= deck.length) {
          // Auto-refill
          loadDeck();
          return 0;
        }
        return next;
      });
    }, 320);
  }, [deck.length, loadDeck]);

  const saveMutation = useMutation({
    mutationFn: async (idea) => {
      await Note.create({
        title: idea.text.slice(0, 80),
        content: idea.text,
        type: 'manual_note',
        tags: ['idea', idea.type],
        saved_date: new Date().toISOString(),
      });
    },
    onSuccess: (_, idea) => {
      setSavedIdeas(prev => [...prev, idea]);
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Idea saved to Resources!');
      advance('right');
    },
  });

  const handleSkip = () => advance('left');
  const handleSave = () => {
    if (deck[index]) saveMutation.mutate(deck[index]);
  };

  // Keyboard support
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') handleSkip();
      if (e.key === 'ArrowRight') handleSave();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deck, index]);

  const current = deck[index];
  const cfg = current ? (typeColors[current.type] || typeColors.content) : null;
  const remaining = deck.length - index;

  // Initial empty state
  if (!loading && deck.length === 0) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-[#1a1520] via-card to-card border border-amber-400/10 p-5 h-full flex flex-col items-center justify-center gap-4 hover:border-amber-400/25 hover:shadow-lg hover:shadow-amber-400/5 transition-all duration-300">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold tracking-tight">Idea Lab</h3>
        </div>
        <p className="text-xs text-muted-foreground text-center">Spark your next idea — swipe to save or skip.</p>
        <button
          onClick={loadDeck}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all"
        >
          <Sparkles className="w-3.5 h-3.5" /> Generate Ideas
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#1a1520] via-card to-card border border-amber-400/10 p-5 h-full flex flex-col hover:border-amber-400/25 hover:shadow-lg hover:shadow-amber-400/5 transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold tracking-tight">Idea Lab</h3>
        </div>
        {deck.length > 0 && !loading && (
          <span className="text-[10px] text-muted-foreground shrink-0">{remaining} left</span>
        )}
      </div>

      {/* Card area */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden min-h-[110px]">
        {loading ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-xs">Generating ideas...</span>
          </div>
        ) : (
          current && direction === null && (
            <div
              key={`${index}-${current.text.slice(0, 20)}`}
              className="w-full rounded-xl border border-border/60 p-4"
              style={{ background: cfg?.glow ? `radial-gradient(ellipse at top left, ${cfg.glow}, transparent 70%), hsl(var(--card))` : undefined }}
            >
              <span className={`text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full w-fit mb-2 border inline-block ${cfg?.pill}`}>
                {current.type}
              </span>
              <p className="text-sm text-foreground/85 leading-relaxed">{current.text}</p>
            </div>
          )
        )}
      </div>

      {/* Action buttons */}
      {!loading && deck.length > 0 && (
        <div className="flex flex-col gap-3 mt-4 sm:flex-row">
          <button
            onClick={handleSkip}
            disabled={!!direction || saveMutation.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-500/30 bg-red-500/5 hover:bg-red-500/15 text-red-400 text-sm font-medium transition-all disabled:opacity-40"
          >
            <X className="w-4 h-4" /> Skip
          </button>
          <button
            onClick={handleSave}
            disabled={!!direction || saveMutation.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15 text-emerald-400 text-sm font-medium transition-all disabled:opacity-40"
          >
            <Check className="w-4 h-4" /> Save
          </button>
        </div>
      )}
    </div>
  );
}
