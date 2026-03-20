import { fetchExternalJson } from '../lib/external-api.js';

function normalizeStockSearchResults(payload) {
  return (payload?.quotes || [])
    .filter((entry) => entry?.symbol && entry?.shortname)
    .map((entry) => ({
      id: entry.symbol,
      symbol: entry.symbol,
      name: entry.shortname,
      set: entry.exchange || entry.exchDisp || '',
      image: '',
    }));
}

function normalizeCryptoSearchResults(payload) {
  return (payload?.coins || []).slice(0, 8).map((entry) => ({
    id: entry.id,
    name: entry.name,
    symbol: entry.id,
    set: entry.symbol?.toUpperCase() || '',
    image: entry.large || '',
  }));
}

export async function searchStocks(query) {
  const payload = await fetchExternalJson(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
    { provider: 'Yahoo Finance' },
  );

  return normalizeStockSearchResults(payload);
}

export async function searchCrypto(query) {
  const payload = await fetchExternalJson(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
    { provider: 'CoinGecko' },
  );

  return normalizeCryptoSearchResults(payload);
}

export async function fetchUsdToIdrRate() {
  const payload = await fetchExternalJson(
    'https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=idr',
    { provider: 'CoinGecko' },
  );

  return {
    rate: payload?.tether?.idr || 16000,
  };
}
