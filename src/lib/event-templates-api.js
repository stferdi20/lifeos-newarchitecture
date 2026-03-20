import { createCrudApi } from '@/lib/compat-entity-api';

export const EventTemplate = createCrudApi({
  basePath: '/event-templates',
  collectionKey: 'eventTemplates',
  itemKey: 'eventTemplate',
  defaultSort: 'name',
});
