import React, { useState } from 'react';
import { Sparkles, Loader2, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { parseCalendarInput } from '@/lib/calendar-api';

const EXAMPLES = [
  'Uni lecture every Mon and Wed 9-11am for 12 weeks',
  'Dentist appointment tomorrow 2pm offline',
  'Assignment deadline Friday',
  'Team standup online every weekday 9:30am for 4 weeks',
];

export default function NaturalLanguageBar({ onParsed }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setLoading(true);
    setError('');
    try {
      const parsed = await parseCalendarInput({
        text,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      onParsed(parsed, text);
    } catch (err) {
      setError('Could not parse. Try again or use the form below.');
    }
    setLoading(false);
  };

  return (
    <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-purple-300">Quick Add — just describe it</span>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={text}
          onChange={e => { setText(e.target.value); setError(''); }}
          placeholder="e.g. Uni lecture every Mon Wed 9-11am for 12 weeks..."
          className="bg-white/5 border-white/10 text-sm flex-1"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !text.trim()}
          className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {loading ? 'Parsing...' : 'Parse'}
        </button>
      </form>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {EXAMPLES.map((ex, i) => (
          <button key={i} onClick={() => setText(ex)}
            className="text-xs text-muted-foreground hover:text-foreground bg-white/5 hover:bg-white/10 px-2 py-1 rounded-lg transition-colors border border-white/5">
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
