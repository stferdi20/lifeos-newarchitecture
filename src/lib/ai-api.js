import { apiPost } from '@/lib/api-client';

export function generateStructuredAi({
  taskType,
  prompt,
  policy,
  metadata,
  groundWithGoogleSearch = false,
}) {
  return apiPost('/ai/structured', {
    taskType,
    prompt,
    policy,
    metadata,
    groundWithGoogleSearch,
  }).then((res) => res.data);
}

export function generateTextAi({
  taskType,
  prompt,
  policy,
  metadata,
  groundWithGoogleSearch = false,
}) {
  return apiPost('/ai/text', {
    taskType,
    prompt,
    policy,
    metadata,
    groundWithGoogleSearch,
  }).then((res) => res.text);
}
