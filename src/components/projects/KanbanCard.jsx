import React, { useState } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import { Calendar, CheckSquare, AlignLeft, Sparkles, Paperclip, Clock3 } from 'lucide-react';
import { format } from 'date-fns';
import { summarizeCard } from '@/lib/projects-api';

const priorityBar = {
  low: 'bg-zinc-500',
  medium: 'bg-amber-500',
  high: 'bg-red-500',
};

const priorityPill = {
  low: 'bg-zinc-500/20 text-zinc-400',
  medium: 'bg-amber-500/20 text-amber-400',
  high: 'bg-red-500/20 text-red-400',
};

function labelStyle(color) {
  return {
    backgroundColor: `${color}1a`,
    borderColor: `${color}55`,
    color,
  };
}

export default function KanbanCard({ task, projects, onEdit, index }) {
  const project = (projects || []).find((p) => p.id === task.project_id || p.id === task.workspace_id);
  const checklist = task.checklist || [];
  const completedChecklist = checklist.filter(i => i.done).length;
  const checkProgress = checklist.length > 0 ? Math.round((completedChecklist / checklist.length) * 100) : 0;
  const [showAISummary, setShowAISummary] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [loadingAI, setLoadingAI] = useState(false);

  const isTerminalStatus = task.status === 'done' || task.status === 'archived';
  const isOverdue = task.due_date && !isTerminalStatus && new Date(task.due_date) < new Date();

  const generateAISummary = async (e) => {
    e.stopPropagation();
    if (loadingAI || aiSummary) return;

    setLoadingAI(true);
    try {
      const data = await summarizeCard({
        title: task.title,
        description: task.description || '',
        checklist: task.checklist || [],
        priority: task.priority || 'medium',
        due_date: task.due_date || '',
      });
      setAiSummary(data);
      setShowAISummary(true);
    } catch (error) {
      console.error('Failed to generate summary:', error);
    } finally {
      setLoadingAI(false);
    }
  };

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={() => onEdit(task)}
          className={cn(
            'rounded-xl bg-card border border-border/50 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 cursor-pointer group relative overflow-hidden mb-2.5',
            'transition-[opacity,transform,box-shadow] duration-150',
            snapshot.isDragging ? 'opacity-90 scale-[1.01] shadow-2xl shadow-primary/10 rotate-[1deg]' : 'opacity-100 scale-100'
          )}
          style={provided.draggableProps.style}
        >
          <div className={cn('absolute left-0 top-0 bottom-0 w-0.5', priorityBar[task.priority] || priorityBar.medium)} />
          {task.cover?.type === 'color' && task.cover?.value && (
            <div className="h-14 w-full" style={{ background: task.cover.value }} />
          )}
          {task.cover?.type === 'image' && task.cover?.value && (
            <div className="h-20 w-full overflow-hidden">
              <img src={task.cover.value} alt="Card cover" className="w-full h-full object-cover" />
            </div>
          )}

          <div className="p-3 pl-4">
            {project && (
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {project.name}
              </span>
            )}

            <p className="text-sm font-medium text-foreground mt-1 leading-snug break-words">{task.title}</p>

            {(task.labels || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {(task.labels || []).slice(0, 3).map((label) => (
                  <span
                    key={label.id || `${label.text}-${label.color}`}
                    className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                    style={labelStyle(label.color || '#64748b')}
                  >
                    {label.text}
                  </span>
                ))}
              </div>
            )}

            {task.description && (
              <div className="flex items-center gap-1 mt-2 min-w-0">
                <AlignLeft className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                <p className="text-xs text-muted-foreground line-clamp-2 break-words">{task.description}</p>
              </div>
            )}

            {checklist.length > 0 && (
              <div className="mt-2.5">
                <div className="flex items-center gap-1.5 mb-1">
                  <CheckSquare className="w-3 h-3 text-muted-foreground/60" />
                  <span className="text-[10px] text-muted-foreground">{completedChecklist}/{checklist.length}</span>
                </div>
                <div className="h-1 bg-secondary/60 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all', checkProgress === 100 ? 'bg-emerald-500' : 'bg-blue-500')}
                    style={{ width: `${checkProgress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 mt-3 flex-wrap min-w-0">
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize', priorityPill[task.priority] || priorityPill.medium)}>
                {task.priority || 'medium'}
              </span>

              {task.due_date && (
                <span className={cn('text-[10px] flex items-center gap-1', isOverdue ? 'text-red-400' : 'text-muted-foreground')}>
                  <Calendar className="w-3 h-3" />
                  {format(new Date(task.due_date), 'MMM d')}
                </span>
              )}

              {task.attached_files && task.attached_files.length > 0 && (
                <span className="text-[10px] flex items-center gap-1 text-muted-foreground">
                  <Paperclip className="w-3 h-3" />
                  {task.attached_files.length}
                </span>
              )}

              {task.estimate && (
                <span className="text-[10px] flex items-center gap-1 text-muted-foreground">
                  <Clock3 className="w-3 h-3" />
                  {task.estimate}
                </span>
              )}

              <button
                onClick={generateAISummary}
                disabled={loadingAI}
                className="ml-auto text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
                title="Generate AI summary and suggestions"
              >
                <Sparkles className={cn('w-3 h-3', loadingAI && 'animate-spin')} />
              </button>
            </div>

            {showAISummary && aiSummary && (
              <div className="mt-3 pt-3 border-t border-border/30 space-y-2 text-xs">
                <p className="text-muted-foreground italic break-words">{aiSummary.summary}</p>
                {aiSummary.nextSteps && aiSummary.nextSteps.length > 0 && (
                  <div>
                    <p className="font-medium text-foreground mb-1">Next Steps:</p>
                    <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                      {aiSummary.nextSteps.slice(0, 2).map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiSummary.risks && aiSummary.risks.length > 0 && (
                  <div>
                    <p className="font-medium text-red-400">Risks:</p>
                    <ul className="list-disc list-inside text-red-300/70 space-y-0.5">
                      {aiSummary.risks.slice(0, 1).map((risk, i) => (
                        <li key={i}>{risk}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}
