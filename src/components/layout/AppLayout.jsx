import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import { useIsMobile } from '@/hooks/use-mobile';
import { Menu } from 'lucide-react';

export default function AppLayout() {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="min-h-screen bg-[#0d0e12] text-[#e8eaf0]">
      <style>{`
        :root {
          --background: 240 6% 7%;
          --foreground: 210 20% 95%;
          --card: 230 6% 10%;
          --card-foreground: 210 20% 95%;
          --popover: 230 6% 12%;
          --popover-foreground: 210 20% 95%;
          --primary: 263 70% 58%;
          --primary-foreground: 0 0% 100%;
          --secondary: 230 5% 15%;
          --secondary-foreground: 210 20% 90%;
          --muted: 230 5% 13%;
          --muted-foreground: 215 14% 55%;
          --accent: 263 70% 58%;
          --accent-foreground: 0 0% 100%;
          --destructive: 0 72% 51%;
          --destructive-foreground: 0 0% 98%;
          --border: 230 5% 17%;
          --input: 230 5% 17%;
          --ring: 263 70% 58%;
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        ::-webkit-scrollbar-corner { background: transparent; }
        * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
        body { -webkit-overflow-scrolling: touch; }
      `}</style>
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded(e => !e)}
        isMobile={isMobile}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />
      <main
        className="min-h-screen transition-all duration-300 ease-in-out"
        style={{ marginLeft: isMobile ? 0 : (sidebarExpanded ? '14rem' : '68px') }}
      >
        {isMobile && (
          <div className="sticky top-0 z-30 h-14 px-4 flex items-center border-b border-white/[0.06] bg-[#0d0e12]/95 backdrop-blur">
            <button
              onClick={() => setMobileNavOpen(true)}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="ml-3 text-sm font-semibold tracking-tight text-foreground">LifeOS</span>
          </div>
        )}
        <div className="p-4 sm:p-5 lg:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
