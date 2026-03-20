import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { searchMediaCatalog } from '../_shared/mediaCatalog/entry.ts';

const MATCH_CANDIDATE_LIMIT = 8;
const SEARCH_QUERY_LIMIT = 6;
const FALLBACK_AUTO_ACCEPT_THRESHOLD = 0.74;

type MediaCandidate = {
  external_id?: string;
  title?: string;
  year_released?: number | null;
  poster_url?: string | null;
  source_url?: string | null;
  media_type?: string;
  genres?: string[];
  studio_author?: string | null;
  episodes?: number | null;
};

function normalizeDecision(value: string) {
  return ['auto_accept', 'needs_review', 'no_match'].includes(value) ? value : 'no_match';
}

function normalizeConfidence(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function uniqueNonEmpty(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizeTitle(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeTitle(value: string) {
  return normalizeTitle(value).split(' ').filter(Boolean);
}

function stripOuterQuotes(value: string) {
  return String(value || '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

function stripTrailingYear(value: string) {
  return value.replace(/\s*\((?:19|20)\d{2}\)\s*$/i, '').replace(/\s+(?:19|20)\d{2}\s*$/i, '').trim();
}

function stripSeasonMarker(value: string) {
  return value
    .replace(/\s*[-:|]\s*(?:season|series|book|volume|vol\.?|part)\s+\d+\s*$/i, '')
    .replace(/\s+(?:season|series|book|volume|vol\.?|part)\s+\d+\s*$/i, '')
    .trim();
}

function stripSubtitle(value: string) {
  return value.split(/\s*[:\-|]\s*/)[0]?.trim() || value.trim();
}

function buildLooseSearchQueries(title: string) {
  const original = String(title || '').trim();
  const deQuoted = stripOuterQuotes(original);
  const noYear = stripTrailingYear(deQuoted);
  const noSeason = stripSeasonMarker(noYear);
  const noSubtitle = stripSubtitle(noSeason);
  const normalized = normalizeTitle(noSubtitle);
  const tokens = tokenizeTitle(noSubtitle).filter((token) => token !== 'the' && token !== 'a' && token !== 'an');
  const broadQueries = [];

  if (tokens.length >= 2) {
    broadQueries.push(tokens.slice(0, 2).join(' '));
  }
  if (tokens.length >= 1) {
    broadQueries.push(tokens[0]);
  }

  return uniqueNonEmpty([
    original,
    deQuoted,
    noYear,
    noSeason,
    noSubtitle,
    normalized,
    ...broadQueries,
  ]).slice(0, SEARCH_QUERY_LIMIT);
}

function levenshteinDistance(a: string, b: string) {
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let row = 1; row <= a.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;

    for (let column = 1; column <= b.length; column += 1) {
      const temp = previous[column];
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + cost,
      );
      diagonal = temp;
    }
  }

  return previous[b.length];
}

function stringSimilarity(left: string, right: string) {
  const a = normalizeTitle(left).replace(/\s+/g, '');
  const b = normalizeTitle(right).replace(/\s+/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(0, 1 - (levenshteinDistance(a, b) / Math.max(a.length, b.length)));
}

function scoreCandidateTitle(inputTitle: string, candidateTitle: string) {
  const normalizedInput = normalizeTitle(inputTitle);
  const normalizedCandidate = normalizeTitle(candidateTitle);
  if (!normalizedInput || !normalizedCandidate) return 0;
  if (normalizedInput === normalizedCandidate) return 1;

  const inputTokens = [...new Set(tokenizeTitle(inputTitle))];
  const candidateTokens = [...new Set(tokenizeTitle(candidateTitle))];
  if (inputTokens.length === 0 || candidateTokens.length === 0) return 0;

  const tokenScore = inputTokens.reduce((sum, token) => {
    const best = candidateTokens.reduce((currentBest, candidateToken) => (
      Math.max(currentBest, stringSimilarity(token, candidateToken))
    ), 0);
    return sum + best;
  }, 0) / inputTokens.length;

  const fullScore = stringSimilarity(inputTitle, candidateTitle);
  const prefixBonus = normalizedCandidate.includes(normalizedInput) || normalizedInput.includes(normalizedCandidate) ? 0.12 : 0;

  return Math.min(0.995, (tokenScore * 0.55) + (fullScore * 0.33) + prefixBonus);
}

function chooseFallbackCandidate(inputTitle: string, candidates: MediaCandidate[]) {
  const scored = (candidates || [])
    .map((candidate) => ({
      candidate,
      confidence: scoreCandidateTitle(inputTitle, String(candidate.title || '')),
    }))
    .filter((item) => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  if (!best || best.confidence < FALLBACK_AUTO_ACCEPT_THRESHOLD) {
    return null;
  }

  return best;
}

function candidateKey(candidate: MediaCandidate) {
  return String(candidate.external_id || candidate.source_url || candidate.title || '').trim().toLowerCase();
}

function mergeCandidateResults(resultSets: MediaCandidate[][]) {
  const merged: MediaCandidate[] = [];
  const seen = new Set<string>();

  for (const resultSet of resultSets) {
    for (const candidate of resultSet || []) {
      const key = candidateKey(candidate);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
      if (merged.length >= MATCH_CANDIDATE_LIMIT) {
        return merged;
      }
    }
  }

  return merged;
}

async function inferSearchQueries(base44: any, params: {
  type: string;
  originalTitle: string;
  initialQuery: string;
}) {
  const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
    model: 'gemini_3_flash',
    prompt: `You are preparing a strict API search query for a media catalog lookup.

Media type: ${params.type}
User input title: "${params.originalTitle}"
Initial raw query: "${params.initialQuery}"

Rules:
- Correct obvious spelling mistakes and punctuation issues.
- Keep the query aligned to the requested media type only.
- Preserve the intended franchise/work title.
- Do not invent a different title if the user's intent is unclear.
- Prefer the most likely canonical title that a public media API would index.
- Return 1 primary search title and up to 2 fallback search titles.
- Keep each search title concise and suitable for an API search box.
- If the input is already good, keep it.
- For misspellings like "academi", return the corrected real title spelling.

Return only valid JSON.`,
    response_json_schema: {
      type: 'object',
      properties: {
        primary_query: { type: 'string' },
        fallback_queries: {
          type: 'array',
          items: { type: 'string' },
        },
        reasoning: { type: 'string' },
      },
      required: ['primary_query', 'fallback_queries', 'reasoning'],
    },
  });

  const primaryQuery = String(llmResult?.primary_query || params.initialQuery || params.originalTitle || '').trim();
  const fallbackQueries = Array.isArray(llmResult?.fallback_queries)
    ? llmResult.fallback_queries.map((value: unknown) => String(value || '').trim())
    : [];
  const reasoning = String(llmResult?.reasoning || '').trim();

  const queries = uniqueNonEmpty([
    primaryQuery,
    ...fallbackQueries,
    params.initialQuery,
    params.originalTitle,
  ]).slice(0, SEARCH_QUERY_LIMIT);

  return {
    primaryQuery: queries[0] || params.initialQuery || params.originalTitle,
    queries,
    reasoning,
  };
}

async function resolveMediaMatch(base44: any, params: {
  type: string;
  query: string;
  originalTitle: string;
  results: MediaCandidate[];
  searchReasoning?: string;
}) {
  const candidates = (params.results || []).slice(0, MATCH_CANDIDATE_LIMIT);

  if (candidates.length === 0) {
    return {
      results: params.results,
      match: null,
      bestCandidate: null,
      matched: false,
      decision: 'no_match',
      confidence: 0,
      reason: params.searchReasoning
        ? `${params.searchReasoning} No API candidates were returned for this title.`
        : 'No API candidates were returned for this title.',
      queryUsed: params.query,
    };
  }

  const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
    model: 'gemini_3_flash',
    prompt: `You are matching a user-typed media title to one candidate from an API search result list.

Media type: ${params.type}
Original user title: "${params.originalTitle}"
API query used: "${params.query}"
Search reasoning: "${params.searchReasoning || 'No extra search reasoning provided.'}"

Important rules:
- The user title may contain typos, missing punctuation, bad spacing, or small wording mistakes.
- You may only choose from the provided candidates. Never invent a title, id, or URL.
- Prefer exact franchise/title intent over loose semantic similarity, and honor the requested media type strictly.
- Return "no_match" if none of the candidates is clearly the same work for the requested media type.
- If one candidate is clearly the intended title despite minor typos, select it.
- Use the exact external_id from the chosen candidate.

Candidates:
${candidates.map((candidate, index) => (
  `${index}: title="${candidate.title || ''}" | year=${candidate.year_released ?? 'unknown'} | external_id=${candidate.external_id || ''} | creator=${candidate.studio_author || ''} | genres=${(candidate.genres || []).join(', ')}`
)).join('\n')}

Return only valid JSON.`,
    response_json_schema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['auto_accept', 'needs_review', 'no_match'] },
        selected_external_id: { type: 'string' },
        confidence: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['decision', 'selected_external_id', 'confidence', 'reason'],
    },
  });

  const decision = normalizeDecision(String(llmResult?.decision || 'no_match'));
  const selectedExternalId = String(llmResult?.selected_external_id || '').trim();
  const selectedCandidate = candidates.find((candidate) => String(candidate.external_id || '').trim() === selectedExternalId) || null;
  const confidence = normalizeConfidence(llmResult?.confidence);
  const reason = String(llmResult?.reason || '').trim() || 'Base44 AI did not return a usable explanation.';
  const combinedReason = params.searchReasoning
    ? `${params.searchReasoning} ${reason}`.trim()
    : reason;
  const finalDecision = selectedCandidate && decision !== 'no_match' ? 'auto_accept' : 'no_match';

  if (!selectedCandidate || finalDecision === 'no_match') {
    const fallbackMatch = chooseFallbackCandidate(params.originalTitle, candidates);
    if (fallbackMatch) {
      return {
        results: params.results,
        match: fallbackMatch.candidate,
        bestCandidate: fallbackMatch.candidate,
        matched: true,
        decision: 'auto_accept',
        confidence: Math.max(confidence, fallbackMatch.confidence),
        reason: `${combinedReason} Deterministic title fallback matched this API candidate.`.trim(),
        queryUsed: params.query,
      };
    }

    return {
      results: params.results,
      match: null,
      bestCandidate: selectedCandidate,
      matched: false,
      decision: 'no_match',
      confidence,
      reason: combinedReason,
      queryUsed: params.query,
    };
  }

  return {
    results: params.results,
    match: selectedCandidate,
    bestCandidate: selectedCandidate,
    matched: true,
    decision: finalDecision,
    confidence,
    reason: combinedReason,
    queryUsed: params.query,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { type, query, resolveMatch = false, originalTitle } = await req.json();

    if (!query?.trim() || !type) {
      return Response.json({ results: [] });
    }

    if (!resolveMatch) {
      try {
        const results = await searchMediaCatalog(query, type);
        return Response.json({ results });
      } catch (error) {
        return Response.json(
          { error: `Media provider search failed: ${getErrorMessage(error)}` },
          { status: 502 },
        );
      }
    }

    try {
      const searchPlan = await inferSearchQueries(base44, {
        type,
        originalTitle: String(originalTitle || query || '').trim(),
        initialQuery: String(query || '').trim(),
      });
      const localFallbackQueries = buildLooseSearchQueries(String(originalTitle || query || '').trim());
      const resultSets = await Promise.all(
        uniqueNonEmpty([...searchPlan.queries, ...localFallbackQueries])
          .slice(0, SEARCH_QUERY_LIMIT)
          .map((searchQuery) => searchMediaCatalog(searchQuery, type)),
      );
      const results = mergeCandidateResults(resultSets);
      const resolved = await resolveMediaMatch(base44, {
        type,
        query: searchPlan.primaryQuery,
        originalTitle: String(originalTitle || query || '').trim(),
        results,
        searchReasoning: searchPlan.reasoning,
      });

      return Response.json(resolved);
    } catch (error) {
      const message = getErrorMessage(error);
      try {
        const results = await searchMediaCatalog(query, type);
        return Response.json({
          results,
          match: null,
          bestCandidate: null,
          matched: false,
          decision: 'no_match',
          confidence: 0,
          reason: `Base44 AI match resolution failed: ${message}`,
          queryUsed: query,
        });
      } catch (providerError) {
        return Response.json(
          { error: `Media match lookup failed: ${message}. Provider fallback also failed: ${getErrorMessage(providerError)}` },
          { status: 502 },
        );
      }
    }
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
});
