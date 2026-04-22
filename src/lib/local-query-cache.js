import { dehydrate, hydrate } from '@tanstack/react-query';

const DB_NAME = 'lifeos-local-query-cache';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';
const CACHE_SCHEMA_VERSION = 1;
const MAX_CACHE_BYTES = 200 * 1024 * 1024;
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PERSIST_THROTTLE_MS = 1500;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const QUERY_TTLS = {
  calendarEvents: 6 * HOUR_MS,
  calendarEventsWidget: 30 * MINUTE_MS,
  cards: 24 * HOUR_MS,
  'context-picker': 6 * HOUR_MS,
  creatorInspo: 12 * HOUR_MS,
  habits: 24 * HOUR_MS,
  habitLogs: 24 * HOUR_MS,
  investments: 30 * MINUTE_MS,
  lifeAreas: 7 * DAY_MS,
  mediaLibrary: 24 * HOUR_MS,
  mediaSummary: 24 * HOUR_MS,
  mediaYearly: 7 * DAY_MS,
  news: 30 * MINUTE_MS,
  'news-digest-widget': 6 * HOUR_MS,
  nextUpEvent: 15 * MINUTE_MS,
  notes: 24 * HOUR_MS,
  projectResources: 24 * HOUR_MS,
  projects: 24 * HOUR_MS,
  promptTemplates: 7 * DAY_MS,
  resources: 6 * HOUR_MS,
  'snippet-workspaces': 24 * HOUR_MS,
  snippets: 24 * HOUR_MS,
  'standalone-tasks': 12 * HOUR_MS,
  'task-cards': 24 * HOUR_MS,
  'task-workspaces': 24 * HOUR_MS,
  todaySchedule: 15 * MINUTE_MS,
  'workspace-cards': 24 * HOUR_MS,
  'workspace-lists': 7 * DAY_MS,
  workspaces: 7 * DAY_MS,
};

const PERSISTED_QUERY_PREFIXES = new Set([
  'calendarEvents',
  'calendarEventsWidget',
  'cards',
  'context-picker',
  'creatorInspo',
  'habits',
  'habitLogs',
  'investments',
  'lifeAreas',
  'mediaLibrary',
  'mediaSummary',
  'mediaYearly',
  'news',
  'news-digest-widget',
  'nextUpEvent',
  'notes',
  'projectResources',
  'projects',
  'promptTemplates',
  'resources',
  'snippet-workspaces',
  'snippets',
  'standalone-tasks',
  'task-cards',
  'task-workspaces',
  'todaySchedule',
  'workspace-cards',
  'workspace-lists',
  'workspaces',
]);

let dbPromise = null;

function canUseIndexedDb() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDb() {
  if (!canUseIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

function runStore(mode, action) {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      const request = action(store);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

function snapshotIdForUser(userId) {
  return `user:${userId || 'anonymous'}`;
}

function queryPrefix(query) {
  const key = query?.queryKey;
  return Array.isArray(key) ? String(key[0] || '') : '';
}

function queryTtl(query) {
  return QUERY_TTLS[queryPrefix(query)] || MAX_SNAPSHOT_AGE_MS;
}

function pruneExpiredQueries(clientState, now = Date.now()) {
  const queries = (clientState?.queries || []).filter((query) => {
    const updatedAt = query?.state?.dataUpdatedAt || 0;
    if (!updatedAt) return false;
    return now - updatedAt <= queryTtl(query);
  });

  return {
    ...clientState,
    queries,
  };
}

function shouldPersistQuery(query) {
  if (!query?.state?.dataUpdatedAt || query.state.status !== 'success') return false;
  if (!PERSISTED_QUERY_PREFIXES.has(queryPrefix(query))) return false;
  if (query.state.fetchStatus === 'fetching') return false;
  return true;
}

function trimSnapshot(snapshot, maxBytes = MAX_CACHE_BYTES) {
  const queries = [...(snapshot?.clientState?.queries || [])]
    .sort((a, b) => (b.state?.dataUpdatedAt || 0) - (a.state?.dataUpdatedAt || 0));
  const trimmed = { ...snapshot, clientState: { ...snapshot.clientState, queries: [] } };

  for (const query of queries) {
    trimmed.clientState.queries.push(query);
    if (JSON.stringify(trimmed).length > maxBytes) {
      trimmed.clientState.queries.pop();
      break;
    }
  }

  return trimmed;
}

async function saveSnapshot(snapshot) {
  return runStore('readwrite', (store) => store.put(snapshot));
}

function isQuotaError(error) {
  return error?.name === 'QuotaExceededError' || error?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

export async function restoreLocalQueryCache(queryClient, userId) {
  if (!userId) return;

  const snapshot = await runStore('readonly', (store) => store.get(snapshotIdForUser(userId)));
  if (!snapshot || snapshot.schemaVersion !== CACHE_SCHEMA_VERSION) return;
  if (Date.now() - snapshot.updatedAt > MAX_SNAPSHOT_AGE_MS) return;
  if (!snapshot.clientState) return;

  hydrate(queryClient, pruneExpiredQueries(snapshot.clientState));
}

export function startLocalQueryCachePersistence(queryClient, userId) {
  if (!userId || !canUseIndexedDb()) return () => {};

  let timeoutId = null;
  let disposed = false;

  const persist = () => {
    if (disposed) return;
    timeoutId = null;

    const clientState = dehydrate(queryClient, { shouldDehydrateQuery: shouldPersistQuery });
    const snapshot = trimSnapshot({
      id: snapshotIdForUser(userId),
      schemaVersion: CACHE_SCHEMA_VERSION,
      updatedAt: Date.now(),
      clientState,
    });

    saveSnapshot(snapshot).catch((error) => {
      if (!isQuotaError(error)) return null;
      return saveSnapshot(trimSnapshot(snapshot, Math.floor(MAX_CACHE_BYTES / 2))).catch(() => null);
    });
  };

  const schedulePersist = () => {
    if (timeoutId || disposed) return;
    timeoutId = window.setTimeout(persist, PERSIST_THROTTLE_MS);
  };

  const unsubscribe = queryClient.getQueryCache().subscribe(schedulePersist);
  schedulePersist();

  return () => {
    disposed = true;
    unsubscribe();
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
}

export async function clearLocalQueryCache(userId) {
  if (userId) {
    await runStore('readwrite', (store) => store.delete(snapshotIdForUser(userId)));
    return;
  }
  await runStore('readwrite', (store) => store.clear());
}

export async function getLocalQueryCacheInfo(userId) {
  const snapshot = await runStore('readonly', (store) => store.get(snapshotIdForUser(userId)));
  if (!snapshot) {
    return { sizeBytes: 0, updatedAt: null, queryCount: 0 };
  }

  return {
    sizeBytes: JSON.stringify(snapshot).length,
    updatedAt: snapshot.updatedAt || null,
    queryCount: snapshot.clientState?.queries?.length || 0,
  };
}
