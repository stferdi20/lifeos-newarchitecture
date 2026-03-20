import { createCompatCrudRoute } from './compat-crud.js';

const lifeAreaRoutes = createCompatCrudRoute({
  entityType: 'LifeArea',
  collectionKey: 'lifeAreas',
  itemKey: 'lifeArea',
  defaultSort: 'name',
});

export default lifeAreaRoutes;
