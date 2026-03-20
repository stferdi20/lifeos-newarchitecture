const readBoolean = (value) => {
  if (value === true || value === 'true' || value === '1' || value === 1) return true;
  if (value === false || value === 'false' || value === '0' || value === 0) return false;
  return null;
};

const getStoredFlag = (flagName) => {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  const urlValue = readBoolean(params.get(flagName));
  const storageKey = `feature_flag_${flagName}`;

  if (urlValue !== null) {
    window.localStorage.setItem(storageKey, String(urlValue));
    return urlValue;
  }

  const stored = readBoolean(window.localStorage.getItem(storageKey));
  return stored ?? false;
};

export const featureFlags = {
  kanban_v2_enabled: getStoredFlag('kanban_v2_enabled'),
};

export const isFeatureEnabled = (flagName) => getStoredFlag(flagName);
