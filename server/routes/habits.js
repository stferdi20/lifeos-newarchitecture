import { createCompatCrudRoute } from './compat-crud.js';

const habitRoutes = createCompatCrudRoute({
  entityType: 'Habit',
  collectionKey: 'habits',
  itemKey: 'habit',
  defaultSort: 'name',
});

export default habitRoutes;
