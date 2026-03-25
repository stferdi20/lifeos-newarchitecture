import React from 'react';
import { LogOut, Settings as SettingsIcon, UserRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import GoogleConnectionsPanel from '@/components/google/GoogleConnectionsPanel';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

export default function Settings() {
  const { user, logout } = useAuth();

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        description="Manage your connections and preferences"
      />

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <UserRound className="h-4 w-4" />
              Account
            </div>
            <p className="text-base font-medium text-foreground">
              {user?.full_name || user?.name || 'LifeOS user'}
            </p>
            <p className="text-sm text-muted-foreground">
              {user?.email || 'Signed in with Supabase'}
            </p>
          </div>

          <Button variant="outline" className="gap-2" onClick={() => logout(true)}>
            <LogOut className="h-4 w-4" />
            Log Out
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Connections
        </h2>
        <GoogleConnectionsPanel />
      </div>
    </div>
  );
}
