import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, ChevronRight, CalendarDays } from 'lucide-react';
import { format, parseISO, differenceInMinutes, isAfter } from 'date-fns';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { fetchCalendarEvents } from '@/lib/calendar-api';

const CATEGORY_BARS = {
  personal: 'bg-purple-500',
  work: 'bg-blue-500',
  academic: 'bg-emerald-500',
  church: 'bg-yellow-500',
  family: 'bg-red-500',
  love: 'bg-pink-500',
};

const CATEGORY_BG = {
  personal: 'bg-purple-500/8',
  work: 'bg-blue-500/8',
  academic: 'bg-emerald-500/8',
  church: 'bg-yellow-500/8',
  family: 'bg-red-500/8',
  love: 'bg-pink-500/8',
};

function extractCategory(event) {
  const colorMap = { '3': 'personal', '9': 'work', '2': 'academic', '5': 'church', '11': 'family', '4': 'love' };
  return colorMap[event.colorId] || 'personal';
}

async function fetchTodayEvents() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return fetchCalendarEvents({
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    maxResults: 24,
  }).then((events) => events.sort((a, b) => {
    const aTime = a.start?.dateTime || a.start?.date || '';
    const bTime = b.start?.dateTime || b.start?.date || '';
    return aTime.localeCompare(bTime);
  }));
}

function MiniTimeBlock({ event, isNext }) {
  const title = event.summary?.replace('[DEADLINE] ', '') || 'Untitled';
  const isDeadline = event.summary?.startsWith('[DEADLINE]');
  const category = extractCategory(event);
  const barColor = isDeadline ? 'bg-red-500' : (CATEGORY_BARS[category] || CATEGORY_BARS.personal);
  const bgColor = isDeadline ? 'bg-red-500/8' : (CATEGORY_BG[category] || CATEGORY_BG.personal);

  const startTime = event.start?.dateTime ? format(parseISO(event.start.dateTime), 'h:mm a') : null;
  const endTime = event.end?.dateTime ? format(parseISO(event.end.dateTime), 'h:mm a') : null;
  const duration = event.start?.dateTime && event.end?.dateTime
    ? differenceInMinutes(parseISO(event.end.dateTime), parseISO(event.start.dateTime))
    : null;

  const now = new Date();
  const isHappening = event.start?.dateTime && event.end?.dateTime
    && isAfter(now, parseISO(event.start.dateTime))
    && isAfter(parseISO(event.end.dateTime), now);

  return (
    <div className={cn(
      'relative flex rounded-lg overflow-hidden transition-all',
      bgColor,
      isNext && !isHappening && 'ring-1 ring-primary/30',
      isHappening && 'ring-1 ring-emerald-500/40'
    )}>
      <div className={cn('w-1 shrink-0', barColor)} />
      <div className="flex-1 px-3 py-2 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-foreground truncate flex-1 leading-tight">
            {isDeadline && '🚨 '}{title}
          </p>
          {isHappening && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold uppercase shrink-0">
              Now
            </span>
          )}
          {isNext && !isHappening && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary font-bold uppercase shrink-0">
              Next
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-muted-foreground">
            {startTime ? `${startTime}${endTime ? ` – ${endTime}` : ''}` : 'All day'}
          </span>
          {duration && (
            <span className="text-[10px] text-muted-foreground/60">
              {duration >= 60 ? `${Math.floor(duration / 60)}h${duration % 60 ? `${duration % 60}m` : ''}` : `${duration}m`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TodaySchedule() {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['todaySchedule'],
    queryFn: fetchTodayEvents,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const now = new Date();

  // Find next upcoming event index
  const nextIdx = events.findIndex(e => {
    const start = e.start?.dateTime || e.start?.date;
    return start && isAfter(parseISO(start), now);
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-[#151020] via-card to-card border border-primary/10 p-5 h-full hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Today's Schedule</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-lg bg-secondary/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#151020] via-card to-card border border-primary/10 p-5 h-full flex flex-col hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Today's Schedule</span>
        </div>
        <span className="text-[11px] sm:text-xs text-muted-foreground shrink-0">{format(now, 'EEE, MMM d')}</span>
      </div>

      {events.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 text-center">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-2">
            <Clock className="w-5 h-5 text-primary/50" />
          </div>
          <p className="text-xs text-muted-foreground">No events today</p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">Enjoy your free day!</p>
        </div>
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[260px] pr-1 -mr-1">
          {events.map((event, i) => (
            <MiniTimeBlock key={event.id} event={event} isNext={i === nextIdx} />
          ))}
        </div>
      )}

      <Link
        to="/Calendar"
        className="mt-3 pt-3 border-t border-border/30 flex items-center justify-center gap-1 text-xs font-medium text-primary/70 hover:text-primary transition-colors"
      >
        Open calendar <ChevronRight className="w-3 h-3" />
      </Link>
    </div>
  );
}
