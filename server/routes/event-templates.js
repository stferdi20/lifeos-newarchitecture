import { createCompatCrudRoute } from './compat-crud.js';

const eventTemplateRoutes = createCompatCrudRoute({
  entityType: 'EventTemplate',
  collectionKey: 'eventTemplates',
  itemKey: 'eventTemplate',
  defaultSort: 'name',
});

export default eventTemplateRoutes;
