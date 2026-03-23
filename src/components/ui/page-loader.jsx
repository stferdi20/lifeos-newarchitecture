import React from 'react';
import { cn } from '@/lib/utils';

export function PageLoader({ label = 'Loading...', className = '' }) {
  return (
    <div className={cn("flex h-[80vh] w-full items-center justify-center", className)}>
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
        <p className="text-sm font-medium text-muted-foreground animate-pulse">{label}</p>
      </div>
    </div>
  );
}
