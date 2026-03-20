import { createCrudApi } from '@/lib/compat-entity-api';

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
