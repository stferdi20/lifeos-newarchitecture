import React from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({ icon: Icon, title, description, actions, className, titleClassName }) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className="rounded-2xl bg-white/5 p-3 shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
          ) : null}
          <div className="min-w-0">
            <h1 className={cn('text-2xl font-bold tracking-tight', titleClassName)}>{title}</h1>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
      </div>
      {actions ? (
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function PageActionRow({ className, children }) {
  return (
    <div className={cn('flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap', className)}>
      {children}
    </div>
  );
}
