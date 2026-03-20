import { createCompatCrudRoute } from './compat-crud.js';

const toolRoutes = createCompatCrudRoute({
  entityType: 'Tool',
  collectionKey: 'tools',
  itemKey: 'tool',
});

export default toolRoutes;
