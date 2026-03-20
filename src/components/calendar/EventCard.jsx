import React from 'react';
import { MapPin, Video, Clock, Trash2, ExternalLink } from 'lucide-react';
import { getCategoryConfig } from './CategoryBadge';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';

function extractCategory(event) {
  // Try to infer category from colorId
  const colorMap = { '3': 'personal', '9': 'work', '2': 'academic', '5': 'church', '11': 'family', '4': 'love' };
  return colorMap[event.colorId] || 'personal';
}

function extractMeetLink(description) {
  if (!description) return null;
  const match = description.match(/Meet(?:ing)? Link: (https?:\/\/[^\s]+)/);
  return match ? match[1] : null;
}

export default function EventCard({ event, onDelete, compact = false }) {
  const isDeadline = event.summary?.startsWith('[DEADLINE]');
  const title = isDeadline ? event.summary.replace('[DEADLINE] ', '') : event.summary;
  const category = extractCategory(event);
  const cfg = getCategoryConfig(category);
  const meetLink = extractMeetLink(event.description);
  const hasLocation = !!event.location;

  const startTime = event.start?.dateTime
    ? format(parseISO(event.start.dateTime), 'h:mm a')
    : null;
  const endTime = event.end?.dateTime
    ? format(parseISO(event.end.dateTime), 'h:mm a')
    : null;

  if (compact) {
    return (
      <div className={cn('flex items-center gap-2 p-2 rounded-lg border transition-colors',
        isDeadline ? 'bg-red-500/10 border-red-500/20' : 'bg-secondary/20 border-border/20 hover:bg-secondary/30')}>
        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', isDeadline ? 'bg-red-400' : '')}
          style={!isDeadline ? { backgroundColor: cfg.color?.split('text-')[1] } : {}} />
        <span className="text-xs font-medium truncate flex-1">{isDeadline ? '🚨 ' : ''}{title}</span>
        {startTime && <span className="text-xs text-muted-foreground shrink-0">{startTime}</span>}
      </div>
    );
  }

  return (
    <div className={cn('p-3 rounded-xl border transition-all group',
      isDeadline
        ? 'bg-red-500/10 border-red-500/20 hover:bg-red-500/15'
        : 'bg-secondary/20 border-border/30 hover:bg-secondary/30')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isDeadline && <span className="text-xs font-bold text-red-400">DEADLINE</span>}
            <span className="text-sm font-medium truncate">{title}</span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded-full border', cfg.color)}>
              {cfg.emoji}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {startTime && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" /> {startTime}{endTime ? ` – ${endTime}` : ''}
              </span>
            )}
            {!startTime && event.start?.date && (
              <span className="text-xs text-muted-foreground">
                {format(parseISO(event.start.date), 'MMM d, yyyy')}
              </span>
            )}
            {hasLocation && (
              <a href={event.location.startsWith('http') ? event.location : `https://maps.google.com/?q=${encodeURIComponent(event.location)}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-400 hover:underline">
                <MapPin className="w-3 h-3" /> {event.location.length > 30 ? event.location.slice(0, 30) + '...' : event.location}
              </a>
            )}
            {meetLink && (
              <a href={meetLink} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-green-400 hover:underline">
                <Video className="w-3 h-3" /> Join
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <a href={event.htmlLink} target="_blank" rel="noopener noreferrer"
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
            <ExternalLink className="w-3 h-3" />
          </a>
          {onDelete && (
            <button onClick={() => onDelete(event)}
              className="p-1.5 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
