import React from 'react';
import { cn } from '@/lib/utils';

export const CATEGORIES = [
  { key: 'personal', label: 'Personal', emoji: '🟣', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  { key: 'work',     label: 'Work',     emoji: '🔵', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  { key: 'academic', label: 'Academic', emoji: '🟢', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  { key: 'church',   label: 'Church',   emoji: '🟡', color: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  { key: 'family',   label: 'Family',   emoji: '🔴', color: 'bg-red-500/20 text-red-300 border-red-500/30' },
  { key: 'love',     label: 'Love',     emoji: '🩷', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
];

export const EVENT_TYPES = [
  { key: 'offline',    label: 'Offline',     emoji: '📍' },
  { key: 'online',     label: 'Online',      emoji: '💻' },
  { key: 'time_block', label: 'Time Block',  emoji: '⏰' },
  { key: 'deadline',   label: 'Deadline',    emoji: '🚨' },
];

export function getCategoryConfig(key) {
  return CATEGORIES.find(c => c.key === key) || CATEGORIES[0];
}

export default function CategoryBadge({ category, size = 'sm' }) {
  const cfg = getCategoryConfig(category);
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border font-medium',
      cfg.color,
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
    )}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}