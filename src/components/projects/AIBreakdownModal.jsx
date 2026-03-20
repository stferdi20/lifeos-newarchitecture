import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, Loader2, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateStructuredAi } from '@/lib/ai-api';
import { createBoardCard } from '@/lib/projects-api';
import { createStandaloneTaskRecord } from '@/lib/tasks';

const PRIORITY_COLORS = {
  low: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  high: 'bg-red-500/10 text-red-400 border-red-500/20',
};

export default function AIBreakdownModal({ open, onClose, projects, onTasksCreated, selectedWorkspaceId, defaultListId }) {
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [slowMessage, setSlowMessage] = useState('');
  const [showCreatePreview, setShowCreatePreview] = useState(false);

  const trackEvent = (eventName, payload = {}) => {
    if (typeof window === 'undefined') return;
    const eventPayload = {
      eventName,
      timestamp: new Date().toISOString(),
      ...payload,
    };
    window.dispatchEvent(new CustomEvent('ai-breakdown-telemetry', { detail: eventPayload }));
  };

  const selectedSuggestions = useMemo(
    () => suggestions.filter((_, i) => selected.has(i)),
    [suggestions, selected]
  );

  useEffect(() => {
    if (open) {
      trackEvent('ai_breakdown_open', {
        projectCount: projects.length,
        hasWorkspaceContext: Boolean(selectedWorkspaceId && defaultListId),
      });
    }
  }, [open, projects.length, selectedWorkspaceId, defaultListId]);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setSuggestions([]);
    setSelected(new Set());
    setShowCreatePreview(false);
    setErrorMessage('');
    setSlowMessage('AI is generating your task plan...');

    const timeoutId = setTimeout(() => {
      setSlowMessage('This is taking longer than expected. You can keep waiting while we generate your tasks.');
    }, 6000);

    const project = projects.find(p => p.id === projectId);
    const projectContext = project ? `Project: ${project.name}${project.description ? ' - ' + project.description : ''}` : '';
    trackEvent('ai_breakdown_submit', {
      projectId: projectId || null,
      hasProjectContext: Boolean(project),
      descriptionLength: description.trim().length,
    });

    try {
      const prompt = `You are a project management expert. Break down the following project/goal into actionable tasks.

${projectContext}

Description: ${description}

Generate 5-10 concrete, actionable tasks. Each task should be specific and achievable. Assign a priority (low, medium, high) based on importance and dependencies.

Return JSON:
{
  "tasks": [
    {
      "title": "...",
      "description": "...",
      "priority": "low|medium|high"
    }
  ]
}`;
      const result = await generateStructuredAi({
        taskType: 'generic.structured',
        prompt,
        policy: { tier: 'standard', maxTokens: 1200, temperature: 0.2 },
        metadata: { requestSummary: `ai-breakdown:${projectId || 'none'}` },
      });

      const tasks = result.tasks || [];
      setSuggestions(tasks);
      setSelected(new Set(tasks.map((_, i) => i)));
      setSlowMessage(tasks.length ? `Generated ${tasks.length} tasks. Review, edit selection, then confirm create.` : 'No tasks were generated. Try providing more context.');
      trackEvent('ai_breakdown_generation_success', {
        generatedCount: tasks.length,
        projectId: projectId || null,
      });
    } catch (error) {
      const message = error?.message || 'We could not generate tasks right now. Please try again.';
      setErrorMessage(message);
      setSlowMessage('');
      trackEvent('ai_breakdown_generation_failure', {
        projectId: projectId || null,
        errorMessage: message,
      });
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const toggleSelect = (idx) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleCreate = async () => {
    const toCreate = selectedSuggestions.map(t => ({
      title: t.title,
      description: t.description,
      priority: t.priority || 'medium',
      status: 'todo',
      project_id: projectId || undefined,
    }));
    if (toCreate.length === 0) return;

    setCreating(true);
    setErrorMessage('');
    setSlowMessage('Creating selected tasks...');

    try {
      let createdRecords = [];
      if (selectedWorkspaceId && defaultListId) {
        createdRecords = await Promise.all(
          toCreate.map((item, index) => createBoardCard({
            ...item,
            workspace_id: selectedWorkspaceId,
            list_id: defaultListId,
            position: index * 10,
          }))
        );
      } else {
        createdRecords = await Promise.all(toCreate.map((item) => createStandaloneTaskRecord(item)));
      }

      trackEvent('ai_breakdown_create_selected', {
        selectedCount: toCreate.length,
        createdCount: createdRecords?.length || toCreate.length,
        destination: selectedWorkspaceId && defaultListId ? 'card' : 'task',
        projectId: projectId || null,
      });

      onTasksCreated(createdRecords || []);
      handleClose();
    } catch (error) {
      const message = error?.message || 'We could not create tasks right now. Please try again.';
      setErrorMessage(message);
      trackEvent('ai_breakdown_create_failure', {
        selectedCount: toCreate.length,
        destination: selectedWorkspaceId && defaultListId ? 'card' : 'task',
        errorMessage: message,
      });
    } finally {
      setCreating(false);
      setSlowMessage('');
    }
  };

  const handleClose = () => {
    setSuggestions([]);
    setSelected(new Set());
    setDescription('');
    setProjectId('');
    setErrorMessage('');
    setSlowMessage('');
    setShowCreatePreview(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-400" />
            AI Task Breakdown
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1 overflow-y-auto">
          {projects.length > 0 && (
            <Select value={projectId || 'none'} onValueChange={v => setProjectId(v === 'none' ? '' : v)}>
              <SelectTrigger className="bg-secondary/40 border-border/50">
                <SelectValue placeholder="Assign to project (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No project</SelectItem>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe scope, constraints, and deliverables. Example: 'Build a personal blog with Next.js, add auth, markdown posts, and deploy to Vercel in 2 weeks.'"
            className="bg-secondary/40 border-border/50 min-h-[100px]"
          />

          <p className="text-xs text-muted-foreground">
            Input: your project goal, constraints, and desired outcome. Output: 5-10 prioritized, actionable tasks you can review before creating cards.
          </p>

          <Button
            onClick={handleGenerate}
            disabled={loading || !description.trim()}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            {loading ? 'Generating tasks...' : 'Generate Task Breakdown'}
          </Button>

          {!!slowMessage && <p className="text-xs text-muted-foreground">{slowMessage}</p>}
          {!!errorMessage && <p className="text-xs text-red-400">{errorMessage}</p>}
          <p className="text-[11px] text-muted-foreground/80">
            Instrumentation window active: we'll use conversion metrics from this flow before deciding whether AI Breakdown remains in the header, moves to card-level actions, or is removed.
          </p>

          {/* Suggestions list */}
          {suggestions.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{selected.size} of {suggestions.length} selected</p>
                <button
                  onClick={() => {
                    if (selected.size === suggestions.length) setSelected(new Set());
                    else setSelected(new Set(suggestions.map((_, i) => i)));
                  }}
                  className="text-xs text-violet-400 hover:text-violet-300"
                >
                  {selected.size === suggestions.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>

              {suggestions.map((task, idx) => (
                <button
                  key={idx}
                  onClick={() => toggleSelect(idx)}
                  className={cn(
                    'w-full text-left p-3 rounded-xl border transition-all',
                    selected.has(idx)
                      ? 'bg-violet-500/5 border-violet-500/30'
                      : 'bg-secondary/20 border-border/30 opacity-60'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <div className={cn(
                      'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors',
                      selected.has(idx) ? 'bg-violet-500 border-violet-500' : 'border-border'
                    )}>
                      {selected.has(idx) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{task.title}</p>
                      {task.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{task.description}</p>}
                    </div>
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full border shrink-0', PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium)}>
                      {task.priority}
                    </span>
                  </div>
                </button>
              ))}

              {!showCreatePreview ? (
                <Button
                  onClick={() => setShowCreatePreview(true)}
                  disabled={creating || selected.size === 0}
                  className="w-full bg-primary hover:bg-primary/90 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Preview & Confirm {selected.size} Task{selected.size !== 1 ? 's' : ''}
                </Button>
              ) : (
                <div className="space-y-2 rounded-xl border border-border/50 bg-secondary/20 p-3">
                  <p className="text-xs text-muted-foreground">Final preview: these selected tasks will be written to your board.</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {selectedSuggestions.map((task, idx) => (
                      <p key={`${task.title}-${idx}`} className="text-xs text-foreground/90">• {task.title}</p>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setShowCreatePreview(false)} disabled={creating}>
                      Back
                    </Button>
                    <Button
                      onClick={handleCreate}
                      disabled={creating || selected.size === 0}
                      className="flex-1 bg-primary hover:bg-primary/90 text-white"
                    >
                      {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                      Confirm Create
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
