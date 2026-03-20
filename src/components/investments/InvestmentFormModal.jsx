import React, { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TcgCardSearch from './TcgCardSearch';
import AssetSearch from './AssetSearch';
import CurrencyPriceInput, { toIDR } from './CurrencyPriceInput';
import { MobileStickyActions, ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';
import { fetchUsdToIdrRate } from '@/lib/investments-api';

const INVESTMENT_TYPES = [
  { key: 'stock', label: 'Indonesia Stock (IDX)' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'tcg', label: 'TCG Card' },
  { key: 'bank', label: 'Bank / Cash' },
];

const defaultForm = {
  name: '', type: 'stock', symbol: '', tcg_game: 'pokemon', tcg_edition: 'English',
  tcg_product_type: 'card', tcg_image_url: '',
  quantity: '', purchase_price_input: '', input_currency: 'IDR',
  current_price: '', notes: '',
};

export default function InvestmentFormModal({ open, onClose, onSave, existing }) {
  const handleTcgPriceFetched = async (priceUSD) => {
    if (!priceUSD) return;
    try {
      const data = await fetchUsdToIdrRate();
      const rate = data?.rate || 16000;
      set('current_price', Math.round(priceUSD * rate));
    } catch {
      set('current_price', Math.round(priceUSD * 16000));
    }
  };

  const init = existing ? {
    ...defaultForm,
    ...existing,
    purchase_price_input: existing.purchase_price_input ?? existing.purchase_price ?? '',
    input_currency: existing.input_currency ?? 'IDR',
  } : defaultForm;

  const [form, setForm] = useState(init);
  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const isBank = form.type === 'bank';
  const isTcg = form.type === 'tcg';
  const isCrypto = form.type === 'crypto';
  const isStock = form.type === 'stock';

  const handleSave = () => {
    const purchasePriceIDR = isBank ? 1 : toIDR(form.purchase_price_input, form.input_currency);
    const data = {
      ...form,
      quantity: parseFloat(form.quantity) || 0,
      purchase_price: purchasePriceIDR,
      purchase_price_input: parseFloat(form.purchase_price_input) || 0,
      current_price: isBank ? 1 : (parseFloat(form.current_price) || 0),
    };
    onSave(data);
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="max-w-md max-h-[90vh] overflow-y-auto" mobileClassName="border-border bg-background">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{existing ? 'Edit Investment' : 'Add Investment'}</ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <div className="space-y-3 px-4 pb-4 pt-1 sm:px-0 sm:pb-0 sm:pt-2">

          {/* Type */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Type</label>
            <Select value={form.type} onValueChange={v => set('type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INVESTMENT_TYPES.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* TCG-specific fields */}
          {isTcg && (
            <TcgCardSearch
              value={form.name}
              onChange={v => set('name', v)}
              onSymbolChange={v => set('symbol', v)}
              onPriceUSDFetched={handleTcgPriceFetched}
              tcgGame={form.tcg_game}
              onGameChange={v => set('tcg_game', v)}
              tcgEdition={form.tcg_edition}
              onEditionChange={v => set('tcg_edition', v)}
              productType={form.tcg_product_type}
              onProductTypeChange={v => set('tcg_product_type', v)}
            />
          )}

          {/* Name + Symbol (non-TCG) */}
          {!isTcg && (
            <AssetSearch
              type={form.type}
              nameValue={form.name}
              symbolValue={form.symbol}
              onNameChange={v => set('name', v)}
              onSymbolChange={v => set('symbol', v)}
            />
          )}

          {/* Quantity */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {isStock ? 'Lots (1 lot = 100 shares)' : isBank ? 'Amount (IDR)' : 'Quantity'}
            </label>
            <Input type="number" value={form.quantity} onChange={e => set('quantity', e.target.value)} placeholder="0" />
          </div>

          {/* Purchase price with currency toggle */}
          {!isBank && (
            <CurrencyPriceInput
              label={`Purchase Price per ${isStock ? 'Share' : isTcg ? 'Card' : 'Unit'}`}
              value={form.purchase_price_input}
              currency={form.input_currency}
              onCurrencyChange={v => set('input_currency', v)}
              onChange={v => set('purchase_price_input', v)}
            />
          )}

          {/* Current price manual override (TCG only — stocks/crypto auto-fetch) */}
          {isTcg && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Current Market Price per Card (IDR)</label>
              <Input type="number" value={form.current_price}
                onChange={e => set('current_price', e.target.value)} placeholder="0" />
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Notes (optional)</label>
            <Input value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          <MobileStickyActions className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={!form.name || !form.quantity}>Save</Button>
          </MobileStickyActions>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
