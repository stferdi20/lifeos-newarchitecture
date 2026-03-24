import React from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function MobileActionOverflow({ actions, className }) {
  if (!actions || actions.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={`border-border gap-1.5 sm:hidden ${className || ''}`}>
          <MoreHorizontal className="w-4 h-4" />
          <span className="sr-only">More Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px] sm:hidden">
        {actions.map((action, idx) => {
          if (action.hidden) return null;
          const Icon = action.icon;
          return (
            <DropdownMenuItem
              key={idx}
              onClick={action.onClick}
              disabled={action.disabled}
              className={action.className}
            >
              {Icon && <Icon className="w-4 h-4 mr-2" />}
              {action.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
