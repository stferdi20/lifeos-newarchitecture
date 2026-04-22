import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

const LOADING_LINES = [
  'Arranging the signal board.',
  'Warming up your second brain.',
  'Stacking the useful things first.',
  'Sorting the sparks from the static.',
  'Lining up the next good move.',
  'Indexing the tiny breakthroughs.',
  'Polishing the command center.',
];

export function PageLoader({ label = 'Loading...', className = '' }) {
  const [lineIndex, setLineIndex] = useState(() => Math.floor(Math.random() * LOADING_LINES.length));
  const line = LOADING_LINES[lineIndex] || LOADING_LINES[0];
  const bars = useMemo(() => [0, 1, 2, 3, 4], []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLineIndex((current) => (current + 1) % LOADING_LINES.length);
    }, 1900);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className={cn('flex h-[80vh] w-full items-center justify-center px-4', className)}>
      <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <div className="relative h-16 w-28 overflow-hidden rounded-lg border border-border/70 bg-card/80 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.55)]">
          <div className="absolute inset-x-3 top-3 h-1.5 overflow-hidden rounded-full bg-secondary/70">
            <div className="h-full w-1/3 animate-[lifeos-scan_1.35s_ease-in-out_infinite] rounded-full bg-primary/70" />
          </div>
          <div className="absolute inset-x-3 bottom-3 flex items-end justify-between">
            {bars.map((bar) => (
              <span
                key={bar}
                className="h-5 w-2 rounded-sm bg-primary/70 animate-[lifeos-equalize_1.2s_ease-in-out_infinite]"
                style={{
                  animationDelay: `${bar * 120}ms`,
                  transformOrigin: 'bottom',
                }}
              />
            ))}
          </div>
          <div className="absolute inset-x-3 top-7 h-px bg-border/80" />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="min-h-5 text-xs text-muted-foreground transition-opacity duration-300">{line}</p>
        </div>
      </div>
    </div>
  );
}
