import { createCompatCrudRoute } from './compat-crud.js';

const noteRoutes = createCompatCrudRoute({
  entityType: 'Note',
  collectionKey: 'notes',
  itemKey: 'note',
});

export default noteRoutes;
