import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2 } from 'lucide-react';

export function CardFormDialog({ open, onClose, task, onSave, onDelete }) {
  const [form, setForm] = useState({
    title: '', description: '', priority: 'medium', due_date: ''
  });

  useEffect(() => {
    if (task) {
      setForm({
        title: task.title || '',
        description: task.description || '',
        priority: task.priority || 'medium',
        due_date: task.due_date || '',
      });
    } else {
      setForm({ title: '', description: '', priority: 'medium', due_date: '' });
    }
  }, [task]);

  const handleSave = () => {
    if (!form.title.trim()) return;
    onSave({
      ...form,
      ...(task?.list_id ? { list_id: task.list_id } : {}),
      ...(task?.position !== undefined ? { position: task.position } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle>{task?.id ? 'Edit Card' : 'New Card'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Card title" className="bg-secondary/50 border-border" />
          <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description (optional)" className="bg-secondary/50 border-border h-20" />
          <div className="grid grid-cols-2 gap-3">
            <Select value={form.priority} onValueChange={v => setForm({ ...form, priority: v })}>
              <SelectTrigger className="bg-secondary/50 border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="bg-secondary/50 border-border" />
          </div>
          <div className="flex gap-2 pt-2">
            {task?.id && (
              <Button variant="ghost" onClick={() => onDelete(task.id)} className="text-red-400 hover:text-red-300 hover:bg-red-500/10">
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
            <Button onClick={handleSave} className="flex-1 bg-primary hover:bg-primary/90 text-white">
              {task?.id ? 'Save' : 'Create Card'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TaskFormDialog(props) {
  return <CardFormDialog {...props} />;
}

export default CardFormDialog;
