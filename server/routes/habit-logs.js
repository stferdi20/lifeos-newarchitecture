import { createCompatCrudRoute } from './compat-crud.js';

const habitLogRoutes = createCompatCrudRoute({
  entityType: 'HabitLog',
  collectionKey: 'habitLogs',
  itemKey: 'habitLog',
  defaultSort: '-date',
});

export default habitLogRoutes;
