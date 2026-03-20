import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

function fmt(n) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(2)}M`;
  return `Rp ${n?.toLocaleString('id-ID') || 0}`;
}

const TYPE_LABELS = { stock: 'Stocks', crypto: 'Crypto', tcg: 'TCG', bank: 'Bank/Cash' };
const TYPE_COLORS = {
  stock: 'bg-blue-500',
  crypto: 'bg-orange-500',
  tcg: 'bg-purple-500',
  bank: 'bg-green-500',
};

export default function PortfolioSummary({ investments }) {
  const getValue = (inv) => {
    if (inv.type === 'bank') return inv.quantity;
    const price = inv.current_price || inv.purchase_price || 0;
    return price * inv.quantity * (inv.type === 'stock' ? 100 : 1);
  };

  const getCost = (inv) => {
    if (inv.type === 'bank') return inv.quantity;
    return inv.purchase_price * inv.quantity * (inv.type === 'stock' ? 100 : 1);
  };

  const totalValue = investments.reduce((s, i) => s + getValue(i), 0);
  const totalCost = investments.reduce((s, i) => s + getCost(i), 0);
  const totalPnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? ((totalPnl / totalCost) * 100).toFixed(1) : 0;
  const isUp = totalPnl >= 0;

  const byType = ['stock', 'crypto', 'tcg', 'bank'].map(type => {
    const items = investments.filter(i => i.type === type);
    const value = items.reduce((s, i) => s + getValue(i), 0);
    const pct = totalValue > 0 ? (value / totalValue) * 100 : 0;
    return { type, value, pct };
  }).filter(t => t.value > 0);

  return (
    <div className="bg-card/60 border border-border/50 rounded-2xl p-6 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <p className="text-sm text-muted-foreground mb-1">Total Portfolio</p>
          <p className="text-3xl font-bold">{fmt(totalValue)}</p>
        </div>
        <div className={`flex items-center gap-2 text-lg font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
          {isUp ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
          <span>{isUp ? '+' : ''}{fmt(Math.abs(totalPnl))} ({isUp ? '+' : ''}{pnlPct}%)</span>
        </div>
      </div>

      {/* Allocation bar */}
      {byType.length > 0 && (
        <div>
          <div className="flex rounded-full overflow-hidden h-2 mb-3 gap-px">
            {byType.map(t => (
              <div key={t.type} className={`${TYPE_COLORS[t.type]} transition-all`} style={{ width: `${t.pct}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {byType.map(t => (
              <div key={t.type} className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className={`w-2 h-2 rounded-full ${TYPE_COLORS[t.type]}`} />
                <span>{TYPE_LABELS[t.type]}</span>
                <span className="font-medium text-foreground">{fmt(t.value)}</span>
                <span>({t.pct.toFixed(0)}%)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}