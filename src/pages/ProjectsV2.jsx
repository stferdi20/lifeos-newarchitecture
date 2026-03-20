import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listBoardCards, listBoardLists, listBoardWorkspaces } from '@/lib/projects-api';
import { migrateKanbanV2, getKanbanV2MigrationState } from '@/lib/kanbanMigration';
import { Button } from '@/components/ui/button';
import { createPageUrl } from '@/utils';
import { PageHeader, PageActionRow } from '@/components/layout/page-header';

const rolloutSteps = [
  'Internal test workspace',
  'One real workspace pilot',
  'Full cutover and remove legacy category/status flows',
];

export default function ProjectsV2() {
  const queryClient = useQueryClient();
  const [runningMigration, setRunningMigration] = useState(false);
  const [report, setReport] = useState(null);

  const { data: workspaces = [] } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => listBoardWorkspaces(),
    initialData: [],
  });

  const { data: lists = [] } = useQuery({
    queryKey: ['workspace-lists'],
    queryFn: async () => (await Promise.all(workspaces.map((workspace) => listBoardLists(workspace.id)))).flat(),
    enabled: workspaces.length > 0,
    initialData: [],
  });

  const { data: cards = [] } = useQuery({
    queryKey: ['workspace-cards'],
    queryFn: async () => (await Promise.all(workspaces.map((workspace) => listBoardCards(workspace.id)))).flat(),
    enabled: workspaces.length > 0,
    initialData: [],
  });

  const runMigration = async ({ dryRun }) => {
    setRunningMigration(true);
    try {
      const result = await migrateKanbanV2({ dryRun });
      setReport(result);
      if (!dryRun) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
          queryClient.invalidateQueries({ queryKey: ['workspace-lists'] }),
          queryClient.invalidateQueries({ queryKey: ['workspace-cards'] }),
        ]);
      }
    } catch (error) {
      setReport({ error: error.message || 'Migration failed unexpectedly.' });
    } finally {
      setRunningMigration(false);
    }
  };

  const verificationState = getKanbanV2MigrationState();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects (Kanban v2)"
        description="Workspace/List/Card model with migration verification checks."
        actions={(
          <PageActionRow>
            <Link to={createPageUrl('ProjectsLegacy')} className="w-full sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto">Open Legacy Board</Button>
            </Link>
          </PageActionRow>
        )}
      />

      <div className="rounded-xl border border-border p-4 bg-card space-y-3">
        <p className="text-sm font-medium">Migration controls</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button className="w-full sm:w-auto" disabled={runningMigration} variant="outline" onClick={() => runMigration({ dryRun: true })}>Run Dry-Run Verification</Button>
          <Button className="w-full sm:w-auto" disabled={runningMigration} onClick={() => runMigration({ dryRun: false })}>Run One-Time Migration</Button>
        </div>
        <p className="text-xs text-muted-foreground">Stored status: {verificationState || 'not started'}</p>
        {report && (
          <pre className="text-xs bg-secondary/40 p-3 rounded-lg overflow-x-auto">{JSON.stringify(report, null, 2)}</pre>
        )}
      </div>

      <div className="rounded-xl border border-border p-4 bg-card">
        <p className="text-sm font-medium mb-2">Rollout plan</p>
        <ol className="list-decimal pl-5 text-sm space-y-1 text-muted-foreground">
          {rolloutSteps.map(step => <li key={step}>{step}</li>)}
        </ol>
      </div>

      <div className="space-y-4">
        {workspaces.map(workspace => {
          const workspaceLists = lists.filter(list => list.workspace_id === workspace.id);
          return (
            <div key={workspace.id} className="rounded-xl border border-border p-4 bg-card">
              <div className="mb-3">
                <p className="font-semibold">{workspace.name}</p>
                <p className="text-xs text-muted-foreground">Drive folder: {workspace.drive_folder_id || 'none'}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {workspaceLists.map(list => {
                  const listCards = cards.filter(card => card.list_id === list.id);
                  return (
                    <div key={list.id} className="rounded-lg border border-border/60 p-3 bg-secondary/20">
                      <p className="text-sm font-medium mb-2">{list.name} ({listCards.length})</p>
                      <div className="space-y-2">
                        {listCards.slice(0, 6).map(card => (
                          <div key={card.id} className="rounded-md border border-border/60 p-2 bg-card">
                            <p className="text-xs font-medium">{card.title}</p>
                          </div>
                        ))}
                        {listCards.length > 6 && <p className="text-xs text-muted-foreground">+{listCards.length - 6} more</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
