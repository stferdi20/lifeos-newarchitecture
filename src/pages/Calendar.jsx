import React, { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, RefreshCw, CalendarDays } from 'lucide-react';
import { startOfWeek, endOfWeek, addWeeks, format, parseISO, isToday, isTomorrow } from 'date-fns';
import NaturalLanguageBar from '../components/calendar/NaturalLanguageBar';
import EventFormModal from '../components/calendar/EventFormModal';
import TimeBlockEvent from '../components/calendar/TimeBlockEvent';
import TemplateSelector from '../components/calendar/TemplateSelector';
import { toast } from 'sonner';
import { PageHeader, PageActionRow } from '@/components/layout/page-header';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getLocalQueryCacheOptions } from '@/lib/local-query-cache';

import { deleteCalendarEvent, fetchCalendarEvents } from '@/lib/calendar-api';

const WEEK_OPTIONS = [
  { label: 'This week', weeks: 0 },
  { label: 'Next week', weeks: 1 },
  { label: 'Next 2 weeks', weeks: 2 },
];

async function fetchEvents(weeksAhead = 1) {
  const now = new Date();
  const start = startOfWeek(now, { weekStartsOn: 1 });
  const end = endOfWeek(addWeeks(now, weeksAhead), { weekStartsOn: 1 });
  return fetchCalendarEvents({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    maxResults: 200,
  });
}

function groupEventsByDay(events) {
  const groups = {};
  events.forEach(e => {
    const dateStr = e.start?.date || e.start?.dateTime?.split('T')[0];
    if (!dateStr) return;
    if (!groups[dateStr]) groups[dateStr] = [];
    groups[dateStr].push(e);
  });
  return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
}

function getDayLabel(dateStr) {
  const d = parseISO(dateStr);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  return format(d, 'EEEE, MMM d');
}

