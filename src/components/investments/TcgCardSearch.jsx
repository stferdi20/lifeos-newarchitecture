import React, { useState, useCallback, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Search } from 'lucide-react';
import { debounce } from 'lodash';
import { fetchTcgPrice, searchTcgCards } from '@/lib/tcg-api';
const TCG_GAMES = [
  { key: 'pokemon', label: 'Pokémon', editions: ['Japanese', 'English', 'Korean', 'Chinese'] },
  { key: 'one_piece', label: 'One Piece', editions: ['Japanese', 'English', 'Chinese'] },
  { key: 'magic', label: 'Magic: The Gathering', editions: ['English', 'Japanese', 'Foil', 'Collector'] },
  { key: 'yugioh', label: 'Yu-Gi-Oh!', editions: ['Japanese', 'English', 'Asian English'] },
  { key: 'dragon_ball', label: 'Dragon Ball SCG', editions: ['Japanese', 'English'] },
  { key: 'digimon', label: 'Digimon', editions: ['Japanese', 'English'] },
  { key: 'flesh_blood', label: 'Flesh and Blood', editions: ['English', '1st Edition', 'Unlimited'] },
  { key: 'weiss', label: 'Weiß Schwarz', editions: ['Japanese', 'English'] },
  { key: 'other', label: 'Other TCG', editions: ['English', 'Japanese', 'Other'] },
];

const PRODUCT_TYPES = [
  { key: 'card', label: 'Single Card' },
  { key: 'booster_pack', label: 'Booster Pack' },
  { key: 'booster_box', label: 'Booster Box' },
  { key: 'case', label: 'Case' },
  { key: 'starter_deck', label: 'Starter Deck' },
  { key: 'special_set', label: 'Special Set' },
  { key: 'other', label: 'Other' },
];

export default function TcgCardSearch({ value, onChange, onSymbolChange, onPriceUSDFetched, tcgGame, onGameChange, tcgEdition, onEditionChange, productType, onProductTypeChange }) {
  const [query, setQuery] = useState(value || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const gameConfig = TCG_GAMES.find(g => g.key === tcgGame) || TCG_GAMES[0];
  const isManualGame = tcgGame === 'dragon_ball' || tcgGame === 'digimon' || tcgGame === 'flesh_blood' || tcgGame === 'weiss' || tcgGame === 'other';
  const isNonCardProduct = productType && productType !== 'card';

  const doSearch = useCallback(debounce(async (q, game) => {
    if (!q.trim() || q.length < 2) { setResults([]); setLoading(false); return; }
    const manual = ['dragon_ball', 'digimon', 'flesh_blood', 'weiss', 'other'].includes(game);
    if (manual) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await searchTcgCards({ game, query: q });
      const r = result?.results || [];
      setResults(r);
      setOpen(r.length > 0);
    } catch {
      setResults([]);
    }
    setLoading(false);
  }, 500), []);

  const handleInput = (val) => {
    setQuery(val);
    onChange(val);
    doSearch(val, tcgGame);
  };

  const handleSelect = async (card) => {
    setQuery(card.name);
    onChange(card.name);
    if (onSymbolChange) onSymbolChange(card.id || '');

    // One Piece: price already in search result
    if (onPriceUSDFetched && tcgGame === 'one_piece' && card.priceUSD) {
      onPriceUSDFetched(card.priceUSD);
    }

    if (onPriceUSDFetched && card.id && ['pokemon', 'yugioh', 'magic'].includes(tcgGame)) {
      try {
        const data = await fetchTcgPrice({ game: tcgGame, cardId: card.id });
        onPriceUSDFetched(data?.priceUSD || null);
      } catch {}
    }

    setOpen(false);
    setResults([]);
  };

  return (
    <div className="space-y-3">
      {/* Game Type */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">TCG Game</label>
        <Select value={tcgGame} onValueChange={v => { onGameChange(v); setResults([]); }}>
          <SelectTrigger><SelectValue placeholder="Select game..." /></SelectTrigger>
          <SelectContent>
            {TCG_GAMES.map(g => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Product Type */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Product Type</label>
        <Select value={productType || 'card'} onValueChange={onProductTypeChange}>
          <SelectTrigger><SelectValue placeholder="Select product type..." /></SelectTrigger>
          <SelectContent>
            {PRODUCT_TYPES.map(p => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Edition / Language */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Edition / Language</label>
        <Select value={tcgEdition} onValueChange={onEditionChange}>
          <SelectTrigger><SelectValue placeholder="Select edition..." /></SelectTrigger>
          <SelectContent>
            {gameConfig.editions.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            <SelectItem value="Other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Card / Product Name */}
      <div ref={wrapperRef} className="relative">
        <label className="text-xs text-muted-foreground mb-1 block">
          {isNonCardProduct ? `${PRODUCT_TYPES.find(p => p.key === productType)?.label} Name` : (isManualGame ? 'Product / Card Name' : 'Search Card Name')}
        </label>

        <div className="relative">
          {loading
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          }
          <Input
            value={query}
            onChange={e => handleInput(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder={isManualGame ? `Enter ${gameConfig.label} product name...` : `Search ${gameConfig.label} ${isNonCardProduct ? PRODUCT_TYPES.find(p => p.key === productType)?.label.toLowerCase() : 'card'}...`}
            className="pl-8"
          />
        </div>

        {open && results.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {results.map((card, i) => (
              <button key={i} type="button"
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-accent text-left transition-colors"
                onClick={() => handleSelect(card)}>
                {card.image
                  ? <img src={card.image} alt={card.name} className="w-8 h-10 object-cover rounded shrink-0" />
                  : <div className="w-8 h-10 bg-secondary rounded shrink-0 flex items-center justify-center text-xs text-muted-foreground">?</div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{card.name}</p>
                  {(card.set || card.rarity) && (
                    <p className="text-xs text-muted-foreground truncate">
                      {[card.set, card.rarity].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
