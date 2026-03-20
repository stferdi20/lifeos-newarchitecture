import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Sheet, Presentation, Loader2, ChevronRight, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { addCardAttachmentMetadata, createGoogleWorkspaceDocument } from '@/lib/projects-api';

const FILE_TYPES = [
  { key: 'docs', label: 'Google Docs', icon: FileText, color: 'text-blue-400 bg-blue-500/10' },
  { key: 'sheets', label: 'Google Sheets', icon: Sheet, color: 'text-emerald-400 bg-emerald-500/10' },
  { key: 'slides', label: 'Google Slides', icon: Presentation, color: 'text-orange-400 bg-orange-500/10' },
];

const DOC_TEMPLATES = [
  { key: 'project_brief', label: 'Project Brief', desc: 'Objectives, scope & deliverables' },
  { key: 'meeting_notes', label: 'Meeting Notes', desc: 'Agenda, decisions & action items' },
  { key: 'research_doc', label: 'Research Document', desc: 'Findings, analysis & conclusions' },
  { key: 'task_plan', label: 'Task Plan', desc: 'Step-by-step execution plan' },
];

export default function CreateDocumentButton({ taskId, task, onCreated }) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const handleCreate = async (fileType, templateKey = null) => {
    if (creating) return; // Prevent double-click
    setCreating(true);
    setOpen(false);
    setSelectedType(null);
    try {
      const data = await createGoogleWorkspaceDocument({
        title: task?.title || 'Untitled',
        fileType,
        templateKey,
        card: task ? {
          id: task.id,
          title: task.title,
          description: task.description || '',
        } : undefined,
      });

      if (taskId && data?.url) {
        const result = await addCardAttachmentMetadata(taskId, {
          name: data.title,
          url: data.url,
          webViewLink: data.url,
          provider: data.provider || 'google_docs',
          file_type: fileType === 'docs' ? 'gdoc' : fileType === 'sheets' ? 'gsheet' : 'gslide',
        });
        onCreated?.(result?.card?.attached_files || []);
      }
      toast.success(`Created: ${data.title}`);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['cards'] });
      queryClient.invalidateQueries({ queryKey: ['google-connections'] });
      // Open the document in a new tab
      window.open(data.url, '_blank');
    } catch (error) {
      toast.error(error?.message || 'Failed to create document');
      console.error(error);
    } finally {
      setCreating(false);
    }
  };

  if (creating) {
    return (
      <div className="flex items-center gap-2 text-[10px] px-2 py-1 rounded-lg bg-violet-500/10 text-violet-400">
        <Loader2 className="w-3 h-3 animate-spin" />
        Creating...
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => { setOpen(!open); setSelectedType(null); }}
        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
      >
        <Sparkles className="w-3 h-3" />
        Create Doc
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-xl border border-border/50 bg-[#1a1d25] shadow-xl overflow-hidden">
          {!selectedType ? (
            // File type selection
            <div className="p-1.5">
              <p className="text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-widest">Create new</p>
              {FILE_TYPES.map(ft => {
                const Icon = ft.icon;
                return (
                  <button
                    key={ft.key}
                    onClick={() => {
                      if (ft.key === 'docs') {
                        setSelectedType('docs');
                      } else {
                        handleCreate(ft.key);
                      }
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-secondary/40 transition-colors text-left"
                  >
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', ft.color)}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-medium text-foreground flex-1">{ft.label}</span>
                    {ft.key === 'docs' && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          ) : (
            // Docs template selection
            <div className="p-1.5">
              <button
                onClick={() => setSelectedType(null)}
                className="text-[10px] text-muted-foreground px-2 py-1 uppercase tracking-widest hover:text-foreground transition-colors"
              >
                ← Choose template
              </button>
              {DOC_TEMPLATES.map(t => (
                <button
                  key={t.key}
                  onClick={() => handleCreate('docs', t.key)}
                  className="w-full flex flex-col px-2.5 py-2 rounded-lg hover:bg-secondary/40 transition-colors text-left"
                >
                  <span className="text-xs font-medium text-foreground">{t.label}</span>
                  <span className="text-[10px] text-muted-foreground">{t.desc}</span>
                </button>
              ))}
              <div className="border-t border-border/30 mt-1 pt-1">
                <button
                  onClick={() => handleCreate('docs')}
                  className="w-full flex flex-col px-2.5 py-2 rounded-lg hover:bg-secondary/40 transition-colors text-left"
                >
                  <span className="text-xs font-medium text-foreground">Empty Document</span>
                  <span className="text-[10px] text-muted-foreground">Just the title, no content</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
