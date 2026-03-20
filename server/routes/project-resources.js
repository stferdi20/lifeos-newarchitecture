import { createCompatCrudRoute } from './compat-crud.js';

const projectResourceRoutes = createCompatCrudRoute({
  entityType: 'ProjectResource',
  collectionKey: 'projectResources',
  itemKey: 'projectResource',
});

export default projectResourceRoutes;
