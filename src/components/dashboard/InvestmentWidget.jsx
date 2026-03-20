import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Investment } from '@/lib/investments-api';

function fmt(n) {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}M`;
  return `Rp ${n?.toLocaleString('id-ID') || 0}`;
}

const TYPE_COLORS = {
  stock: 'bg-blue-500',
  crypto: 'bg-orange-500',
  tcg: 'bg-purple-500',
  bank: 'bg-green-500',
};

export default function InvestmentWidget() {
  const { data: investments = [] } = useQuery({
    queryKey: ['investments'],
    queryFn: () => Investment.list(),
  });

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
  const pnl = totalValue - totalCost;
  const pnlPct = totalCost > 0 ? ((pnl / totalCost) * 100).toFixed(1) : 0;
  const isUp = pnl >= 0;

  const byType = ['stock', 'crypto', 'tcg', 'bank'].map(type => ({
    type,
    value: investments.filter(i => i.type === type).reduce((s, i) => s + getValue(i), 0),
  })).filter(t => t.value > 0);

  if (investments.length === 0) {
    return (
      <Link to="/Investments" className="block rounded-2xl bg-gradient-to-br from-[#0f1a14] via-card to-card border border-green-500/10 p-5 hover:border-green-500/25 hover:shadow-lg hover:shadow-green-500/5 transition-all duration-300">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Portfolio</span>
        </div>
        <p className="text-sm text-muted-foreground">No investments yet. Click to add.</p>
      </Link>
    );
  }

  return (
    <Link to="/Investments" className="block rounded-2xl bg-gradient-to-br from-[#0f1a14] via-card to-card border border-green-500/10 p-5 hover:border-green-500/25 hover:shadow-lg hover:shadow-green-500/5 transition-all duration-300">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Portfolio</span>
        </div>
        <div className={`flex items-center gap-1 text-xs font-semibold shrink-0 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
          {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {isUp ? '+' : ''}{pnlPct}%
        </div>
      </div>
      <p className="text-xl sm:text-2xl font-bold mb-3 break-words">{fmt(totalValue)}</p>
      <div className="flex rounded-full overflow-hidden h-1.5 gap-px mb-2">
        {byType.map(t => (
          <div key={t.type} className={TYPE_COLORS[t.type]}
            style={{ width: `${(t.value / totalValue * 100).toFixed(0)}%` }} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{investments.length} holdings</p>
    </Link>
  );
}
