import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, X, Pencil, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ProjectCategory } from '@/lib/project-categories-api';

const COLORS = ['violet', 'blue', 'emerald', 'amber', 'rose', 'cyan', 'orange', 'pink'];

const COLOR_DOT_CLASSES = {
  violet: 'bg-violet-400',
  blue: 'bg-blue-400',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  cyan: 'bg-cyan-400',
  orange: 'bg-orange-400',
  pink: 'bg-pink-400',
};

const COLOR_CLASSES = {
  violet: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  emerald: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  amber: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  rose: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  cyan: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  orange: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  pink: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

function CategoryRow({ cat, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.name);
  const [icon, setIcon] = useState(cat.icon || '📁');
  const [color, setColor] = useState(cat.color || 'violet');
  const [newSub, setNewSub] = useState('');
  const [subs, setSubs] = useState(cat.subcategories || []);

  const save = async () => {
    await ProjectCategory.update(cat.id, { name, icon, color, subcategories: subs });
    onUpdate();
    setEditing(false);
    toast.success('Category updated');
  };

  const addSub = () => {
    if (!newSub.trim()) return;
    setSubs(s => [...s, newSub.trim()]);
    setNewSub('');
  };

  const removeSub = (i) => setSubs(s => s.filter((_, idx) => idx !== i));

  return (
    <div className="rounded-xl border border-border/50 bg-secondary/20 p-3 space-y-2">
      <div className="flex items-center gap-2">
        {editing ? (
          <>
            <input value={icon} onChange={e => setIcon(e.target.value)} className="w-10 text-center bg-secondary/50 border border-border rounded-lg p-1 text-base" />
            <input value={name} onChange={e => setName(e.target.value)} className="flex-1 bg-secondary/50 border border-border rounded-lg px-2 py-1 text-sm focus:outline-none" />
            <button onClick={save} className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
              <Check className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <>
            <span className="text-base">{cat.icon || '📁'}</span>
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', COLOR_CLASSES[cat.color] || COLOR_CLASSES.violet)}>
              {cat.name}
            </span>
            <button onClick={() => setEditing(true)} className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onDelete(cat.id)} className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {editing && (
        <div className="flex flex-wrap gap-1.5 pl-1">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={cn('w-5 h-5 rounded-full border-2 transition-all', COLOR_DOT_CLASSES[c],
                color === c ? 'border-white scale-110' : 'border-transparent opacity-60'
              )} />
          ))}
        </div>
      )}

      {/* Subcategories */}
      <div className="pl-1 space-y-1">
        {(editing ? subs : cat.subcategories || []).map((sub, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
            <span className="text-xs text-muted-foreground flex-1">{sub}</span>
            {editing && (
              <button onClick={() => removeSub(i)} className="text-muted-foreground hover:text-red-400">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}

        {editing && (
          <div className="flex gap-1.5 mt-1.5">
            <Input
              value={newSub}
              onChange={e => setNewSub(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSub()}
              placeholder="Add subcategory..."
              className="h-7 text-xs bg-secondary/40"
            />
            <Button size="sm" variant="outline" onClick={addSub} className="h-7 px-2">
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CategoryManagerModal({ open, onClose }) {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('📁');
  const [newColor, setNewColor] = useState('violet');

  const { data: categories = [] } = useQuery({
    queryKey: ['project-categories'],
    queryFn: () => ProjectCategory.list('sort_order', 50),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['project-categories'] });

  const createMutation = useMutation({
    mutationFn: () => ProjectCategory.create({
      name: newName.trim(), icon: newIcon, color: newColor, subcategories: [], sort_order: categories.length
    }),
    onSuccess: () => { refresh(); setNewName(''); setNewIcon('📁'); toast.success('Category created'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => ProjectCategory.delete(id),
    onSuccess: refresh,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
        </DialogHeader>

        <div className="space-y-2 mb-4">
          {categories.map(cat => (
            <CategoryRow key={cat.id} cat={cat} onUpdate={refresh} onDelete={(id) => deleteMutation.mutate(id)} />
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No categories yet.</p>
          )}
        </div>

        {/* Add new */}
        <div className="border-t border-border/50 pt-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">New Category</p>
          <div className="flex gap-2">
            <input value={newIcon} onChange={e => setNewIcon(e.target.value)} className="w-10 text-center bg-secondary/50 border border-border rounded-lg p-1.5 text-base" />
            <Input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && newName.trim() && createMutation.mutate()} placeholder="Category name..." className="flex-1" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map(c => (
              <button key={c} onClick={() => setNewColor(c)}
                className={cn('w-5 h-5 rounded-full border-2 transition-all', COLOR_DOT_CLASSES[c],
                  newColor === c ? 'border-white scale-110' : 'border-transparent opacity-60'
                )} />
            ))}
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!newName.trim()} className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Create Category
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
