import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { subDays } from 'date-fns';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

export default function HabitHeatmap({ habitId, habitLogs }) {
  const { weeks, monthLabels, completedDates } = useMemo(() => {
    const today = new Date();
    const WEEKS = 18;
    const TOTAL_DAYS = WEEKS * 7;
    const startDate = subDays(today, TOTAL_DAYS - 1);

    const completed = new Set(
      (habitLogs || [])
        .filter(l => l.habit_id === habitId && l.completed)
        .map(l => l.date)
    );

    const wks = [];
    let current = new Date(startDate);
    for (let w = 0; w < WEEKS; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = current.toISOString().split('T')[0];
        const isFuture = current > today;
        week.push({ date: dateStr, done: completed.has(dateStr), future: isFuture, month: current.getMonth() });
        current.setDate(current.getDate() + 1);
      }
      wks.push(week);
    }

    const mLabels = [];
    wks.forEach((week, wi) => {
      const firstDay = week[0];
      if (wi === 0 || (wi > 0 && wks[wi - 1][0].month !== firstDay.month)) {
        mLabels.push({ wi, label: MONTHS[firstDay.month] });
      }
    });

    return { weeks: wks, monthLabels: mLabels, completedDates: completed };
  }, [habitId, habitLogs]);

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* Month labels */}
        <div className="flex ml-6 mb-1" style={{ gap: '3px' }}>
          {weeks.map((_, wi) => {
            const lbl = monthLabels.find(m => m.wi === wi);
            return (
              <div key={wi} style={{ width: 12, minWidth: 12 }}>
                {lbl ? <span className="text-[9px] text-muted-foreground/60 whitespace-nowrap">{lbl.label}</span> : null}
              </div>
            );
          })}
        </div>

        <div className="flex" style={{ gap: '3px' }}>
          {/* Day labels */}
          <div className="flex flex-col mr-1" style={{ gap: '3px' }}>
            {DAY_LABELS.map((d, i) => (
              <div key={i} style={{ height: 12, minHeight: 12 }}>
                <span className="text-[9px] text-muted-foreground/50 leading-none">{d}</span>
              </div>
            ))}
          </div>

          {/* Grid */}
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col" style={{ gap: '3px' }}>
              {week.map((day, di) => (
                <div
                  key={di}
                  title={`${day.date}${day.done ? ' ✓' : ''}`}
                  style={{ width: 12, height: 12, minWidth: 12, minHeight: 12 }}
                  className={cn(
                    'rounded-sm transition-colors',
                    day.future
                      ? 'bg-transparent border border-border/20'
                      : day.done
                        ? 'bg-emerald-500 hover:bg-emerald-400'
                        : 'bg-secondary/50 hover:bg-secondary'
                  )}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-1.5 mt-2 ml-6">
          <span className="text-[9px] text-muted-foreground/50">Less</span>
          {[false, false, false, true, true].map((done, i) => (
            <div
              key={i}
              style={{ width: 10, height: 10 }}
              className={cn('rounded-sm', done
                ? i === 3 ? 'bg-emerald-600' : 'bg-emerald-500'
                : i === 0 ? 'bg-secondary/30' : 'bg-secondary/50'
              )}
            />
          ))}
          <span className="text-[9px] text-muted-foreground/50">More</span>
        </div>
      </div>
    </div>
  );
}
