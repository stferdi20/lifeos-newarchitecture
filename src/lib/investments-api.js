import { apiGet, apiPost } from '@/lib/api-client';
import { createCrudApi } from '@/lib/compat-entity-api';

export const Investment = createCrudApi({
  basePath: '/investments',
  collectionKey: 'investments',
  itemKey: 'investment',
  defaultSort: 'name',
});

export function fetchInvestmentPrices(payload) {
  return apiPost('/investments/prices', payload);
}

export function searchStocks(payload) {
  return apiPost('/investments/search-stocks', payload);
}

export function searchCrypto(payload) {
  return apiPost('/investments/search-crypto', payload);
}

export function fetchUsdToIdrRate() {
  return apiGet('/investments/fx/usd-idr');
}
