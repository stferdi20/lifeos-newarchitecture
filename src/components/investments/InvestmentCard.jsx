import React from 'react';
import { TrendingUp, TrendingDown, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TYPE_COLORS = {
  stock: 'bg-blue-500/20 text-blue-400',
  crypto: 'bg-orange-500/20 text-orange-400',
  tcg: 'bg-purple-500/20 text-purple-400',
  bank: 'bg-green-500/20 text-green-400',
};

const TYPE_LABELS = {
  stock: 'Stock',
  crypto: 'Crypto',
  tcg: 'TCG',
  bank: 'Bank',
};

function fmt(n) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `Rp ${(n / 1_000).toFixed(1)}K`;
  return `Rp ${n?.toLocaleString('id-ID') || 0}`;
}

export default function InvestmentCard({ inv, onEdit, onDelete }) {
  const isBank = inv.type === 'bank';
  const hasCurrentPrice = inv.current_price && inv.current_price > 0;
  const currentPrice = hasCurrentPrice ? inv.current_price : (inv.purchase_price || 0);
  const totalValue = isBank ? inv.quantity : (currentPrice * inv.quantity * (inv.type === 'stock' ? 100 : 1));
  const totalCost = isBank ? inv.quantity : (inv.purchase_price * inv.quantity * (inv.type === 'stock' ? 100 : 1));
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? ((pnl / totalCost) * 100).toFixed(1) : 0;
  const isUp = pnl >= 0;

  return (
    <div className="bg-card/60 border border-border/50 rounded-xl p-4 hover:border-border transition-all group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TYPE_COLORS[inv.type]}`}>
              {TYPE_LABELS[inv.type]}
            </span>
            {inv.symbol && <span className="text-xs text-muted-foreground">{inv.symbol.toUpperCase()}</span>}
          </div>
          <h3 className="font-semibold text-sm truncate">{inv.name}</h3>
          {inv.type === 'tcg' && (inv.tcg_game || inv.tcg_edition) && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {[inv.tcg_game?.replace('_', ' '), inv.tcg_edition].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(inv)}>
            <Pencil className="w-3 h-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(inv.id)}>
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        {/* Current value */}
        <div className="flex justify-between items-baseline">
          <span className="text-lg font-bold">{fmt(totalValue)}</span>
          {!isBank && (
            <div className={`flex items-center gap-1 text-sm font-medium ${isUp ? 'text-green-400' : 'text-red-400'}`}>
              {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {isUp ? '+' : ''}{pnlPct}%
            </div>
          )}
        </div>

        {/* Price breakdown */}
        {!isBank && (
          <div className="grid grid-cols-2 gap-x-3 text-xs">
            <div>
              <span className="text-muted-foreground">Buy price</span>
              <p className="font-medium">{fmt(inv.purchase_price || 0)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Now</span>
              <p className={`font-medium ${hasCurrentPrice ? (isUp ? 'text-green-400' : 'text-red-400') : 'text-muted-foreground'}`}>
                {hasCurrentPrice ? fmt(inv.current_price) : '—'}
              </p>
            </div>
          </div>
        )}

        {!isBank && (
          <div className="text-xs text-muted-foreground">
            {inv.type === 'stock' ? `${inv.quantity} lots` : `${inv.quantity} units`} ·{' '}
            <span className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
              {pnl >= 0 ? '+' : ''}{fmt(Math.abs(pnl))} P&L
            </span>
          </div>
        )}
        {isBank && <div className="text-xs text-muted-foreground">Cash / Savings</div>}
        {inv.last_updated && (
          <div className="text-xs text-muted-foreground/50">
            Updated {new Date(inv.last_updated).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}