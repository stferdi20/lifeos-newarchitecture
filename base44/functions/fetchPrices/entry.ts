import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

// Fetch with abort timeout to prevent hanging
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// Fetch stock price from Yahoo Finance
async function fetchStockPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res?.ok) return null;
    const data = await res.json();
    return data?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
  } catch {
    return null;
  }
}

// Batch-fetch crypto prices + USD/IDR rate in one CoinGecko call
async function fetchCryptoPricesAndRate(coinIds) {
  try {
    const ids = [...new Set([...coinIds, 'tether'])].join(',');
    const res = await fetchWithTimeout(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=idr`);
    if (!res?.ok) return { prices: {}, usdToIdr: 16000 };
    const data = await res.json();
    const usdToIdr = data?.tether?.idr || 16000;
    const prices = {};
    for (const id of coinIds) prices[id] = data?.[id]?.idr || null;
    return { prices, usdToIdr };
  } catch {
    return { prices: {}, usdToIdr: 16000 };
  }
}

// Fetch USD/IDR rate only (when no crypto in portfolio)
async function fetchUSDtoIDR() {
  const { usdToIdr } = await fetchCryptoPricesAndRate([]);
  return usdToIdr;
}

// Yu-Gi-Oh price via YGOPRODeck (USD) — works server-side
async function fetchYugiohPrice(nameOrId) {
  try {
    const param = /^\d+$/.test(nameOrId) ? `id=${nameOrId}` : `name=${encodeURIComponent(nameOrId)}`;
    const res = await fetchWithTimeout(`https://db.ygoprodeck.com/api/v7/cardinfo.php?${param}`);
    if (!res?.ok) return null;
    const data = await res.json();
    const prices = data?.data?.[0]?.card_prices?.[0];
    return parseFloat(prices?.tcgplayer_price) || parseFloat(prices?.cardmarket_price) || null;
  } catch {
    return null;
  }
}

// One Piece price via OPTCG API (card_set_id stored as symbol)
async function fetchOnePiecePrice(cardSetId) {
  try {
    const res = await fetchWithTimeout(`https://optcgapi.com/api/sets/card/${cardSetId}/?format=json`);
    if (!res?.ok) return null;
    const data = await res.json();
    return data?.[0]?.market_price || null;
  } catch {
    return null;
  }
}

// NOTE: Pokémon (pokemontcg.io) and MTG (Scryfall) are fetched browser-side on card select
// because those APIs are blocked/unreliable server-side.
// The scheduled refresh will only update stocks, crypto, and Yu-Gi-Oh.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { investments } = await req.json();

    // Batch-fetch all crypto + USD/IDR rate in one call
    const cryptoIds = investments
      .filter(i => i.type === 'crypto' && i.symbol)
      .map(i => i.symbol.toLowerCase());
    const { prices: cryptoPrices, usdToIdr } = await fetchCryptoPricesAndRate(cryptoIds);

    // Fetch all prices in parallel
    const results = await Promise.all(investments.map(async (inv) => {
      let price = null;

      if (inv.type === 'stock' && inv.symbol) {
        const symbol = inv.symbol.includes('.') ? inv.symbol : `${inv.symbol}.JK`;
        price = await fetchStockPrice(symbol);
      } else if (inv.type === 'crypto' && inv.symbol) {
        price = cryptoPrices[inv.symbol.toLowerCase()] || null;
      } else if (inv.type === 'tcg' && inv.name) {
        let priceUSD = null;
        const lookup = inv.symbol || inv.name;

        if (inv.tcg_game === 'yugioh') {
          priceUSD = await fetchYugiohPrice(lookup);
        } else if (inv.tcg_game === 'one_piece' && inv.symbol) {
          priceUSD = await fetchOnePiecePrice(inv.symbol);
        }
        // pokemon & magic: fetched browser-side at card select time (APIs blocked server-side)
        // digimon, etc: no free public price API available

        if (priceUSD) price = Math.round(priceUSD * usdToIdr);
      }

      return { id: inv.id, price };
    }));

    return Response.json({ results, usdToIdr });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});