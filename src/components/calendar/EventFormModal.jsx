import React, { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, MapPin, Link, AlignLeft, Tag, Calendar, Clock, RotateCcw, Trash2 } from 'lucide-react';
import { CATEGORIES, EVENT_TYPES, getCategoryConfig } from './CategoryBadge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MobileStickyActions, ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';
import { createCalendarEvent } from '@/lib/calendar-api';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TAG_SUGGESTIONS = ['personal', 'work', 'academic', 'church', 'family', 'love', 'urgent', 'assignment', 'exam', 'meeting'];

const DEFAULT_FORM = {
  title: '',
  date: '',
  start_time: '09:00',
  end_time: '10:00',
  category: 'personal',
  event_type: 'offline',
  is_deadline: false,
  location: '',
  location_detail: '',
  meet_link: '',
  description: '',
  recurrence_days: [],
  recurrence_weeks: 1,
  recurrence_end_date: '',
  tags: [],
};

function formatDisplayDate(value) {
  if (!value) return 'Not set';
  try {
    return format(parseISO(value), 'EEEE, MMMM d, yyyy');
  } catch {
    return value;
  }
}

function formatDisplayTimeRange(start, end) {
  if (!start && !end) return 'Not set';
  if (start && end) return `${start} - ${end}`;
  return start || end;
}

function getRecurrenceSummary(form) {
  if (!form.recurrence_days?.length || form.is_deadline) return 'Does not repeat';
  const dayNames = [...form.recurrence_days]
    .sort((a, b) => a - b)
    .map((day) => DAYS[day])
    .join(', ');

  if (form.recurrence_end_date) {
    return `Every ${dayNames} until ${formatDisplayDate(form.recurrence_end_date)}`;
  }

  if ((form.recurrence_weeks || 1) > 1) {
    return `Every ${dayNames} for ${form.recurrence_weeks} week${form.recurrence_weeks > 1 ? 's' : ''}`;
  }

  return `Every ${dayNames}`;
}

