import React from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import GoogleConnectionsPanel from '@/components/google/GoogleConnectionsPanel';

export default function Settings() {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        description="Manage your connections and preferences"
      />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
          Connections
        </h2>
        <GoogleConnectionsPanel />
      </div>
    </div>
  );
}
