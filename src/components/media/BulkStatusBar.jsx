import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CheckSquare } from 'lucide-react';
import { getStatusOptions } from './mediaConfig';

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 10 }, (_, i) => currentYear - i);

export default function BulkStatusBar({ selectedIds, entries, onApply, onClear }) {
  const [newStatus, setNewStatus] = useState('completed');
  const [yearConsumed, setYearConsumed] = useState(String(currentYear));

  const selectedEntries = entries.filter(e => selectedIds.has(e.id));
  const firstType = selectedEntries[0]?.media_type || 'movie';
  const statusOptions = getStatusOptions(firstType);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border rounded-2xl shadow-2xl px-5 py-3">
      <CheckSquare className="w-4 h-4 text-primary" />
      <span className="text-sm font-medium">{selectedIds.size} selected</span>

      <Select value={newStatus} onValueChange={setNewStatus}>
        <SelectTrigger className="bg-secondary/40 border-border/50 h-8 text-xs w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map(o => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={yearConsumed} onValueChange={setYearConsumed}>
        <SelectTrigger className="bg-secondary/40 border-border/50 h-8 text-xs w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No year</SelectItem>
          {YEARS.map(y => (
            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button size="sm" onClick={() => onApply(newStatus, yearConsumed === 'none' ? null : parseInt(yearConsumed))} className="bg-primary text-white text-xs">
        Apply
      </Button>
      <button onClick={onClear} className="text-muted-foreground hover:text-foreground p-1">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}