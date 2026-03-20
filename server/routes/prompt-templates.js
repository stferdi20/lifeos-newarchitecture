import { createCompatCrudRoute } from './compat-crud.js';

const promptTemplateRoutes = createCompatCrudRoute({
  entityType: 'PromptTemplate',
  collectionKey: 'promptTemplates',
  itemKey: 'promptTemplate',
});

export default promptTemplateRoutes;
