import React from 'react';
import { Input } from '@/components/ui/input';

const RATES = { IDR: 1, AUD: 10500, USD: 16300 }; // approximate fallbacks
const SYMBOLS = { IDR: 'Rp', AUD: 'A$', USD: '$' };

export function toIDR(amount, currency) {
  return (parseFloat(amount) || 0) * (RATES[currency] || 1);
}

export default function CurrencyPriceInput({ label, value, currency, onCurrencyChange, onChange }) {
  const currencies = ['IDR', 'AUD', 'USD'];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-muted-foreground">{label}</label>
        <div className="flex gap-1">
          {currencies.map(c => (
            <button key={c} type="button"
              onClick={() => onCurrencyChange(c)}
              className={`text-xs px-2 py-0.5 rounded-full transition-all border ${
                currency === c
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground border-border hover:border-foreground/30'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">
          {SYMBOLS[currency]}
        </span>
        <Input
          type="number"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          className="pl-8"
        />
      </div>
      {currency !== 'IDR' && value > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          ≈ Rp {toIDR(value, currency).toLocaleString('id-ID')} IDR
        </p>
      )}
    </div>
  );
}