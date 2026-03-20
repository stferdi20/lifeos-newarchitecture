import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, MapPin, Video, ChevronRight } from 'lucide-react';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import { Link } from 'react-router-dom';
import { fetchCalendarEvents } from '@/lib/calendar-api';

async function fetchNextEvent() {
  const now = new Date();
  const events = await fetchCalendarEvents({
    timeMin: now.toISOString(),
    timeMax: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    maxResults: 20,
  });
  // Find the first upcoming event
  return events.find(e => {
    const start = e.start?.dateTime || e.start?.date;
    return new Date(start) >= now;
  }) || null;
}

export default function NextUpEvent() {
  const [timeUntil, setTimeUntil] = useState('');
  const { data: event, isLoading } = useQuery({
    queryKey: ['nextUpEvent'],
    queryFn: fetchNextEvent,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!event) return;
    const updateCountdown = () => {
      const start = event.start?.dateTime || event.start?.date;
      const mins = differenceInMinutes(new Date(start), new Date());
      if (mins < 0) {
        setTimeUntil('In progress');
      } else if (mins === 0) {
        setTimeUntil('Starting now');
      } else if (mins < 60) {
        setTimeUntil(`Starts in ${mins}m`);
      } else {
        const hours = Math.floor(mins / 60);
        setTimeUntil(`Starts in ${hours}h ${mins % 60}m`);
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 30_000);
    return () => clearInterval(interval);
  }, [event]);

  if (isLoading || !event) {
    return (
      <div className="rounded-2xl bg-card border border-border/50 p-5 h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground">No upcoming events</p>
      </div>
    );
  }

  const start = event.start?.dateTime || event.start?.date;
  const startDate = parseISO(start);
  const timeStr = event.start?.dateTime 
    ? format(startDate, 'h:mm a')
    : 'All day';
  
  const hasLocation = event.location || event.description?.includes('📍');
  const hasMeet = event.description?.includes('Meet Link') || event.conferenceData;

  return (
    <div className="rounded-2xl bg-card border border-border/50 p-5 h-full relative overflow-hidden">
      {/* Subtle accent glow */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 space-y-3">
        {/* Title & Time */}
        <div>
          <h3 className="font-semibold text-foreground text-base leading-tight">
            {event.summary}
          </h3>
          <p className="text-sm text-blue-600 dark:text-blue-400 font-medium mt-1">
            {timeUntil}
          </p>
        </div>

        {/* Details */}
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-blue-500" />
            <span>{timeStr} • {format(startDate, 'MMM d')}</span>
          </div>
          
          {hasLocation && (
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-blue-500" />
              <span className="line-clamp-1">{event.location || 'Location details in notes'}</span>
            </div>
          )}

          {hasMeet && (
            <div className="flex items-center gap-2">
              <Video className="w-3.5 h-3.5 text-blue-500" />
              <span>Online meeting</span>
            </div>
          )}
        </div>

        {/* View Calendar Link */}
        <Link
          to="/Calendar"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors mt-1"
        >
          View calendar <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
