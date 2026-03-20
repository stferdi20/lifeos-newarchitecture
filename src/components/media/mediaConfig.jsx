import { Film, Tv, Sword, BookOpen, Gamepad2, BookMarked, Layers } from 'lucide-react';

export const TYPE_CONFIG = {
  movie:  { icon: Film,       color: 'text-blue-400',    bg: 'bg-blue-500/10',    label: 'Movie',  plural: 'Movies' },
  series: { icon: Tv,         color: 'text-purple-400',  bg: 'bg-purple-500/10',  label: 'Series', plural: 'Series' },
  anime:  { icon: Sword,      color: 'text-pink-400',    bg: 'bg-pink-500/10',    label: 'Anime',  plural: 'Anime' },
  manga:  { icon: BookOpen,   color: 'text-red-400',     bg: 'bg-red-500/10',     label: 'Manga',  plural: 'Manga' },
  comic:  { icon: Layers,     color: 'text-yellow-400',  bg: 'bg-yellow-500/10',  label: 'Comic',  plural: 'Comics' },
  book:   { icon: BookMarked, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Book',   plural: 'Books' },
  game:   { icon: Gamepad2,   color: 'text-cyan-400',    bg: 'bg-cyan-500/10',    label: 'Game',   plural: 'Games' },
};

// Type-specific status labels
const WATCH_LABELS = {
  completed: 'Completed',
  in_progress: 'Watching',
  plan_to_watch: 'Plan to Watch',
  dropped: 'Dropped',
};

const READ_LABELS = {
  completed: 'Completed',
  in_progress: 'Reading',
  plan_to_watch: 'Plan to Read',
  dropped: 'Dropped',
};

const PLAY_LABELS = {
  completed: 'Completed',
  in_progress: 'Playing',
  plan_to_watch: 'Plan to Play',
  dropped: 'Dropped',
};

const STATUS_LABEL_MAP = {
  movie:  WATCH_LABELS,
  series: WATCH_LABELS,
  anime:  WATCH_LABELS,
  manga:  READ_LABELS,
  comic:  READ_LABELS,
  book:   READ_LABELS,
  game:   PLAY_LABELS,
};

export function getStatusLabel(mediaType, status) {
  const map = STATUS_LABEL_MAP[mediaType] || WATCH_LABELS;
  return map[status] || status;
}

export function getStatusOptions(mediaType) {
  const map = STATUS_LABEL_MAP[mediaType] || WATCH_LABELS;
  return Object.entries(map).map(([value, label]) => ({ value, label }));
}

export const STATUS_COLORS = {
  completed:     'bg-emerald-500/20 text-emerald-400',
  in_progress:   'bg-blue-500/20 text-blue-400',
  plan_to_watch: 'bg-secondary text-muted-foreground',
  dropped:       'bg-red-500/20 text-red-400',
};