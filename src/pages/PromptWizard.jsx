import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wand2, Plus, Search, Database } from 'lucide-react';
import { PromptTemplate } from '@/lib/prompt-templates-api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

import PromptCard from '../components/prompts/PromptCard';
import PromptBuilder from '../components/prompts/PromptBuilder';
import ContextPicker from '../components/prompts/ContextPicker';
import NaturalLanguageBar from '../components/prompts/NaturalLanguageBar';
import { PageHeader, PageActionRow } from '@/components/layout/page-header';

const categories = ['all', 'writing', 'coding', 'research', 'brainstorming', 'summarizing', 'analysis', 'creative', 'other'];

export default function PromptWizard() {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [showContext, setShowContext] = useState(false);

  const queryClient = useQueryClient();

  const { data: templates = [] } = useQuery({
    queryKey: ['promptTemplates'],
    queryFn: () => PromptTemplate.list('-created_date', 100),
  });

  const createMutation = useMutation({
    mutationFn: (data) => PromptTemplate.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
      setShowBuilder(false);
      setEditingTemplate(null);
      toast.success('Template saved!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => PromptTemplate.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
      setShowBuilder(false);
      setEditingTemplate(null);
      toast.success('Template updated!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => PromptTemplate.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
      toast.success('Deleted');
    },
  });

  const handleSave = (formData) => {
    if (editingTemplate?.id) {
      updateMutation.mutate({ id: editingTemplate.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleSelect = (template) => {
    setEditingTemplate(template);
    setShowBuilder(true);
  };

  const handleCopy = (template) => {
    const text = template.full_prompt || template.task || '';
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard!');
    // Increment use count
    PromptTemplate.update(template.id, { use_count: (template.use_count || 0) + 1 });
    queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
  };

  const handlePin = (template) => {
    PromptTemplate.update(template.id, { pinned: !template.pinned });
    queryClient.invalidateQueries({ queryKey: ['promptTemplates'] });
  };

  const handleDelete = (template) => {
    deleteMutation.mutate(template.id);
  };

  const handleContextInsert = (contextText) => {
    setShowContext(false);
    const currentContext = editingTemplate?.context || '';
    const newContext = currentContext ? `${currentContext}\n\n---\n\n${contextText}` : contextText;
    setEditingTemplate(prev => ({ ...prev, context: newContext }));
    if (!showBuilder) {
      setShowBuilder(true);
    }
  };

  // Filter & sort
  const filtered = templates
    .filter(t => catFilter === 'all' || t.category === catFilter)
    .filter(t => {
      const q = search.toLowerCase();
      return !q || t.title?.toLowerCase().includes(q) || t.task?.toLowerCase().includes(q) || t.tags?.some(tag => tag.includes(q));
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Wand2}
        title="Prompt Wizard"
        description="Build, save, and reuse your best AI prompts"
        actions={(
          <PageActionRow>
            <Button
              variant="outline"
              onClick={() => setShowContext(!showContext)}
              className="gap-2 w-full sm:w-auto"
            >
              <Database className="w-4 h-4" />
              Pull Context
            </Button>
            <Button
              onClick={() => { setEditingTemplate(null); setShowBuilder(true); }}
              className="bg-violet-600 hover:bg-violet-700 gap-2 w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" />
              New Prompt
            </Button>
          </PageActionRow>
        )}
      />

      {/* Natural Language Input */}
      <NaturalLanguageBar onGenerated={(data) => {
        setEditingTemplate(data);
        setShowBuilder(true);
      }} />

      {/* Context Picker */}
      {showContext && (
        <ContextPicker
          onInsert={handleContextInsert}
          onClose={() => setShowContext(false)}
        />
      )}

      {/* Builder */}
      {showBuilder && (
        <PromptBuilder
          template={editingTemplate}
          onSave={handleSave}
          onClose={() => { setShowBuilder(false); setEditingTemplate(null); }}
        />
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="pl-10 bg-secondary/50 border-border/50"
          />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-full bg-secondary/50 border-border/50 sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map(c => (
              <SelectItem key={c} value={c} className="capitalize">
                {c === 'all' ? 'All Categories' : c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Template Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Wand2 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {templates.length === 0
              ? "No prompt templates yet. Create your first one!"
              : "No templates match your search."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(t => (
            <PromptCard
              key={t.id}
              template={t}
              onSelect={handleSelect}
              onCopy={handleCopy}
              onPin={handlePin}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
