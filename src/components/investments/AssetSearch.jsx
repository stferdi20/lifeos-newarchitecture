import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Loader2, Search } from 'lucide-react';
import { debounce } from 'lodash';
import { searchCrypto as searchCryptoApi, searchStocks as searchStocksApi } from '@/lib/investments-api';

// Search Yahoo Finance via backend proxy (avoids CORS)
async function searchStocks(query) {
  const res = await searchStocksApi({ query });
  return res?.results || [];
}

// Search CoinGecko for crypto
async function searchCrypto(query) {
  const res = await searchCryptoApi({ query });
  return res?.results || [];
}

// Common Indonesian banks / savings types
const BANK_SUGGESTIONS = [
  'BCA Tabungan', 'BCA Deposito', 'BRI Tabungan', 'BRI Deposito',
  'Mandiri Tabungan', 'BNI Tabungan', 'CIMB Niaga', 'Jenius',
  'Commonwealth Bank', 'NAB', 'ANZ', 'Westpac', 'CBA',
  'Cash (IDR)', 'Cash (AUD)', 'Cash (USD)',
];

function searchBank(query) {
  const q = query.toLowerCase();
  return BANK_SUGGESTIONS
    .filter(b => b.toLowerCase().includes(q))
    .slice(0, 6)
    .map(b => ({ id: b, name: b, symbol: null, set: 'Bank / Cash' }));
}

export default function AssetSearch({ type, nameValue, symbolValue, onNameChange, onSymbolChange }) {
  const [query, setQuery] = useState(nameValue || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const isStock = type === 'stock';
  const isCrypto = type === 'crypto';
  const isBank = type === 'bank';

  const placeholder = isStock
    ? 'Search IDX stock (e.g. Bank Central Asia)...'
    : isCrypto
    ? 'Search crypto (e.g. Bitcoin, Ethereum)...'
    : 'Search bank / savings type...';

  const doSearch = useCallback(debounce(async (q) => {
    if (!q.trim() || q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      let r = [];
      if (isStock) r = await searchStocks(q);
      else if (isCrypto) r = await searchCrypto(q);
      else r = searchBank(q);
      setResults(r);
      setOpen(true);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, 400), [type]);

  const handleInput = (val) => {
    setQuery(val);
    onNameChange(val);
    if (isBank) onSymbolChange('');
    doSearch(val);
  };

  const handleSelect = (item) => {
    setQuery(item.name);
    onNameChange(item.name);
    if (item.symbol) onSymbolChange(item.symbol);
    setOpen(false);
    setResults([]);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="space-y-2">
      <div ref={wrapperRef} className="relative">
        <label className="text-xs text-muted-foreground mb-1 block">Name</label>
        <div className="relative">
          {loading
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          }
          <Input
            value={query}
            onChange={e => handleInput(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder={placeholder}
            className="pl-8"
          />
        </div>

        {open && results.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {results.map((item, i) => (
              <button key={i} type="button"
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent text-left transition-colors"
                onClick={() => handleSelect(item)}>
                {item.image
                  ? <img src={item.image} alt={item.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                  : <div className="w-7 h-7 rounded-full bg-secondary shrink-0 flex items-center justify-center text-xs font-bold text-muted-foreground">
                      {item.name[0]}
                    </div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  {item.set && <p className="text-xs text-muted-foreground">{item.set}{item.symbol && item.symbol !== item.name ? ` · ${item.symbol}` : ''}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Symbol field only for stock/crypto, auto-filled but editable */}
      {(isStock || isCrypto) && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            {isStock ? 'Ticker (e.g. BBCA)' : 'CoinGecko ID (e.g. bitcoin)'}
          </label>
          <Input
            value={symbolValue}
            onChange={e => onSymbolChange(e.target.value)}
            placeholder={isStock ? 'BBCA' : 'bitcoin'}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {isStock ? 'Auto-appends .JK for Yahoo Finance' : 'Auto-filled · edit if wrong'}
          </p>
        </div>
      )}
    </div>
  );
}
