import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseHeuristicArea, isKnowledgeAreaName } from '../resource-area-heuristics.js';

const areas = [
  { id: '1', name: 'Knowledge' },
  { id: '2', name: 'Sustainability' },
  { id: '3', name: 'AI & Coding' },
  { id: '4', name: 'Creator' },
  { id: '5', name: 'Finance' },
  { id: '6', name: 'Faith' },
];

test('maps sustainability and policy resources away from Knowledge', () => {
  const result = chooseHeuristicArea({
    areas,
    title: 'Climate policy and carbon market update',
    summary: 'A breakdown of decarbonization policy and ESG regulation shifts.',
    content: 'The article covers climate governance, carbon pricing, and environmental policy.',
    resourceType: 'article',
  });

  assert.equal(result.areaName, 'Sustainability');
});

test('maps AI resources away from Knowledge', () => {
  const result = chooseHeuristicArea({
    areas,
    title: 'Best coding agents for app builders',
    summary: 'A look at AI coding workflows, automation, and API-first product building.',
    content: 'The post compares LLM coding tools, agentic automation, and developer workflows.',
    resourceType: 'website',
  });

  assert.equal(result.areaName, 'AI & Coding');
});

test('maps creator resources away from Knowledge', () => {
  const result = chooseHeuristicArea({
    areas,
    title: 'Instagram reel design inspiration',
    summary: 'Visual inspiration for carousels, motion posters, and content creation.',
    content: 'Use Pinterest references and short-form video editing to improve social content.',
    resourceType: 'website',
  });

  assert.equal(result.areaName, 'Creator');
});

test('maps finance resources away from Knowledge', () => {
  const result = chooseHeuristicArea({
    areas,
    title: 'Crypto and stock market macro overview',
    summary: 'A quick macro brief for investors tracking trading setups.',
    content: 'The thread covers crypto sentiment, portfolio positioning, and equity market trends.',
    resourceType: 'reddit',
  });

  assert.equal(result.areaName, 'Finance');
});

test('maps faith resources away from Knowledge', () => {
  const result = chooseHeuristicArea({
    areas,
    title: 'Bible study icebreaker ideas for connect groups',
    summary: 'Simple prompts for church community discussions and discipleship.',
    content: 'These church group icebreakers help with faith conversations and bible study.',
    resourceType: 'article',
  });

  assert.equal(result.areaName, 'Faith');
});

test('keeps broad generic resources without a forced non-Knowledge match', () => {
  const result = chooseHeuristicArea({
    areas,
    title: 'How to learn better',
    summary: 'General advice for lifelong learning across many topics.',
    content: 'A broad article about curiosity, study habits, and staying motivated.',
    resourceType: 'article',
  });

  assert.equal(result.areaName, '');
});

test('recognizes Knowledge area name directly', () => {
  assert.equal(isKnowledgeAreaName('Knowledge'), true);
  assert.equal(isKnowledgeAreaName('knowledge'), true);
  assert.equal(isKnowledgeAreaName('Career'), false);
});
