import { getServerEnv } from '../config/env.js';
import { getServiceRoleClient } from './supabase.js';
import { HttpError } from './http.js';

const TASK_POLICIES = {
  'calendar.parse': { tier: 'standard', temperature: 0.2, maxTokens: 900 },
  'resource.analyze': { tier: 'standard', temperature: 0.2, maxTokens: 1600 },
  'resource.tags': { tier: 'cheap', temperature: 0.1, maxTokens: 400 },
  'card.subtasks': { tier: 'standard', temperature: 0.2, maxTokens: 700 },
  'card.description': { tier: 'standard', temperature: 0.2, maxTokens: 900 },
  'card.summary': { tier: 'cheap', temperature: 0.1, maxTokens: 700 },
  'generic.structured': { tier: 'standard', temperature: 0.2, maxTokens: 1200 },
  'generic.text': { tier: 'standard', temperature: 0.4, maxTokens: 1200 },
};

function resolveTier(taskType, overrides = {}) {
  const base = TASK_POLICIES[taskType] || TASK_POLICIES['resource.tags'];
  return {
    ...base,
    ...overrides,
  };
}

function extractTextContent(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => (typeof entry?.text === 'string' ? entry.text : ''))
      .join('\n')
      .trim();
  }
  return '';
}

function extractJson(text) {
  let trimmed = String(text || '').trim();
  if (!trimmed) {
    throw new HttpError(502, 'LLM returned an empty response.');
  }

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) {
    trimmed = fenced[1].trim();
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) {
      throw new HttpError(502, 'LLM returned invalid JSON.');
    }
    return JSON.parse(match[0]);
  }
}

function extractGeminiText(data) {
  return (data?.candidates || [])
    .flatMap((candidate) => candidate?.content?.parts || [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

async function logRun(payload) {
  try {
    const admin = getServiceRoleClient();
    await admin.from('llm_runs').insert(payload);
  } catch {
    // Ignore logging failures so the feature still works.
  }
}

async function callOpenAiCompatible({ baseUrl, apiKey, model, prompt, temperature, maxTokens, providerName }) {
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'system',
          content: 'You return valid JSON only. Do not wrap it in markdown fences or explanatory text.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new HttpError(502, `LLM provider ${providerName} failed.`, {
      provider: providerName,
      details: data?.error?.message || data?.error || null,
    });
  }

  return {
    provider: providerName,
    durationMs: Date.now() - startedAt,
    usage: data?.usage || null,
    text: extractTextContent(data),
  };
}

async function callGemini({
  apiKey,
  model,
  prompt,
  temperature,
  maxTokens,
  providerName,
  groundWithGoogleSearch = false,
  jsonMode = false,
}) {
  const startedAt = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'x-goog-api-client': 'lifeos-local/1.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: 'Return plain text only. When JSON is requested, return valid JSON only with no markdown fences or commentary.',
          },
        ],
      },
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
      ...(groundWithGoogleSearch ? { tools: [{ google_search: {} }] } : {}),
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new HttpError(502, `LLM provider ${providerName} failed.`, {
      provider: providerName,
      details: data?.error?.message || data?.error || null,
    });
  }

  return {
    provider: providerName,
    durationMs: Date.now() - startedAt,
    usage: data?.usageMetadata || null,
    text: extractGeminiText(data),
  };
}

function resolveModel(provider, tier, env) {
  if (provider === 'gemini') {
    if (tier === 'premium') return env.GOOGLE_GEMINI_MODEL_PREMIUM;
    if (tier === 'standard') return env.GOOGLE_GEMINI_MODEL_STANDARD;
    return env.GOOGLE_GEMINI_MODEL_CHEAP;
  }

  if (provider === 'huggingface') {
    if (tier === 'premium') return env.HUGGINGFACE_MODEL_PREMIUM || env.HUGGINGFACE_MODEL_STANDARD || env.HUGGINGFACE_MODEL_CHEAP;
    if (tier === 'standard') return env.HUGGINGFACE_MODEL_STANDARD || env.HUGGINGFACE_MODEL_CHEAP;
    return env.HUGGINGFACE_MODEL_CHEAP;
  }

  if (tier === 'premium') return env.OPENROUTER_MODEL_PREMIUM;
  if (tier === 'standard') return env.OPENROUTER_MODEL_STANDARD;
  return env.OPENROUTER_MODEL_CHEAP;
}

