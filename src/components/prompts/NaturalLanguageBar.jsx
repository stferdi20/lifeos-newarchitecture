import React, { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { generateStructuredAi } from '@/lib/ai-api';

export default function NaturalLanguageBar({ onGenerated }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    const text = input.trim();
    if (!text) return;
    setLoading(true);
    const prompt = `You are a prompt engineering expert. The user wants to create an AI prompt template from this natural language description:

"${text}"

Break it down into a structured prompt template. Return a JSON object with these fields:
- title: a concise template name
- category: one of [writing, coding, research, brainstorming, summarizing, analysis, creative, other]
- role: the AI persona/role (e.g. "You are an expert...")
- task: the main instruction (detailed and clear)
- output_format: suggested output format
- context: any relevant context extracted from the description (or empty string)
- tags: array of 3-5 relevant lowercase tags`;
    const result = await generateStructuredAi({
      taskType: 'generic.structured',
      prompt,
      policy: { tier: 'standard', maxTokens: 1000, temperature: 0.2 },
      metadata: { requestSummary: `prompt-natural-language:${text.slice(0, 80)}` },
    });
    setLoading(false);
    setInput('');
    onGenerated(result);
    toast.success('Prompt generated from your description!');
  };

  return (
    <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-r from-violet-500/5 via-card to-fuchsia-500/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-violet-400" />
        <span className="text-xs font-semibold text-violet-300">Describe your prompt in plain English</span>
      </div>
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && handleGenerate()}
          placeholder="e.g. I need a prompt that helps me write LinkedIn posts about AI trends..."
          className="bg-secondary/50 border-border/50 flex-1"
          disabled={loading}
        />
        <button
          onClick={handleGenerate}
          disabled={!input.trim() || loading}
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-40"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate
        </button>
      </div>
    </div>
  );
}
