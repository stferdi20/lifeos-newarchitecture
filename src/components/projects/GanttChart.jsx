import React, { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { differenceInDays, addDays, format, startOfDay, parseISO, isValid } from 'date-fns';
import { Circle, Play, CheckCircle2, AlertTriangle, CalendarPlus } from 'lucide-react';

const statusConfig = {
  todo: { color: 'bg-zinc-500', icon: Circle },
  doing: { color: 'bg-blue-500', icon: Play },
  done: { color: 'bg-emerald-500', icon: CheckCircle2 },
  archived: { color: 'bg-zinc-700', icon: Circle },
};

const priorityBorder = {
  high: 'ring-1 ring-red-500/50',
  medium: '',
  low: '',
};

const DAY_WIDTH = 36;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 52;
const LEFT_PANEL_WIDTH = 280;

function safeParse(dateStr) {
  if (!dateStr) return null;
  const d = parseISO(dateStr);
  return isValid(d) ? startOfDay(d) : null;
}

export default function GanttChart({
  cards,
  tasks,
  projects,
  lists,
  workspaces,
  activeWorkspaceId,
  onEditCard,
  onEditTask,
  onQuickSetDate,
}) {
  const [hoveredCardId, setHoveredCardId] = useState(null);
  const resolvedCards = cards || tasks || [];
  const handleEditCard = onEditCard || onEditTask || (() => {});

  const metadataMap = useMemo(() => {
    const projectById = Object.fromEntries(projects.map((project) => [project.id, project]));
    const listById = Object.fromEntries(lists.map((list) => [list.id, list]));
    const workspaceById = Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace]));
    return { projectById, listById, workspaceById };
  }, [projects, lists, workspaces]);

  const { timelineCards, unscheduledCards, timelineStart, totalDays } = useMemo(() => {
    const today = startOfDay(new Date());
    const scheduled = resolvedCards.filter((card) => card.start_date || card.due_date);
    const unscheduled = resolvedCards.filter((card) => !card.start_date && !card.due_date);

    const validDates = scheduled.flatMap((card) => [safeParse(card.start_date), safeParse(card.due_date)].filter(Boolean));
    if (scheduled.length === 0 || validDates.length === 0) {
      return {
        timelineCards: scheduled,
        unscheduledCards: unscheduled,
        timelineStart: addDays(today, -7),
        totalDays: 37,
      };
    }

    const minDate = validDates.reduce((a, b) => (a < b ? a : b), validDates[0]);
    const maxDate = validDates.reduce((a, b) => (a > b ? a : b), validDates[0]);
    const tlStart = addDays(minDate, -3);
    const tlEnd = addDays(maxDate, 7);

    const sortedScheduled = [...scheduled].sort((a, b) => {
      const aStart = safeParse(a.start_date) || safeParse(a.due_date) || today;
      const bStart = safeParse(b.start_date) || safeParse(b.due_date) || today;
      return aStart - bStart;
    });

    return {
      timelineCards: sortedScheduled,
      unscheduledCards: unscheduled,
      timelineStart: tlStart,
      totalDays: Math.max(differenceInDays(tlEnd, tlStart) + 1, 14),
    };
  }, [resolvedCards]);

  const days = useMemo(() => Array.from({ length: totalDays }, (_, i) => addDays(timelineStart, i)), [timelineStart, totalDays]);

  const today = startOfDay(new Date());
  const todayOffset = differenceInDays(today, timelineStart);

  const getBarProps = (card) => {
    const start = safeParse(card.start_date);
    const due = safeParse(card.due_date);
    if (!start && !due) return null;

    const barStart = start || due;
    const barEnd = due || start;
    const invalidRange = Boolean(start && due && due < start);

    return {
      left: differenceInDays(barStart, timelineStart) * DAY_WIDTH,
      width: Math.max((differenceInDays(barEnd, barStart) + 1) * DAY_WIDTH, DAY_WIDTH),
      invalidRange,
    };
  };

  const formatTooltip = (card) => {
    const projectName = metadataMap.projectById[card.project_id]?.name || 'No project';
    const listName = metadataMap.listById[card.list_id]?.name || 'No list';
    const workspaceId = card.workspace_id || activeWorkspaceId;
    const workspaceName = metadataMap.workspaceById[workspaceId]?.name || 'No workspace';

    return [
      `Card: ${card.title}`,
      `Workspace: ${workspaceName}`,
      `List: ${listName}`,
      `Project: ${projectName}`,
      card.start_date ? `Start: ${card.start_date}` : 'Start: Not set',
      card.due_date ? `Due: ${card.due_date}` : 'Due: Not set',
    ].join('\n');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/50 bg-card/50 overflow-hidden">
        <div className="flex">
          <div className="shrink-0 border-r border-border/50" style={{ width: LEFT_PANEL_WIDTH }}>
            <div className="h-[52px] flex items-center px-4 border-b border-border/50 bg-secondary/20">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Card</span>
            </div>
            {timelineCards.length === 0 ? (
              <div className="px-4 py-6 text-xs text-muted-foreground">Add start or due date on cards to see timeline.</div>
            ) : (
              timelineCards.map((card) => {
                const project = metadataMap.projectById[card.project_id];
                const StatusIcon = statusConfig[card.status]?.icon || Circle;
                const bar = getBarProps(card);
                return (
                  <div
                    key={card.id}
                    className={cn(
                      'flex items-center gap-2 px-4 border-b border-border/20 cursor-pointer hover:bg-secondary/30 transition-colors',
                      hoveredCardId === card.id && 'bg-secondary/30'
                    )}
                    style={{ height: ROW_HEIGHT }}
                    onMouseEnter={() => setHoveredCardId(card.id)}
                    onMouseLeave={() => setHoveredCardId(null)}
                    onClick={() => handleEditCard(card)}
                  >
                    <StatusIcon className={cn('w-3.5 h-3.5 shrink-0', card.status === 'done' ? 'text-emerald-400' : card.status === 'doing' ? 'text-blue-400' : 'text-zinc-400')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{card.title}</p>
                      {bar?.invalidRange ? (
                        <p className="text-[10px] text-amber-400 truncate">Invalid date range: due date is before start date.</p>
                      ) : (
                        project && <p className="text-[10px] text-muted-foreground truncate">{project.name}</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex-1 overflow-hidden">
            <div className="overflow-auto">
              <div className="sticky top-0 z-30 bg-card/90 backdrop-blur-sm border-b border-border/50" style={{ height: HEADER_HEIGHT, minWidth: totalDays * DAY_WIDTH }}>
                <div className="flex h-full">
                  {days.map((day, i) => {
                    const isToday = format(day, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd');
                    return (
                      <div key={i} className={cn('border-r border-border/20 flex flex-col justify-center items-center', isToday && 'bg-blue-500/10')} style={{ width: DAY_WIDTH }}>
                        <span className={cn('text-[10px] font-semibold', isToday ? 'text-blue-400' : 'text-foreground/80')}>{format(day, 'd')}</span>
                        <span className={cn('text-[8px]', isToday ? 'text-blue-400' : 'text-muted-foreground/50')}>{format(day, 'EEE')}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="relative" style={{ height: Math.max(timelineCards.length, 1) * ROW_HEIGHT, minWidth: totalDays * DAY_WIDTH }}>
                {todayOffset >= 0 && todayOffset < totalDays && (
                  <div className="absolute top-0 bottom-0 w-px bg-blue-500/40 z-10" style={{ left: todayOffset * DAY_WIDTH + DAY_WIDTH / 2 }} />
                )}

                {days.map((day, i) => {
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  if (!isWeekend) return null;
                  return <div key={`w-${i}`} className="absolute top-0 bottom-0 bg-secondary/10" style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }} />;
                })}

                {timelineCards.map((_, i) => (
                  <div key={`r-${i}`} className="absolute w-full border-b border-border/10" style={{ top: (i + 1) * ROW_HEIGHT }} />
                ))}

                {timelineCards.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    Add start or due date on cards to see timeline.
                  </div>
                ) : (
                  timelineCards.map((card, i) => {
                    const bar = getBarProps(card);
                    if (!bar) return null;

                    const isOverdue = card.due_date && card.status !== 'done' && safeParse(card.due_date) < today;
                    const barColor = statusConfig[card.status]?.color || 'bg-zinc-500';

                    return (
                      <div
                        key={card.id}
                        className={cn(
                          'absolute rounded-md flex items-center px-2 cursor-pointer transition-all',
                          bar.invalidRange ? 'bg-amber-600/80 ring-1 ring-amber-300/70 border border-amber-200/40' : barColor,
                          isOverdue && 'ring-1 ring-red-500/60',
                          priorityBorder[card.priority],
                          hoveredCardId === card.id ? 'opacity-100 shadow-lg scale-y-110' : 'opacity-80'
                        )}
                        style={{
                          top: i * ROW_HEIGHT + 8,
                          height: ROW_HEIGHT - 16,
                          left: bar.left,
                          width: bar.width,
                        }}
                        onMouseEnter={() => setHoveredCardId(card.id)}
                        onMouseLeave={() => setHoveredCardId(null)}
                        onClick={() => handleEditCard(card)}
                        title={formatTooltip(card)}
                      >
                        <span className="text-[10px] font-medium text-white truncate">{card.title}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-border/50 bg-secondary/10">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-3 h-2 rounded-sm bg-zinc-500" /> To Do
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-3 h-2 rounded-sm bg-blue-500" /> In Progress
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-3 h-2 rounded-sm bg-emerald-500" /> Done
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400">
            <AlertTriangle className="w-3 h-3" /> Invalid date range
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Unscheduled Cards</h3>
          <p className="text-xs text-muted-foreground">Cards with no start date and no due date.</p>
        </div>

        {unscheduledCards.length === 0 ? (
          <p className="text-xs text-muted-foreground">All cards are scheduled.</p>
        ) : (
          <div className="space-y-2">
            {unscheduledCards.map((card) => (
              <div key={card.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 px-3 py-2">
                <button type="button" className="text-left min-w-0" onClick={() => handleEditCard(card)} title={formatTooltip(card)}>
                  <p className="text-xs font-medium truncate">{card.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {metadataMap.listById[card.list_id]?.name || 'No list'} • {metadataMap.workspaceById[card.workspace_id || activeWorkspaceId]?.name || 'No workspace'}
                  </p>
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="text-[10px] px-2 py-1 rounded-md border border-border/60 hover:bg-secondary/30"
                    onClick={() => onQuickSetDate?.(card, 'start_date')}
                  >
                    <CalendarPlus className="w-3 h-3 inline mr-1" /> Set start
                  </button>
                  <button
                    type="button"
                    className="text-[10px] px-2 py-1 rounded-md border border-border/60 hover:bg-secondary/30"
                    onClick={() => onQuickSetDate?.(card, 'due_date')}
                  >
                    <CalendarPlus className="w-3 h-3 inline mr-1" /> Set due
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
