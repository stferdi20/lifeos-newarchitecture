import { createCompatCrudRoute } from './compat-crud.js';

const cardResourceRoutes = createCompatCrudRoute({
  entityType: 'CardResource',
  collectionKey: 'cardResources',
  itemKey: 'cardResource',
});

export default cardResourceRoutes;
