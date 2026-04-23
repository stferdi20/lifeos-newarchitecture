import { createCrudApi } from '@/lib/compat-entity-api';

export const HABIT_LIST_FIELDS = ['id', 'name', 'icon', 'frequency', 'active'];
export const HABIT_LOG_LIST_FIELDS = ['id', 'habit_id', 'date', 'completed'];

export const Habit = createCrudApi({
  basePath: '/habits',
  collectionKey: 'habits',
  itemKey: 'habit',
  defaultSort: 'name',
});

export const HabitLog = createCrudApi({
  basePath: '/habit-logs',
  collectionKey: 'habitLogs',
  itemKey: 'habitLog',
  defaultSort: '-date',
});

export function listHabitCards() {
  return Habit.list('name', 100, 0, HABIT_LIST_FIELDS);
}

export function listRecentHabitLogs(limit = 500) {
  return HabitLog.list('-date', limit, 0, HABIT_LOG_LIST_FIELDS);
}
