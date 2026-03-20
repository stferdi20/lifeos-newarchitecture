import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw } from 'lucide-react';
import { Investment, fetchInvestmentPrices } from '@/lib/investments-api';
import InvestmentCard from '@/components/investments/InvestmentCard';
import InvestmentFormModal from '@/components/investments/InvestmentFormModal';
import PortfolioSummary from '@/components/investments/PortfolioSummary';
import { PageHeader, PageActionRow } from '@/components/layout/page-header';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'stock', label: 'Stocks' },
  { key: 'crypto', label: 'Crypto' },
  { key: 'tcg', label: 'TCG' },
  { key: 'bank', label: 'Bank/Cash' },
];

export default function Investments() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();

  const { data: investments = [] } = useQuery({
    queryKey: ['investments'],
    queryFn: () => Investment.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => Investment.delete(id),
    onSuccess: () => qc.invalidateQueries(['investments']),
  });

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    const priceable = investments.filter(i =>
      ((i.type === 'stock' || i.type === 'crypto') && i.symbol) ||
      (i.type === 'tcg' && i.name)
    );
    if (priceable.length === 0) { setRefreshing(false); return; }

    const res = await fetchInvestmentPrices({ investments: priceable });
    const results = res?.results || [];

    for (const r of results) {
      if (r.price) {
        await Investment.update(r.id, {
          current_price: r.price,
          last_updated: new Date().toISOString(),
        });
      }
    }
    qc.invalidateQueries(['investments']);
    setRefreshing(false);
  };

  const handleSave = async (data) => {
    const saved = await (editing
      ? Investment.update(editing.id, { ...data, id: editing.id })
      : Investment.create(data));

    // Auto-fetch price for new stock/crypto/tcg, or if current_price is missing
    const needsPrice = (data.current_price == null || data.current_price === 0) && (
      ((data.type === 'stock' || data.type === 'crypto') && data.symbol) ||
      (data.type === 'tcg' && data.name)
    );
    if (needsPrice) {
      const res = await fetchInvestmentPrices({ investments: [{ ...saved, id: saved.id }] });
      const r = res?.results?.[0];
      if (r?.price) {
        await Investment.update(saved.id, { current_price: r.price, last_updated: new Date().toISOString() });
      }
    }
    qc.invalidateQueries(['investments']);
    setShowForm(false);
    setEditing(null);
  };

  const filtered = filter === 'all' ? investments : investments.filter(i => i.type === filter);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Investments"
        description="Track your portfolio across stocks, crypto, TCG & cash"
        actions={(
          <PageActionRow>
            <Button variant="outline" size="sm" onClick={handleRefreshPrices} disabled={refreshing} className="w-full sm:w-auto">
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Prices'}
            </Button>
            <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }} className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" />
            Add
            </Button>
          </PageActionRow>
        )}
      />

      {investments.length > 0 && <PortfolioSummary investments={investments} />}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}>
            {f.label}
            <span className="ml-1.5 text-xs opacity-60">
              {f.key === 'all' ? investments.length : investments.filter(i => i.type === f.key).length}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg mb-2">No investments yet</p>
          <p className="text-sm">Add your first investment to start tracking</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(inv => (
            <InvestmentCard key={inv.id} inv={inv}
              onEdit={(i) => { setEditing(i); setShowForm(true); }}
              onDelete={(id) => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}

      {showForm && (
        <InvestmentFormModal
          open={showForm}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
          existing={editing}
        />
      )}
    </div>
  );
}
