import { createCrudApi } from '@/lib/compat-entity-api';

export const PromptTemplate = createCrudApi({
  basePath: '/prompt-templates',
  collectionKey: 'promptTemplates',
  itemKey: 'promptTemplate',
});
