import { useIsMobile } from '@/hooks/use-mobile';

export function MobileOnly({ children }) {
  const isMobile = useIsMobile();
  return isMobile ? children : null;
}

export function TabletUp({ children }) {
  const isMobile = useIsMobile();
  return isMobile ? null : children;
}
