import { createCrudApi } from '@/lib/compat-entity-api';

export const Note = createCrudApi({
  basePath: '/notes',
  collectionKey: 'notes',
  itemKey: 'note',
});

export const Tool = createCrudApi({
  basePath: '/tools',
  collectionKey: 'tools',
  itemKey: 'tool',
});
