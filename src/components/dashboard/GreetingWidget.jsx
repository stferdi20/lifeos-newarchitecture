import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';

export default function GreetingWidget({ tasks }) {
  const [name, setName] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    setName(user?.full_name?.split(' ')[0] || user?.email?.split('@')[0] || 'there');
  }, [user]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const todayStr = new Date().toISOString().split('T')[0];
  const focusTasks = (tasks || []).filter(
    t => t.status !== 'done' && (t.priority === 'high' || t.due_date === todayStr)
  ).slice(0, 4);

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#1a1530] via-card to-card border border-violet-500/10 p-5 sm:p-6 h-full relative overflow-hidden hover:border-violet-500/25 hover:shadow-lg hover:shadow-violet-500/5 transition-all duration-300">
      <div className="absolute -top-12 -left-12 w-40 h-40 bg-violet-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-32 h-32 bg-fuchsia-500/5 rounded-full blur-2xl pointer-events-none" />
      <p className="text-muted-foreground text-xs sm:text-sm mb-1 relative">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight mb-4 relative break-words">
        {greeting}, {name}.
      </h1>
      {focusTasks.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Today's Focus</p>
          <div className="space-y-2">
            {focusTasks.map(t => (
              <div key={t.id} className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                <span className="text-sm text-foreground/80 min-w-0 break-words">{t.title}</span>
                {t.workspace_name && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground font-medium">
                    {t.workspace_name}
                  </span>
                )}
                {t.priority === 'high' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-medium">HIGH</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {focusTasks.length === 0 && (
        <p className="text-sm text-muted-foreground">No urgent tasks. Enjoy your day.</p>
      )}
    </div>
  );
}
