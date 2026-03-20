import { fetchExternalJson } from '../lib/external-api.js';

function normalizePokemonResults(payload) {
  return (payload?.data || []).map((card) => ({
    id: card.id,
    name: card.name,
    set: card.set?.name || '',
    rarity: card.rarity || '',
    image: card.images?.small || '',
    priceUSD: null,
  }));
}

function normalizeYugiohResults(payload) {
  return (payload?.data || []).map((card) => ({
    id: String(card.id),
    name: card.name,
    set: card.type || '',
    rarity: card.card_sets?.[0]?.set_rarity || '',
    image: card.card_images?.[0]?.image_url_small || '',
    priceUSD: null,
  }));
}

function normalizeOnePieceResults(payload) {
  return (payload || []).slice(0, 8).map((card) => ({
    id: card.card_set_id,
    name: card.card_name,
    set: card.set_name || '',
    rarity: card.rarity || '',
    image: card.card_image || '',
    priceUSD: card.market_price || null,
  }));
}

function normalizeMagicResults(payload) {
  return (payload?.data || []).map((card) => ({
    id: card.id,
    name: card.name,
    set: card.set_name || '',
    rarity: card.rarity || '',
    image: card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '',
    priceUSD: null,
  }));
}

export async function searchTcgCards({ game, query }) {
  if (game === 'pokemon') {
    const payload = await fetchExternalJson(
      `https://api.pokemontcg.io/v2/cards?q=name:${encodeURIComponent(query)}*&pageSize=8&select=id,name,set,rarity,images`,
      { provider: 'Pokemon TCG' },
    );
    return normalizePokemonResults(payload);
  }

  if (game === 'yugioh') {
    const payload = await fetchExternalJson(
      `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(query)}&num=8&offset=0`,
      { provider: 'YGOProDeck' },
    );
    return normalizeYugiohResults(payload);
  }

  if (game === 'one_piece') {
    const payload = await fetchExternalJson(
      `https://optcgapi.com/api/sets/filtered/?card_name=${encodeURIComponent(query)}&format=json`,
      { provider: 'OptCG' },
    );
    return normalizeOnePieceResults(payload);
  }

  if (game === 'magic') {
    const payload = await fetchExternalJson(
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&per_page=8`,
      { provider: 'Scryfall' },
    );
    return normalizeMagicResults(payload);
  }

  return [];
}

export async function fetchTcgPriceUsd({ game, cardId }) {
  if (game === 'pokemon') {
    const payload = await fetchExternalJson(
      `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(cardId)}?select=id,tcgplayer,cardmarket`,
      { provider: 'Pokemon TCG' },
    );
    const card = payload?.data;
    return {
      priceUSD: card?.tcgplayer?.prices?.normal?.market
        || card?.tcgplayer?.prices?.holofoil?.market
        || card?.tcgplayer?.prices?.['1stEditionHolofoil']?.market
        || card?.cardmarket?.prices?.trendPrice
        || null,
    };
  }

  if (game === 'yugioh') {
    const payload = await fetchExternalJson(
      `https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${encodeURIComponent(cardId)}`,
      { provider: 'YGOProDeck' },
    );
    const prices = payload?.data?.[0]?.card_prices?.[0];
    return {
      priceUSD: parseFloat(prices?.tcgplayer_price) || parseFloat(prices?.cardmarket_price) || null,
    };
  }

  if (game === 'magic') {
    const payload = await fetchExternalJson(
      `https://api.scryfall.com/cards/${encodeURIComponent(cardId)}`,
      { provider: 'Scryfall' },
    );
    return {
      priceUSD: parseFloat(payload?.prices?.usd) || parseFloat(payload?.prices?.usd_foil) || null,
    };
  }

  return {
    priceUSD: null,
  };
}