export default function EventFormModal({
  open,
  onClose,
  onCreated,
  prefill = null,
  mode = 'manual',
  sourceText = '',
  onStartOver,
}) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (prefill) {
      setForm({
        ...DEFAULT_FORM,
        ...prefill,
        recurrence_days: prefill.recurrence_days || [],
        recurrence_weeks: prefill.recurrence_weeks || 1,
        recurrence_end_date: prefill.recurrence_end_date || '',
        tags: prefill.tags || [],
      });
    } else {
      setForm(DEFAULT_FORM);
    }
  }, [prefill, open]);

  const set = (key, val) => setForm((current) => ({ ...current, [key]: val }));

  const toggleDay = (day) => {
    set('recurrence_days', form.recurrence_days.includes(day)
      ? form.recurrence_days.filter((value) => value !== day)
      : [...form.recurrence_days, day].sort((a, b) => a - b));
  };

  const addTag = (tag) => {
    const normalized = tag.trim().toLowerCase();
    if (normalized && !form.tags.includes(normalized)) {
      set('tags', [...form.tags, normalized]);
    }
    setTagInput('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title || !form.date) return;

    setLoading(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const payload = {
        ...form,
        recurrence_weeks: form.recurrence_end_date ? 1 : form.recurrence_weeks,
        timezone,
      };
      const res = await createCalendarEvent(payload);
      toast.success(form.is_deadline ? 'Deadline added!' : 'Event created in Google Calendar!');
      onCreated((res?.event || res?.data?.event || res?.events?.[0] || null));
      onClose();
    } catch {
      toast.error('Failed to create event.');
    }
    setLoading(false);
  };

  const isRecurring = form.recurrence_days.length > 0 && (!form.recurrence_end_date ? form.recurrence_weeks > 1 : true);
  const reviewMode = mode === 'parsed-review';
  const categoryConfig = getCategoryConfig(form.category);
  const eventTypeConfig = EVENT_TYPES.find((type) => type.key === (form.is_deadline ? 'deadline' : form.event_type)) || EVENT_TYPES[0];

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="bg-[#161820] border-border max-w-lg max-h-[90vh] overflow-y-auto" mobileClassName="bg-[#161820] border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>
            {reviewMode ? 'Review Parsed Event' : (form.is_deadline ? '🚨 Add Deadline' : '📅 Create Event')}
          </ResponsiveModalTitle>
          {reviewMode && (
            <p className="text-sm text-muted-foreground">
              Check the details below before creating it in Google Calendar.
            </p>
          )}
        </ResponsiveModalHeader>

        <form onSubmit={handleSubmit} className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
          {reviewMode && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-primary/80">Parsed Summary</p>
                  <h3 className="text-base font-semibold text-foreground">{form.title || 'Untitled event'}</h3>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', categoryConfig.color)}>
                    {categoryConfig.emoji} {categoryConfig.label}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-secondary/30 px-2 py-0.5 text-xs font-medium text-foreground">
                    {eventTypeConfig.emoji} {eventTypeConfig.label}
                  </span>
                </div>
              </div>

              {sourceText && (
                <div className="rounded-xl border border-border/30 bg-secondary/20 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Original Request</p>
                  <p className="mt-1 text-sm text-foreground">{sourceText}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border/30 bg-secondary/20 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {form.is_deadline ? 'Deadline Date' : 'First Occurrence'}
                  </p>
                  <p className="mt-1 text-sm text-foreground">{formatDisplayDate(form.date)}</p>
                </div>
                {!form.is_deadline && (
                  <div className="rounded-xl border border-border/30 bg-secondary/20 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Time</p>
                    <p className="mt-1 text-sm text-foreground">{formatDisplayTimeRange(form.start_time, form.end_time)}</p>
                  </div>
                )}
                {!form.is_deadline && (
                  <div className="rounded-xl border border-border/30 bg-secondary/20 p-3 sm:col-span-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Recurrence</p>
                    <p className="mt-1 text-sm text-foreground">{getRecurrenceSummary(form)}</p>
                  </div>
                )}
                {(form.location || form.location_detail) && (
                  <div className="rounded-xl border border-border/30 bg-secondary/20 p-3 sm:col-span-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Location</p>
                    <p className="mt-1 text-sm text-foreground">{form.location || 'No map link'}</p>
                    {form.location_detail && <p className="mt-1 text-sm text-muted-foreground">{form.location_detail}</p>}
                  </div>
                )}
                {form.meet_link && (
                  <div className="rounded-xl border border-border/30 bg-secondary/20 p-3 sm:col-span-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Meet Link</p>
                    <p className="mt-1 text-sm text-foreground break-all">{form.meet_link}</p>
                  </div>
                )}
                {form.tags.length > 0 && (
                  <div className="rounded-xl border border-border/30 bg-secondary/20 p-3 sm:col-span-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Tags</p>
                    <p className="mt-1 text-sm text-foreground">{form.tags.map((tag) => `#${tag}`).join(' ')}</p>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                Please confirm the date and recurrence, especially for phrases like "next Friday" or "last Friday of May".
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/20 border border-border/30">
            <button
              type="button"
              onClick={() => set('is_deadline', false)}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors',
                !form.is_deadline ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary/40',
              )}
            >
              📅 Event
            </button>
            <button
              type="button"
              onClick={() => set('is_deadline', true)}
              className={cn(
                'flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors',
                form.is_deadline ? 'bg-red-600 text-white' : 'text-muted-foreground hover:bg-secondary/40',
              )}
            >
              🚨 Deadline
            </button>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">Title *</Label>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Event title..."
              className="bg-secondary/40 border-border/50"
              required
            />
          </div>

          {!form.is_deadline && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((category) => (
                    <button
                      key={category.key}
                      type="button"
                      onClick={() => set('category', category.key)}
                      className={cn(
                        'px-2 py-1 rounded-lg text-xs border transition-all',
                        form.category === category.key ? category.color : 'bg-secondary/20 text-muted-foreground border-border/30 hover:bg-secondary/40',
                      )}
                    >
                      {category.emoji} {category.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EVENT_TYPES.filter((type) => type.key !== 'deadline').map((type) => (
                    <button
                      key={type.key}
                      type="button"
                      onClick={() => set('event_type', type.key)}
                      className={cn(
                        'px-2 py-1 rounded-lg text-xs border transition-all',
                        form.event_type === type.key
                          ? 'bg-primary/20 text-primary border-primary/30'
                          : 'bg-secondary/20 text-muted-foreground border-border/30 hover:bg-secondary/40',
                      )}
                    >
                      {type.emoji} {type.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className={cn('grid gap-3', form.is_deadline ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3')}>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Calendar className="w-3 h-3" /> Date *</Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
                className="bg-secondary/40 border-border/50"
                required
              />
            </div>
            {!form.is_deadline && (
              <>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" /> Start</Label>
                  <Input
                    type="time"
                    value={form.start_time}
                    onChange={(e) => set('start_time', e.target.value)}
                    className="bg-secondary/40 border-border/50"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Clock className="w-3 h-3" /> End</Label>
                  <Input
                    type="time"
                    value={form.end_time}
                    onChange={(e) => set('end_time', e.target.value)}
                    className="bg-secondary/40 border-border/50"
                  />
                </div>
              </>
            )}
          </div>

          {!form.is_deadline && (
            <div className="p-3 rounded-xl bg-secondary/20 border border-border/30 space-y-3">
              <Label className="text-xs text-muted-foreground flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Recurrence</Label>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map((dayLabel, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => toggleDay(index)}
                    className={cn(
                      'w-9 h-9 rounded-lg text-xs font-medium transition-all border',
                      form.recurrence_days.includes(index)
                        ? 'bg-primary/30 text-primary border-primary/40'
                        : 'bg-secondary/30 text-muted-foreground border-border/30 hover:bg-secondary/50',
                    )}
                  >
                    {dayLabel}
                  </button>
                ))}
              </div>

              {form.recurrence_days.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">For</span>
                    <Input
                      type="number"
                      min="1"
                      max="52"
                      value={form.recurrence_weeks}
                      onChange={(e) => {
                        set('recurrence_weeks', parseInt(e.target.value, 10) || 1);
                        if (form.recurrence_end_date) set('recurrence_end_date', '');
                      }}
                      className="w-16 bg-secondary/40 border-border/50 text-xs h-7 px-2"
                    />
                    <span className="text-xs text-muted-foreground">weeks</span>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Ends on</Label>
                    <Input
                      type="date"
                      value={form.recurrence_end_date}
                      onChange={(e) => {
                        set('recurrence_end_date', e.target.value);
                        if (e.target.value) set('recurrence_weeks', 1);
                      }}
                      className="bg-secondary/40 border-border/50 text-xs h-9"
                    />
                  </div>
                  <span className="text-xs text-primary sm:col-span-2">
                    {form.recurrence_end_date
                      ? `Repeats until ${formatDisplayDate(form.recurrence_end_date)}`
                      : `${form.recurrence_days.length * form.recurrence_weeks} total events`}
                  </span>
                </div>
              )}
            </div>
          )}

          {!form.is_deadline && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><MapPin className="w-3 h-3" /> Location</Label>
                <Input
                  value={form.location}
                  onChange={(e) => set('location', e.target.value)}
                  placeholder="Address or Google Maps link..."
                  className="bg-secondary/40 border-border/50 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><MapPin className="w-3 h-3" /> Location Detail</Label>
                <Input
                  value={form.location_detail}
                  onChange={(e) => set('location_detail', e.target.value)}
                  placeholder="Room / building details..."
                  className="bg-secondary/40 border-border/50 text-xs"
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Link className="w-3 h-3" /> Meet Link</Label>
                <Input
                  value={form.meet_link}
                  onChange={(e) => set('meet_link', e.target.value)}
                  placeholder="Zoom / Meet URL..."
                  className="bg-secondary/40 border-border/50 text-xs"
                />
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><AlignLeft className="w-3 h-3" /> Notes</Label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Additional details..."
              className="w-full bg-secondary/40 border border-border/50 rounded-lg p-2 text-sm text-foreground placeholder:text-muted-foreground resize-none h-20 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Tag className="w-3 h-3" /> Tags</Label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.tags.map((tag) => (
                <span key={tag} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs border border-primary/20">
                  #{tag}
                  <button type="button" onClick={() => set('tags', form.tags.filter((value) => value !== tag))} className="hover:text-red-400">
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="Add tag..."
                className="bg-secondary/40 border-border/50 text-xs h-7"
              />
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {TAG_SUGGESTIONS.filter((tag) => !form.tags.includes(tag)).slice(0, 6).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addTag(tag)}
                  className="text-xs text-muted-foreground hover:text-foreground bg-secondary/20 hover:bg-secondary/40 px-2 py-0.5 rounded-full border border-border/20 transition-colors"
                >
                  +{tag}
                </button>
              ))}
            </div>
          </div>

          <MobileStickyActions className="bg-[#161820]/95 sm:pt-0">
            {reviewMode && (
              <button
                type="button"
                onClick={() => (onStartOver ? onStartOver() : onClose())}
                className="w-full py-2.5 rounded-xl border border-border/40 bg-secondary/20 text-sm font-medium text-foreground hover:bg-secondary/40 transition-colors"
              >
                Start Over
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 rounded-xl border border-border/40 bg-secondary/20 text-sm font-medium text-foreground hover:bg-secondary/40 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !form.title || !form.date}
              className="w-full py-2.5 rounded-xl bg-primary text-white font-medium text-sm hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2 transition-colors"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                : (isRecurring
                  ? (form.recurrence_end_date ? 'Create Recurring Event' : `Create ${form.recurrence_days.length * Math.max(form.recurrence_weeks, 1)} Events`)
                  : 'Create Event')}
            </button>
          </MobileStickyActions>
        </form>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