async function routeRaw({
  taskType,
  prompt,
  userId = null,
  policy = {},
  metadata = {},
  groundWithGoogleSearch = false,
  jsonMode = false,
}) {
  const env = getServerEnv();
  const resolved = resolveTier(taskType, policy);
  const attemptedProviders = [];

  const providers = [];
  if (env.GOOGLE_GEMINI_API_KEY) providers.push('gemini');
  if (env.OPENROUTER_API_KEY) providers.push('openrouter');
  if (env.HUGGINGFACE_API_KEY) providers.push('huggingface');

  if (!providers.length) {
    throw new HttpError(503, 'No AI provider is configured for the backend.');
  }

  let lastError = null;

  for (const provider of providers) {
    try {
      const model = resolveModel(provider, resolved.tier, env);
      if (!model) continue;

      const call = provider === 'gemini'
        ? await callGemini({
          apiKey: env.GOOGLE_GEMINI_API_KEY,
          model,
          prompt,
          temperature: resolved.temperature,
          maxTokens: resolved.maxTokens,
          providerName: provider,
          groundWithGoogleSearch,
          jsonMode,
        })
        : await callOpenAiCompatible({
          baseUrl: provider === 'huggingface' ? env.HUGGINGFACE_BASE_URL : env.OPENROUTER_BASE_URL,
          apiKey: provider === 'huggingface' ? env.HUGGINGFACE_API_KEY : env.OPENROUTER_API_KEY,
          model,
          prompt,
          temperature: resolved.temperature,
          maxTokens: resolved.maxTokens,
          providerName: provider,
        });

      await logRun({
        user_id: userId,
        task_type: taskType,
        provider,
        model,
        tier: resolved.tier,
        latency_ms: call.durationMs,
        request_summary: metadata.requestSummary || null,
        response_excerpt: call.text.slice(0, 2000),
        token_input: call.usage?.promptTokenCount || call.usage?.prompt_tokens || null,
        token_output: call.usage?.candidatesTokenCount || call.usage?.completion_tokens || null,
        estimated_cost_usd: null,
        status: 'success',
      });

      return {
        provider,
        model,
        text: call.text,
      };
    } catch (error) {
      lastError = error;
      attemptedProviders.push(provider);
      await logRun({
        user_id: userId,
        task_type: taskType,
        provider,
        model: resolveModel(provider, resolved.tier, env),
        tier: resolved.tier,
        latency_ms: null,
        request_summary: metadata.requestSummary || null,
        response_excerpt: null,
        token_input: null,
        token_output: null,
        estimated_cost_usd: null,
        status: 'error',
        error_message: error?.message || 'Unknown AI provider error',
      });
    }
  }

  const detailMessage = lastError instanceof HttpError
    ? lastError.extras?.details
    : null;

  throw new HttpError(
    502,
    detailMessage
      ? `${lastError?.message || 'AI provider failed.'} ${typeof detailMessage === 'string' ? detailMessage : JSON.stringify(detailMessage)}`
      : (lastError?.message || 'All AI providers failed.'),
    {
      attemptedProviders,
      ...(lastError instanceof HttpError && lastError.extras ? lastError.extras : {}),
    },
  );
}

export async function routeText(options) {
  return routeRaw(options);
}

export async function routeJson({
  taskType,
  prompt,
  userId = null,
  policy = {},
  metadata = {},
  groundWithGoogleSearch = false,
  jsonMode = false,
}) {
  const result = await routeRaw({
    taskType,
    prompt,
    userId,
    policy,
    metadata,
    groundWithGoogleSearch,
    jsonMode: true,
  });

  return {
    ...result,
    data: extractJson(result.text),
  };
}

export async function routeStructuredJson({
  taskType,
  prompt,
  schema,
  userId = null,
  policy = {},
  metadata = {},
  groundWithGoogleSearch = false,
  jsonMode = false,
}) {
  const result = await routeJson({
    taskType,
    prompt,
    userId,
    policy,
    metadata,
    groundWithGoogleSearch,
    jsonMode: true,
  });

  return {
    provider: result.provider,
    model: result.model,
    data: schema.parse(result.data),
  };
}
