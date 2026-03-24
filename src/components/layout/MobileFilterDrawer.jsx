import React from 'react';
import { Filter } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function MobileFilterDrawer({ children, activeCount = 0, triggerClassName }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = React.useState(false);

  if (!isMobile) {
    return null;
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="outline" className={cn("justify-between border-border text-muted-foreground", triggerClassName)}>
          <span className="flex items-center gap-2 text-foreground">
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeCount > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                {activeCount}
              </span>
            )}
          </span>
          <span className="text-xs">Filters</span>
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-left py-4 px-5 border-b border-border/50">
          <DrawerTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </DrawerTitle>
        </DrawerHeader>
        <div className="p-5 overflow-y-auto w-full">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
