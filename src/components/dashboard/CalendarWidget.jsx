import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Plus, ChevronRight, Loader2 } from 'lucide-react';
import { format, startOfDay, endOfWeek } from 'date-fns';
import EventCard from '../calendar/EventCard';
import EventFormModal from '../calendar/EventFormModal';
import { Link } from 'react-router-dom';
import { fetchCalendarEvents } from '@/lib/calendar-api';

async function fetchWidgetEvents() {
  const now = new Date();
  return fetchCalendarEvents({
    timeMin: startOfDay(now).toISOString(),
    timeMax: endOfWeek(now, { weekStartsOn: 1 }).toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    maxResults: 32,
  });
}

export default function CalendarWidget() {
  const [modalOpen, setModalOpen] = useState(false);
  const [view, setView] = useState('today'); // 'today' | 'week'

  const { data: events = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['calendarEventsWidget'],
    queryFn: fetchWidgetEvents,
    staleTime: 120_000,
  });

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const todayEvents = events.filter(e => {
    const d = e.start?.date || e.start?.dateTime?.split('T')[0];
    return d === todayStr;
  });

  const weekEvents = events.filter(e => {
    const d = e.start?.date || e.start?.dateTime?.split('T')[0];
    return d > todayStr;
  }).slice(0, 5);

  const displayEvents = view === 'today' ? todayEvents : weekEvents;

  return (
    <div className="bg-card border border-border/40 rounded-2xl p-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Calendar</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setModalOpen(true)}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <Link to="/Calendar"
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Tab */}
      <div className="flex gap-1 mb-3 bg-secondary/20 rounded-lg p-0.5">
        {['today', 'week'].map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`flex-1 min-w-0 py-1 rounded-md text-[11px] sm:text-xs font-medium transition-all capitalize ${
              view === v ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'
            }`}>
            {v === 'today' ? `Today (${todayEvents.length})` : `Upcoming (${weekEvents.length})`}
          </button>
        ))}
      </div>

      {/* Events */}
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-left text-xs text-amber-100">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">Calendar data could not be loaded.</p>
                <p className="mt-1 text-amber-100/80">{error?.message || 'Please reconnect Google Calendar or try again.'}</p>
                <button onClick={() => refetch()} className="mt-2 text-[11px] font-medium text-white underline underline-offset-2">
                  Try again
                </button>
              </div>
            </div>
          </div>
        ) : displayEvents.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs text-muted-foreground">
              {view === 'today' ? 'Nothing scheduled today 🎉' : 'No upcoming events'}
            </p>
            <button onClick={() => setModalOpen(true)}
              className="mt-2 text-xs text-primary hover:underline">Add event</button>
          </div>
        ) : (
          displayEvents.map(ev => <EventCard key={ev.id} event={ev} compact />)
        )}
      </div>

      <EventFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => refetch()}
      />
    </div>
  );
}
