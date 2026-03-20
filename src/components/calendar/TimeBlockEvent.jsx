import React from 'react';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import { MapPin, Video, ExternalLink, Trash2 } from 'lucide-react';
import { getCategoryConfig } from './CategoryBadge';
import { cn } from '@/lib/utils';

const CATEGORY_BARS = {
  personal: 'bg-purple-500',
  work: 'bg-blue-500',
  academic: 'bg-emerald-500',
  church: 'bg-yellow-500',
  family: 'bg-red-500',
  love: 'bg-pink-500',
};

const CATEGORY_BG = {
  personal: 'bg-purple-500/10 hover:bg-purple-500/15 border-purple-500/20',
  work: 'bg-blue-500/10 hover:bg-blue-500/15 border-blue-500/20',
  academic: 'bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/20',
  church: 'bg-yellow-500/10 hover:bg-yellow-500/15 border-yellow-500/20',
  family: 'bg-red-500/10 hover:bg-red-500/15 border-red-500/20',
  love: 'bg-pink-500/10 hover:bg-pink-500/15 border-pink-500/20',
};

function extractCategory(event) {
  const colorMap = { '3': 'personal', '9': 'work', '2': 'academic', '5': 'church', '11': 'family', '4': 'love' };
  return colorMap[event.colorId] || 'personal';
}

function extractMeetLink(description) {
  if (!description) return null;
  const match = description.match(/Meet(?:ing)? Link: (https?:\/\/[^\s]+)/);
  return match ? match[1] : null;
}

export default function TimeBlockEvent({ event, onDelete, size = 'default' }) {
  const isDeadline = event.summary?.startsWith('[DEADLINE]');
  const title = isDeadline ? event.summary.replace('[DEADLINE] ', '') : event.summary;
  const category = extractCategory(event);
  const cfg = getCategoryConfig(category);
  const meetLink = extractMeetLink(event.description);
  const isAllDay = !event.start?.dateTime;

  const startTime = event.start?.dateTime ? format(parseISO(event.start.dateTime), 'h:mm a') : null;
  const endTime = event.end?.dateTime ? format(parseISO(event.end.dateTime), 'h:mm a') : null;
  const duration = event.start?.dateTime && event.end?.dateTime
    ? differenceInMinutes(parseISO(event.end.dateTime), parseISO(event.start.dateTime))
    : null;

  const barColor = isDeadline ? 'bg-red-500' : (CATEGORY_BARS[category] || CATEGORY_BARS.personal);
  const bgColor = isDeadline ? 'bg-red-500/10 hover:bg-red-500/15 border-red-500/20' : (CATEGORY_BG[category] || CATEGORY_BG.personal);

  const isCompact = size === 'compact' || (duration && duration <= 30);

  return (
    <div className={cn(
      'group relative flex rounded-xl border transition-all cursor-default overflow-hidden',
      bgColor,
      isCompact ? 'min-h-[40px]' : 'min-h-[56px]'
    )}>
      {/* Color bar */}
      <div className={cn('w-1 shrink-0 rounded-l-xl', barColor)} />

      <div className={cn('flex-1 min-w-0', isCompact ? 'px-3 py-1.5 flex items-center gap-3' : 'px-3.5 py-2.5')}>
        {isCompact ? (
          <>
            <span className="text-xs font-medium text-foreground truncate flex-1">
              {isDeadline && <span className="text-red-400 mr-1">🚨</span>}
              {title}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
              {startTime}{endTime ? ` – ${endTime}` : ''}
            </span>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground truncate leading-tight">
                  {isDeadline && <span className="text-red-400 mr-1">🚨</span>}
                  {title}
                </p>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-muted-foreground font-medium">
                    {isAllDay ? 'All day' : `${startTime}${endTime ? ` – ${endTime}` : ''}`}
                  </span>
                  {duration && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-white/5 text-muted-foreground">
                      {duration >= 60 ? `${Math.floor(duration / 60)}h${duration % 60 ? ` ${duration % 60}m` : ''}` : `${duration}m`}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                {event.htmlLink && (
                  <a href={event.htmlLink} target="_blank" rel="noopener noreferrer"
                    className="p-1 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {onDelete && (
                  <button onClick={(e) => { e.stopPropagation(); onDelete(event); }}
                    className="p-1 rounded-md hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Meta: location, meet */}
            <div className="flex items-center gap-3 mt-1.5 flex-wrap">
              {event.location && (
                <a href={event.location.startsWith('http') ? event.location : `https://maps.google.com/?q=${encodeURIComponent(event.location)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline">
                  <MapPin className="w-3 h-3" />
                  <span className="truncate max-w-[180px]">{event.location}</span>
                </a>
              )}
              {meetLink && (
                <a href={meetLink} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] text-green-400 hover:underline">
                  <Video className="w-3 h-3" /> Join Meet
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
