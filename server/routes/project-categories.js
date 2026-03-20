import { createCompatCrudRoute } from './compat-crud.js';

const projectCategoryRoutes = createCompatCrudRoute({
  entityType: 'ProjectCategory',
  collectionKey: 'projectCategories',
  itemKey: 'projectCategory',
  defaultSort: 'sort_order',
});

export default projectCategoryRoutes;
