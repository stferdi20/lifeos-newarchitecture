import React, { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Wand2, Save, Copy, X, ChevronDown, ChevronUp, Sparkles, Loader2, Braces, MessageSquarePlus, Upload, FileText, Link as LinkIcon } from 'lucide-react';
import { generateStructuredAi } from '@/lib/ai-api';
import { createSignedUpload, signStoredFile } from '@/lib/projects-api';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

const categories = ['writing', 'coding', 'research', 'brainstorming', 'summarizing', 'analysis', 'creative', 'other'];
const SAMPLE_FILE_ACCEPT = '.txt,.md,.markdown,.pdf,.rtf,.doc,.docx,text/plain,text/markdown,application/pdf,application/rtf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const normalizeSampleFiles = (files) => (
  Array.isArray(files)
    ? files.filter(Boolean).map(file => ({
        name: file.name || 'Untitled file',
        url: file.url || file.file_url || file.fileUrl || '',
        type: file.type || file.mimeType || '',
        size: file.size || 0,
      }))
    : []
);

const formatFileSize = (size) => {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export default function PromptBuilder({ template, onSave, onClose }) {
  const [form, setForm] = useState({
    title: '',
    category: 'other',
    role: '',
    context: '',
    task: '',
    output_format: '',
    examples: '',
    json_schema: '',
    sample_input_files: [],
    sample_output_files: [],
    tags: [],
    ...template,
  });
  const [tagInput, setTagInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(!!form.role || !!form.examples);
  const [showJson, setShowJson] = useState(!!form.json_schema);
  const [generatingContext, setGeneratingContext] = useState(false);
  const [uploadingSampleType, setUploadingSampleType] = useState('');
  const sampleInputRef = useRef(null);
  const sampleOutputRef = useRef(null);

  const sampleInputFiles = normalizeSampleFiles(form.sample_input_files);
  const sampleOutputFiles = normalizeSampleFiles(form.sample_output_files);
  const sampleInputSection = sampleInputFiles.length
    ? `Sample input files:\n${sampleInputFiles.map(file => `- ${file.name}${file.url ? ` (${file.url})` : ''}`).join('\n')}`
    : '';
  const sampleOutputSection = sampleOutputFiles.length
    ? `Sample output files:\n${sampleOutputFiles.map(file => `- ${file.name}${file.url ? ` (${file.url})` : ''}`).join('\n')}`
    : '';

  const assembledPrompt = [
    form.role && `${form.role}`,
    form.context && `Context: ${form.context}`,
    form.task,
    form.output_format && `Output format: ${form.output_format}`,
    form.json_schema && `Respond with valid JSON matching this schema:\n${form.json_schema}`,
    sampleInputSection,
    sampleOutputSection,
    form.examples && `Examples:\n${form.examples}`,
  ].filter(Boolean).join('\n\n');

  const generateContextSuggestions = async () => {
    if (!form.task.trim()) return;
    setGeneratingContext(true);
    const prompt = `You are a prompt engineering expert. Given this AI prompt task, suggest helpful context that would improve the prompt's output quality. Think about what background info, constraints, audience, tone, or domain knowledge would help.

Task: ${form.task}
Role: ${form.role || 'Not specified'}
Category: ${form.category}

Provide a rich, detailed context paragraph that the user can use or edit. Include relevant constraints, assumptions, and domain specifics.

Return JSON with "suggested_context" and "tips".`;
    const result = await generateStructuredAi({
      taskType: 'generic.structured',
      prompt,
      policy: { tier: 'standard', maxTokens: 1000, temperature: 0.2 },
      metadata: { requestSummary: `prompt-context:${form.title || form.task.slice(0, 60)}` },
    });
    setGeneratingContext(false);
    const existing = form.context ? form.context + '\n\n' : '';
    update('context', existing + result.suggested_context);
  };

  const generateJsonSchema = async () => {
    if (!form.task.trim()) return;
    setGeneratingContext(true);
    const prompt = `Given this AI prompt task, generate a JSON schema that would be appropriate for the structured output.

Task: ${form.task}
Output format hint: ${form.output_format || 'Not specified'}

Return a clean, valid JSON schema object (type: "object" with properties). Keep it practical and relevant.

Return JSON with a single "schema" object field.`;
    const result = await generateStructuredAi({
      taskType: 'generic.structured',
      prompt,
      policy: { tier: 'standard', maxTokens: 1000, temperature: 0.2 },
      metadata: { requestSummary: `prompt-schema:${form.title || form.task.slice(0, 60)}` },
    });
    setGeneratingContext(false);
    update('json_schema', JSON.stringify(result.schema, null, 2));
  };

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const uploadSampleFiles = async (files, field) => {
    const uploadList = Array.from(files || []).filter(Boolean);
    if (!uploadList.length) return;

    setUploadingSampleType(field);
    try {
      const client = getSupabaseBrowserClient();
      if (!client) {
        throw new Error('Supabase browser client is not configured.');
      }

      const uploadedFiles = [];
      for (const file of uploadList) {
        const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
        const safeName = String(file.name || 'file')
          .replace(ext, '')
          .replace(/[^a-zA-Z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 80) || 'file';
        const uploadPath = `prompt-samples/${field}/${Date.now()}-${safeName}${ext}`;
        const { upload, bucket } = await createSignedUpload(uploadPath);
        const { error } = await client.storage.from(bucket).uploadToSignedUrl(upload.path, upload.token, file);
        if (error) throw error;
        const url = await signStoredFile(bucket, upload.path, 60 * 60 * 24 * 365);

        uploadedFiles.push({
          name: file.name,
          url: url || '',
          type: file.type,
          size: file.size,
        });
      }

      update(field, [...normalizeSampleFiles(form[field]), ...uploadedFiles]);
    } finally {
      setUploadingSampleType('');
    }
  };

  const removeSampleFile = (field, fileName) => {
    update(field, normalizeSampleFiles(form[field]).filter(file => file.name !== fileName));
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (tag && !form.tags.includes(tag)) {
      update('tags', [...form.tags, tag]);
    }
    setTagInput('');
  };

  const [generatingTags, setGeneratingTags] = useState(false);

  const autoGenerateTags = async (data) => {
    setGeneratingTags(true);
    const prompt = `Given this AI prompt template, generate 3-5 relevant lowercase tags for categorization and search.

Title: ${data.title}
Category: ${data.category}
Task: ${data.task}
Role: ${data.role || 'N/A'}
Context: ${data.context || 'N/A'}

Return JSON with a single "tags" array.`;
    const result = await generateStructuredAi({
      taskType: 'generic.structured',
      prompt,
      policy: { tier: 'cheap', maxTokens: 400, temperature: 0.1 },
      metadata: { requestSummary: `prompt-tags:${data.title || data.task.slice(0, 60)}` },
    });
    setGeneratingTags(false);
    return result.tags || [];
  };

  const handleSave = async () => {
    let finalTags = form.tags;
    if (finalTags.length === 0 && form.task.trim()) {
      finalTags = await autoGenerateTags(form);
    }
    onSave({ ...form, tags: finalTags, full_prompt: assembledPrompt });
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(assembledPrompt);
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-violet-400" />
          {template?.id ? 'Edit Prompt' : 'Build a Prompt'}
        </h2>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Title & Category */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Template Name</label>
          <Input
            value={form.title}
            onChange={e => update('title', e.target.value)}
            placeholder="e.g. Blog Post Outline Generator"
            className="bg-secondary/50 border-border/50"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Category</label>
          <Select value={form.category} onValueChange={v => update('category', v)}>
            <SelectTrigger className="bg-secondary/50 border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(c => (
                <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Task */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Task / Instruction *</label>
        <Textarea
          value={form.task}
          onChange={e => update('task', e.target.value)}
          placeholder="Describe what you want the AI to do..."
          className="bg-secondary/50 border-border/50 min-h-[80px]"
        />
      </div>

      {/* Context with AI helper */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-muted-foreground">Context (optional)</label>
          <button
            onClick={generateContextSuggestions}
            disabled={generatingContext || !form.task.trim()}
            className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors"
          >
            {generatingContext ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquarePlus className="w-3 h-3" />}
            AI Suggest Context
          </button>
        </div>
        <Textarea
          value={form.context}
          onChange={e => update('context', e.target.value)}
          placeholder="Background info, constraints, audience, tone, domain knowledge..."
          className="bg-secondary/50 border-border/50 min-h-[80px]"
        />
        <p className="text-[10px] text-muted-foreground/50 mt-1">Tip: Add audience, tone, constraints, and domain specifics to improve output quality</p>
      </div>

      {/* Output Format */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Output Format (optional)</label>
        <Input
          value={form.output_format}
          onChange={e => update('output_format', e.target.value)}
          placeholder="e.g. bullet points, JSON, markdown table, essay"
          className="bg-secondary/50 border-border/50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border/40 bg-secondary/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <label className="text-xs text-muted-foreground block">Sample Input Files</label>
              <p className="text-[10px] text-muted-foreground/60 mt-1">Attach examples like `txt`, `md`, or `pdf` to show the kind of input this prompt expects.</p>
            </div>
            <input
              ref={sampleInputRef}
              type="file"
              accept={SAMPLE_FILE_ACCEPT}
              multiple
              className="hidden"
              onChange={async (e) => {
                await uploadSampleFiles(e.target.files, 'sample_input_files');
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => sampleInputRef.current?.click()}
              disabled={uploadingSampleType === 'sample_input_files'}
              className="gap-1.5"
            >
              {uploadingSampleType === 'sample_input_files' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload
            </Button>
          </div>

          {sampleInputFiles.length > 0 ? (
            <div className="space-y-2">
              {sampleInputFiles.map(file => (
                <div key={`${file.name}-${file.url}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/40 px-3 py-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-violet-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">{file.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {[file.type, formatFileSize(file.size)].filter(Boolean).join(' • ') || 'Uploaded file'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {file.url && (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground"
                        title="Open file"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => removeSampleFile('sample_input_files', file.name)}
                      className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground"
                      title="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">No sample input files added yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-border/40 bg-secondary/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <label className="text-xs text-muted-foreground block">Sample Output Files</label>
              <p className="text-[10px] text-muted-foreground/60 mt-1">Attach examples of the output you want back, so the template keeps a concrete target format.</p>
            </div>
            <input
              ref={sampleOutputRef}
              type="file"
              accept={SAMPLE_FILE_ACCEPT}
              multiple
              className="hidden"
              onChange={async (e) => {
                await uploadSampleFiles(e.target.files, 'sample_output_files');
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => sampleOutputRef.current?.click()}
              disabled={uploadingSampleType === 'sample_output_files'}
              className="gap-1.5"
            >
              {uploadingSampleType === 'sample_output_files' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload
            </Button>
          </div>

          {sampleOutputFiles.length > 0 ? (
            <div className="space-y-2">
              {sampleOutputFiles.map(file => (
                <div key={`${file.name}-${file.url}`} className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-background/40 px-3 py-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-violet-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm truncate">{file.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {[file.type, formatFileSize(file.size)].filter(Boolean).join(' • ') || 'Uploaded file'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {file.url && (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground"
                        title="Open file"
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => removeSampleFile('sample_output_files', file.name)}
                      className="p-1.5 rounded-md hover:bg-white/10 text-muted-foreground hover:text-foreground"
                      title="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">No sample output files added yet.</p>
          )}
        </div>
      </div>

      {/* JSON Schema */}
      <div>
        <button
          onClick={() => setShowJson(!showJson)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
        >
          <Braces className="w-3.5 h-3.5" />
          {showJson ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          JSON Output Schema
        </button>
        {showJson && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground/60">Define the JSON structure for structured AI responses</p>
              <button
                onClick={generateJsonSchema}
                disabled={generatingContext || !form.task.trim()}
                className="flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300 disabled:opacity-40 transition-colors"
              >
                {generatingContext ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Auto-generate
              </button>
            </div>
            <Textarea
              value={form.json_schema}
              onChange={e => update('json_schema', e.target.value)}
              placeholder='{"type": "object", "properties": {"key": {"type": "string"}}}'
              className="bg-secondary/50 border-border/50 min-h-[100px] font-mono text-xs"
            />
          </div>
        )}
      </div>

      {/* Advanced */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        Advanced (Role & Examples)
      </button>

      {showAdvanced && (
        <div className="space-y-4 pt-1">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">AI Role / Persona</label>
            <Input
              value={form.role}
              onChange={e => update('role', e.target.value)}
              placeholder="e.g. You are an expert data analyst..."
              className="bg-secondary/50 border-border/50"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Examples</label>
            <Textarea
              value={form.examples}
              onChange={e => update('examples', e.target.value)}
              placeholder="Provide example input/output pairs..."
              className="bg-secondary/50 border-border/50 min-h-[60px]"
            />
          </div>
        </div>
      )}

      {/* Tags */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Tags</label>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addTag())}
            placeholder="Add a tag..."
            className="bg-secondary/50 border-border/50"
          />
          <Button variant="outline" size="sm" onClick={addTag}>Add</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              if (!form.task.trim()) return;
              const tags = await autoGenerateTags(form);
              update('tags', [...new Set([...form.tags, ...tags])]);
            }}
            disabled={generatingTags || !form.task.trim()}
            className="gap-1.5 text-violet-400 border-violet-500/30 hover:bg-violet-500/10"
          >
            {generatingTags ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Auto
          </Button>
        </div>
        {form.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {form.tags.map(tag => (
              <Badge key={tag} variant="outline" className="text-xs border-white/10 gap-1">
                {tag}
                <button onClick={() => update('tags', form.tags.filter(t => t !== tag))}>
                  <X className="w-2.5 h-2.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Preview */}
      {assembledPrompt.trim() && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Assembled Prompt Preview</label>
          <div className="rounded-lg bg-secondary/30 border border-border/30 p-3 text-sm text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto">
            {assembledPrompt}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={!form.title.trim() || !form.task.trim() || generatingTags} className="bg-violet-600 hover:bg-violet-700">
          <Save className="w-4 h-4 mr-2" /> Save Template
        </Button>
        <Button variant="outline" onClick={handleCopy} disabled={!assembledPrompt.trim()}>
          <Copy className="w-4 h-4 mr-2" /> Copy Prompt
        </Button>
      </div>
    </div>
  );
}
