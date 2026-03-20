import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import ReactMarkdown from 'react-markdown';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';

export default function ManualNoteModal({ open, onClose, onSave }) {
  const [form, setForm] = useState({ title: '', content: '', tags: [] });
  const [tagInput, setTagInput] = useState('');
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ title: '', content: '', tags: [] });
      setTagInput('');
      setPreview(false);
    }
  }, [open]);

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !form.tags.includes(tag)) {
      setForm({ ...form, tags: [...form.tags, tag] });
    }
    setTagInput('');
  };

  const handleSubmit = () => {
    onSave({
      title: form.title.trim(),
      content: form.content.trim(),
      tags: form.tags,
      resource_type: 'note',
      is_archived: false,
    });
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="bg-card border-border max-w-2xl max-h-[80vh] overflow-y-auto" mobileClassName="bg-card border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>New Note</ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <div className="space-y-3 px-4 pb-4 sm:px-0 sm:pb-0">
          <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title" className="bg-secondary/50 border-border text-lg font-medium" />

          <div className="flex gap-2">
            <button onClick={() => setPreview(false)} className={`text-xs px-3 py-1 rounded-lg ${!preview ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}>Edit</button>
            <button onClick={() => setPreview(true)} className={`text-xs px-3 py-1 rounded-lg ${preview ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}>Preview</button>
          </div>

          {!preview ? (
            <Textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="Write in markdown..." className="bg-secondary/50 border-border min-h-[200px] font-mono text-sm" />
          ) : (
            <div className="bg-secondary/30 rounded-lg p-4 min-h-[200px] prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{form.content || '*No content*'}</ReactMarkdown>
            </div>
          )}

          <div className="flex gap-2 items-center">
            <Input value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())} placeholder="Add tag..." className="bg-secondary/50 border-border flex-1" />
            <Button variant="outline" onClick={addTag} className="border-border">Add</Button>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {form.tags.map(tag => (
              <span key={tag} className="text-xs px-2 py-1 rounded-full bg-secondary text-foreground flex items-center gap-1">
                #{tag}
                <button onClick={() => setForm({ ...form, tags: form.tags.filter(t => t !== tag) })} className="text-muted-foreground hover:text-foreground">×</button>
              </span>
            ))}
          </div>

          <Button onClick={handleSubmit} disabled={!form.title.trim()} className="w-full">
            Create Note
          </Button>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
