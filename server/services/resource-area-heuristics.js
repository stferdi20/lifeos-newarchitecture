function stripText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DOMAIN_PROFILES = [
  {
    key: 'sustainability',
    areaMatchers: ['sustain', 'environment', 'climate', 'policy', 'governance', 'esg', 'public policy', 'market'],
    topicKeywords: ['sustainability', 'sustainable', 'environment', 'environmental', 'climate', 'emissions', 'carbon', 'esg', 'policy', 'governance', 'regulation', 'energy transition', 'decarbonization', 'net zero', 'green finance'],
  },
  {
    key: 'career',
    areaMatchers: ['career', 'job', 'work', 'professional', 'intern', 'consult', 'business'],
    topicKeywords: ['career', 'job', 'jobs', 'internship', 'internships', 'resume', 'cv', 'cover letter', 'interview', 'recruiter', 'consulting', 'professional development', 'application', 'hiring', 'networking'],
  },
  {
    key: 'ai',
    areaMatchers: ['ai', 'artificial intelligence', 'coding', 'code', 'tech', 'automation', 'product', 'software'],
    topicKeywords: ['ai', 'artificial intelligence', 'llm', 'gpt', 'chatgpt', 'prompt', 'automation', 'agent', 'coding', 'code', 'developer', 'software', 'api', 'app', 'product', 'tooling', 'image generation', 'video generation'],
  },
  {
    key: 'creator',
    areaMatchers: ['creator', 'design', 'content', 'portfolio', 'brand', 'marketing', 'social', 'media'],
    topicKeywords: ['design', 'graphic design', 'motion', 'poster', 'reels', 'carousel', 'instagram', 'ig', 'social media', 'content creation', 'video editing', 'visual identity', 'portfolio', 'branding', 'pinterest', 'creative direction'],
  },
  {
    key: 'finance',
    areaMatchers: ['finance', 'money', 'invest', 'stock', 'crypto', 'trading', 'market'],
    topicKeywords: ['finance', 'financial', 'stocks', 'stock market', 'macro', 'investing', 'investment', 'portfolio', 'crypto', 'bitcoin', 'ethereum', 'trading', 'equity', 'valuation'],
  },
  {
    key: 'health',
    areaMatchers: ['health', 'fitness', 'gym', 'wellness', 'habit'],
    topicKeywords: ['gym', 'fitness', 'workout', 'stretch', 'mobility', 'plank', 'routine', 'habit', 'wellness', 'exercise', 'recovery', 'strength', 'cardio'],
  },
  {
    key: 'games',
    areaMatchers: ['game', 'gaming', 'boardgame', 'board game', 'tcg', 'anime', 'media', 'entertainment', 'pop culture'],
    topicKeywords: ['boardgame', 'board game', 'tcg', 'trading card game', 'pokemon', 'one piece', 'digimon', 'anime', 'manga', 'gaming', 'game design', 'mobile game', 'marvel snap', 'clash royale', 'clash of clans', 'review'],
  },
  {
    key: 'faith',
    areaMatchers: ['faith', 'church', 'spiritual', 'bible', 'community', 'ministry'],
    topicKeywords: ['church', 'bible', 'faith', 'prayer', 'worship', 'sermon', 'connect group', 'discipleship', 'christian', 'hillsong', 'community', 'icebreaker'],
  },
];

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toTokenSet(value) {
  return new Set(
    stripText(value)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function countPhraseMatches(haystack, keywords = []) {
  let score = 0;
  for (const keyword of keywords) {
    const cleaned = stripText(keyword).toLowerCase();
    if (!cleaned) continue;
    const regex = new RegExp(`(^|[^a-z0-9])${escapeRegex(cleaned)}(?=$|[^a-z0-9])`, 'i');
    if (regex.test(haystack)) {
      score += cleaned.includes(' ') ? 3 : 2;
    }
  }
  return score;
}

function findDomainProfileForArea(areaName = '') {
  const normalized = stripText(areaName).toLowerCase();
  if (!normalized) return null;

  let bestProfile = null;
  let bestScore = 0;

  for (const profile of DOMAIN_PROFILES) {
    const score = profile.areaMatchers.reduce((total, matcher) => {
      const cleaned = stripText(matcher).toLowerCase();
      if (!cleaned) return total;
      return total + (normalized.includes(cleaned) ? (cleaned.includes(' ') ? 3 : 2) : 0);
    }, 0);

    if (score > bestScore) {
      bestProfile = profile;
      bestScore = score;
    }
  }

  return bestProfile;
}

function buildAreaScoringContext({
  title = '',
  summary = '',
  whyItMatters = '',
  mainTopic = '',
  tags = [],
  description = '',
  content = '',
  resourceType = '',
} = {}) {
  const titleText = stripText(title).toLowerCase();
  const topicText = stripText(mainTopic).toLowerCase();
  const summaryText = stripText(summary).toLowerCase();
  const whyText = stripText(whyItMatters).toLowerCase();
  const descriptionText = stripText(description).toLowerCase();
  const tagsText = Array.isArray(tags) ? tags.map((tag) => stripText(tag).toLowerCase()).join(' ') : '';
  const contentText = stripText(String(content || '').slice(0, 5000)).toLowerCase();
  const haystack = [titleText, topicText, summaryText, whyText, descriptionText, tagsText, contentText, stripText(resourceType).toLowerCase()]
    .filter(Boolean)
    .join(' ');

  return {
    haystack,
    titleText,
    topicText,
    summaryText,
    whyText,
    contentTokens: toTokenSet(contentText),
  };
}

function scoreAreaCandidate(areaName, scoringContext) {
  const normalizedAreaName = stripText(areaName).toLowerCase();
  if (!normalizedAreaName) return { score: 0, matchedProfile: null };

  const areaTokens = normalizedAreaName.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  const exactPhraseRegex = new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedAreaName)}(?=$|[^a-z0-9])`, 'i');
  let score = exactPhraseRegex.test(scoringContext.haystack) ? 8 : 0;

  for (const token of areaTokens) {
    if (scoringContext.titleText.includes(token)) score += 4;
    else if (scoringContext.topicText.includes(token)) score += 3;
    else if (scoringContext.summaryText.includes(token) || scoringContext.whyText.includes(token)) score += 2;
    else if (scoringContext.contentTokens.has(token)) score += 1;
  }

  const matchedProfile = findDomainProfileForArea(areaName);
  if (matchedProfile) {
    score += countPhraseMatches(scoringContext.haystack, matchedProfile.topicKeywords);
  }

  return { score, matchedProfile };
}

export function isKnowledgeAreaName(value = '') {
  return stripText(value).toLowerCase() === 'knowledge';
}

export function chooseHeuristicArea({
  areas = [],
  title = '',
  summary = '',
  whyItMatters = '',
  mainTopic = '',
  tags = [],
  description = '',
  content = '',
  resourceType = '',
} = {}) {
  const candidates = (areas || []).filter((area) => !isKnowledgeAreaName(area?.name || ''));
  if (!candidates.length) return { areaName: '', score: 0, confidence: 'low', matchedProfile: null };

  const scoringContext = buildAreaScoringContext({
    title,
    summary,
    whyItMatters,
    mainTopic,
    tags,
    description,
    content,
    resourceType,
  });

  let best = { areaName: '', score: 0, confidence: 'low', matchedProfile: null };
  let secondBestScore = 0;

  for (const area of candidates) {
    const candidate = scoreAreaCandidate(area.name || '', scoringContext);
    if (candidate.score > best.score) {
      secondBestScore = best.score;
      best = {
        areaName: area.name || '',
        score: candidate.score,
        confidence: candidate.score >= 8 ? 'high' : (candidate.score >= 4 ? 'medium' : 'low'),
        matchedProfile: candidate.matchedProfile?.key || null,
      };
    } else if (candidate.score > secondBestScore) {
      secondBestScore = candidate.score;
    }
  }

  if (best.score < 3) return { areaName: '', score: best.score, confidence: 'low', matchedProfile: best.matchedProfile };
  if (best.score - secondBestScore <= 1 && best.score < 8) {
    return { areaName: '', score: best.score, confidence: 'low', matchedProfile: best.matchedProfile };
  }

  return best;
}

export function isWeakAreaAssignment({ areaName = '', areaNeedsReview = false } = {}) {
  return !stripText(areaName) || isKnowledgeAreaName(areaName) || Boolean(areaNeedsReview);
}
