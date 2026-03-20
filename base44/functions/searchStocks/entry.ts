import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { query } = await req.json();
    if (!query || query.length < 2) return Response.json({ results: [] });

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=en-AU&region=AU&quotesCount=10&newsCount=0&enableFuzzyQuery=false&enableNavLinks=false`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return Response.json({ results: [] });

    const data = await res.json();
    const results = (data.quotes || [])
      .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
      .slice(0, 8)
      .map(q => ({
        id: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        symbol: q.symbol?.replace('.JK', ''),
        set: q.exchange,
      }));

    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});