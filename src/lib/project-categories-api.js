import { createCrudApi } from '@/lib/compat-entity-api';

export const ProjectCategory = createCrudApi({
  basePath: '/project-categories',
  collectionKey: 'projectCategories',
  itemKey: 'projectCategory',
  defaultSort: 'sort_order',
});