export default function Calendar() {
  const [weeksAhead, setWeeksAhead] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [modalMode, setModalMode] = useState('manual');
  const [parsedSourceText, setParsedSourceText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const queryClient = useQueryClient();

  const { data: events = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['calendarEvents', weeksAhead],
    queryFn: () => fetchEvents(weeksAhead),
    ...getLocalQueryCacheOptions(['calendarEvents']),
  });

  const resetModalState = useCallback(() => {
    setModalOpen(false);
    setPrefill(null);
    setModalMode('manual');
    setParsedSourceText('');
  }, []);

  const handleParsed = useCallback((parsed, sourceText) => {
    setPrefill({
      title: parsed.title || '',
      date: parsed.date || '',
      start_time: parsed.start_time || '09:00',
      end_time: parsed.end_time || '10:00',
      is_deadline: parsed.is_deadline || false,
      location: parsed.location || '',
      location_detail: parsed.location_detail || '',
      meet_link: parsed.meet_link || '',
      description: parsed.description || '',
      category: parsed.category || 'personal',
      event_type: parsed.event_type || 'offline',
      recurrence_days: parsed.recurrence_days || [],
      recurrence_weeks: parsed.recurrence_weeks || 1,
      recurrence_end_date: parsed.recurrence_end_date || '',
      tags: parsed.tags || [],
    });
    setModalMode('parsed-review');
    setParsedSourceText(sourceText || '');
    setModalOpen(true);
  }, []);

  const handleTemplateSelect = (template) => {
    setPrefill({
      title: template.title || template.name,
      date: '',
      start_time: '09:00',
      end_time: '',
      is_deadline: false,
      location: template.location || '',
      location_detail: '',
      meet_link: template.meet_link || '',
      description: template.description || '',
      category: template.category || 'personal',
      event_type: template.event_type || 'offline',
      recurrence_days: template.recurrence_days || [],
      recurrence_weeks: template.recurrence_weeks || 1,
      recurrence_end_date: '',
      tags: [],
    });
    setModalMode('manual');
    setParsedSourceText('');
    setModalOpen(true);
  };

  const refreshCalendarQueries = useCallback(() => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['calendarEventsWidget'] });
  }, [queryClient, refetch]);

  const runDelete = useCallback(async ({ eventId, seriesId = null, deleteMode = 'single' }) => {
    setIsDeleting(true);
    try {
      await deleteCalendarEvent({ eventId, seriesId, deleteMode });
      toast.success(deleteMode === 'series' ? 'Recurring schedule deleted' : 'Event deleted');
      refreshCalendarQueries();
    } catch {
      toast.error(deleteMode === 'series' ? 'Failed to delete recurring schedule' : 'Failed to delete event');
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }, [refreshCalendarQueries]);

  const handleDelete = useCallback((event) => {
    if (event.recurringEventId) {
      setDeleteTarget({
        eventId: event.id,
        seriesId: event.recurringEventId,
        title: event.summary?.replace('[DEADLINE] ', '') || 'this event',
      });
      return;
    }

    runDelete({ eventId: event.id });
  }, [runDelete]);

  const grouped = groupEventsByDay(events);

  const todayEvents = events.filter(e => {
    const d = e.start?.date || e.start?.dateTime?.split('T')[0];
    return d === format(new Date(), 'yyyy-MM-dd');
  });

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <PageHeader
        icon={CalendarDays}
        title="Calendar"
        description={`${todayEvents.length} event${todayEvents.length !== 1 ? 's' : ''} today`}
        actions={(
          <PageActionRow>
            <TemplateSelector onSelect={handleTemplateSelect} />
            <button onClick={() => { setPrefill(null); setModalMode('manual'); setParsedSourceText(''); setModalOpen(true); }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 sm:w-auto">
              <Plus className="w-4 h-4" /> Add Event
            </button>
          </PageActionRow>
        )}
      />

      {/* Natural Language Bar */}
      <NaturalLanguageBar onParsed={handleParsed} />


      {/* Week selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {WEEK_OPTIONS.map(opt => (
          <button key={opt.weeks} onClick={() => setWeeksAhead(opt.weeks)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              weeksAhead === opt.weeks
                ? 'bg-primary/20 text-primary border-primary/30'
                : 'bg-secondary/20 text-muted-foreground border-border/30 hover:bg-secondary/40'
            }`}>
            {opt.label}
          </button>
        ))}
        <button onClick={() => refetch()}
          className="ml-auto shrink-0 p-1.5 rounded-lg hover:bg-secondary/40 text-muted-foreground transition-colors">
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Events grouped by day */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-secondary/20 animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Calendar data could not be loaded.</p>
              <p className="mt-1 text-amber-100/80">{error?.message || 'Please reconnect Google Calendar or try again.'}</p>
              <button onClick={() => refetch()} className="mt-2 text-xs font-medium text-white underline underline-offset-2">
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No events found. Add one above!</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([dateStr, dayEvents]) => (
            <div key={dateStr}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-sm font-semibold ${dateStr === format(new Date(), 'yyyy-MM-dd') ? 'text-primary' : 'text-foreground'}`}>
                  {getDayLabel(dateStr)}
                </span>
                <div className="flex-1 h-px bg-border/30" />
                <span className="text-xs text-muted-foreground">{dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {dayEvents.map(ev => (
                  <TimeBlockEvent key={ev.id} event={ev} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <EventFormModal
        open={modalOpen}
        onClose={resetModalState}
        prefill={prefill}
        mode={modalMode}
        sourceText={parsedSourceText}
        onStartOver={resetModalState}
        onCreated={() => { refetch(); queryClient.invalidateQueries({ queryKey: ['calendarEventsWidget'] }); }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete recurring schedule?</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `“${deleteTarget.title}” is part of a recurring schedule. Choose whether to delete only this event or the entire recurring schedule in Google Calendar as well.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => deleteTarget && runDelete({ eventId: deleteTarget.eventId })}
              disabled={isDeleting}
            >
              Delete this event only
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && runDelete({
                eventId: deleteTarget.eventId,
                seriesId: deleteTarget.seriesId,
                deleteMode: 'series',
              })}
              disabled={isDeleting}
            >
              Delete entire recurring schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
