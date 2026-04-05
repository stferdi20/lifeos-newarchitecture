const RESOURCE_PROFILE_QUERY_PARAM = 'profileResources';
const RESOURCE_PROFILE_EVENT = 'lifeos:resource-profile-update';
const SESSION_KEY = '__lifeosResourceProfile';

function canUseBrowserApis() {
  return typeof window !== 'undefined' && typeof performance !== 'undefined';
}

function createSession() {
  return {
    startedAt: performance.now(),
    events: [],
  };
}

function getSession() {
  if (!canUseBrowserApis()) return null;
  if (!window[SESSION_KEY]) {
    window[SESSION_KEY] = createSession();
  }
  return window[SESSION_KEY];
}

function emitUpdate() {
  if (!canUseBrowserApis()) return;
  window.dispatchEvent(new CustomEvent(RESOURCE_PROFILE_EVENT));
}

export function isResourceProfilingEnabled() {
  if (!import.meta.env.DEV || !canUseBrowserApis()) return false;
  const params = new URLSearchParams(window.location.search);
  const value = params.get(RESOURCE_PROFILE_QUERY_PARAM);
  return value === '1' || value === 'true';
}

export function resetResourceProfileSession(label = 'Resources open') {
  if (!isResourceProfilingEnabled()) return;
  window[SESSION_KEY] = createSession();
  recordResourceProfileEvent('session:start', { label });
}

export function recordResourceProfileEvent(name, details = {}) {
  if (!isResourceProfilingEnabled()) return;
  const session = getSession();
  if (!session) return;

  session.events.push({
    kind: 'event',
    name,
    ts: performance.now(),
    ...details,
  });

  emitUpdate();
}

export function startResourceProfileSpan(name, details = {}) {
  if (!isResourceProfilingEnabled()) {
    return () => {};
  }

  const startedAt = performance.now();
  return (extra = {}) => {
    const session = getSession();
    if (!session) return;
    session.events.push({
      kind: 'span',
      name,
      ts: performance.now(),
      durationMs: performance.now() - startedAt,
      ...details,
      ...extra,
    });
    emitUpdate();
  };
}

export function recordResourceProfileApi(details = {}) {
  if (!isResourceProfilingEnabled()) return;
  const session = getSession();
  if (!session) return;

  session.events.push({
    kind: 'api',
    name: details.path || 'api',
    ts: performance.now(),
    ...details,
  });

  emitUpdate();
}

export function recordResourceProfileImageLoad(details = {}) {
  if (!isResourceProfilingEnabled()) return;
  const session = getSession();
  if (!session) return;

  session.events.push({
    kind: 'image',
    name: details.resourceId || 'image',
    ts: performance.now(),
    ...details,
  });

  emitUpdate();
}

export function getResourceProfileSnapshot() {
  const session = getSession();
  if (!session) {
    return {
      startedAt: 0,
      now: 0,
      events: [],
    };
  }

  return {
    startedAt: session.startedAt,
    now: performance.now(),
    events: [...session.events],
  };
}

export function subscribeToResourceProfile(listener) {
  if (!canUseBrowserApis()) return () => {};
  window.addEventListener(RESOURCE_PROFILE_EVENT, listener);
  return () => window.removeEventListener(RESOURCE_PROFILE_EVENT, listener);
}

function rounded(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return Math.round(value);
}

function relativeMs(snapshot, ts) {
  if (typeof ts !== 'number') return null;
  return rounded(ts - snapshot.startedAt);
}

export function summarizeResourceProfile(snapshot) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const byName = (name) => events.find((event) => event.name === name);
  const allByName = (name) => events.filter((event) => event.name === name);
  const apiEvents = events.filter((event) => event.kind === 'api');
  const imageEvents = events.filter((event) => event.kind === 'image');

  const requestSummaries = apiEvents.map((event) => ({
    label: `${event.method || 'GET'} ${event.path || ''}`.trim(),
    atMs: relativeMs(snapshot, event.ts),
    totalMs: rounded(event.totalMs),
    tokenMs: rounded(event.tokenMs),
    fetchMs: rounded(event.fetchMs),
    jsonMs: rounded(event.jsonMs),
    status: event.status,
  }));

  return {
    enabled: true,
    sessionAgeMs: rounded((snapshot?.now || 0) - (snapshot?.startedAt || 0)),
    routeMountedMs: relativeMs(snapshot, byName('resources:route-mounted')?.ts),
    resourcesReadyMs: rounded(byName('resources:query')?.durationMs),
    firstPaintMs: relativeMs(snapshot, byName('resources:first-paint')?.ts),
    projectsReadyMs: rounded(byName('resources:projects-query')?.durationMs),
    areasReadyMs: rounded(byName('resources:areas-query')?.durationMs),
    projectFilterReadyMs: rounded(byName('resources:project-links-query')?.durationMs),
    downloaderReadyMs: rounded(byName('resources:downloader-status-query')?.durationMs),
    firstImageMs: relativeMs(snapshot, imageEvents[0]?.ts),
    lastImageMs: relativeMs(snapshot, imageEvents[imageEvents.length - 1]?.ts),
    imageCount: imageEvents.length,
    apiCount: apiEvents.length,
    totalTokenMs: rounded(apiEvents.reduce((sum, event) => sum + (event.tokenMs || 0), 0)),
    totalFetchMs: rounded(apiEvents.reduce((sum, event) => sum + (event.fetchMs || 0), 0)),
    requestSummaries,
    notableEvents: [
      ...allByName('resources:query').map((event) => ({ label: 'Resources query', durationMs: rounded(event.durationMs) })),
      ...allByName('resources:first-paint').map((event) => ({ label: 'First paint', atMs: relativeMs(snapshot, event.ts) })),
    ],
  };
}
