import { enrichMedia } from '@/lib/media-api';

function filterNonEmpty(obj) {
  const result = {};

  for (const [key, value] of Object.entries(obj || {})) {
    if (value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      result[key] = value;
    }
  }

  return result;
}

function getMediaFunctionError(error, fallbackMessage) {
  const responseError =
    error?.response?.data?.error ||
    error?.data?.error ||
    error?.error;

  if (responseError) {
    return String(responseError);
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallbackMessage;
}

export async function enrichMediaEntry(entry) {
  if (!entry?.external_id || !entry?.media_type) return {};

  try {
    const res = await enrichMedia({
      type: entry.media_type,
      externalId: entry.external_id,
    });

    return filterNonEmpty(res || {});
  } catch (error) {
    throw new Error(getMediaFunctionError(error, 'Media enrichment failed before provider details could load.'));
  }
}
