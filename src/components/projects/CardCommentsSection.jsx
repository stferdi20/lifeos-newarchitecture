import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Pencil, Trash2, Send, Loader2, Clock3 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/lib/AuthContext';
import { ACTIVITY_TYPES } from './activityEvents';
import {
  createCardComment,
  listCardActivity,
  listCardComments,
  updateCardComment,
} from '@/lib/projects-api';

function getAuthorLabel(comment, user) {
  if (user?.id && comment.author_id === user.id) return user?.name || user?.email || 'You';
  if (comment.author_id) return `User ${String(comment.author_id).slice(0, 8)}`;
  return 'User';
}

function activityLabel(event) {
  switch (event.type) {
    case ACTIVITY_TYPES.cardMoved:
      return `moved card from ${event.metadata?.from || 'unknown'} to ${event.metadata?.to || 'unknown'}`;
    case ACTIVITY_TYPES.commentAdded:
      return 'added a comment';
    case ACTIVITY_TYPES.attachmentAdded:
      return `added attachment${event.metadata?.attachment_name ? `: ${event.metadata.attachment_name}` : ''}`;
    case ACTIVITY_TYPES.cardRenamed:
      return `renamed card${event.metadata?.to ? ` to "${event.metadata.to}"` : ''}`;
    default:
      return event.type;
  }
}

async function loadComments(cardId) {
  return listCardComments(cardId);
}

async function loadActivity(cardId) {
  return listCardActivity(cardId);
}

function safeDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date;
}

function RelativeDate({ value }) {
  const date = safeDate(value);
  if (!date) return <>just now</>;
  return <>{formatDistanceToNow(date, { addSuffix: true })}</>;
}

export default function CardCommentsSection({ cardId }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [commentsSupported, setCommentsSupported] = useState(true);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');

  const { data: comments = [] } = useQuery({
    queryKey: ['card-comments', cardId],
    enabled: !!cardId,
    queryFn: () => loadComments(cardId),
    initialData: [],
  });

  const { data: activities = [] } = useQuery({
    queryKey: ['card-activity', cardId],
    enabled: !!cardId,
    queryFn: () => loadActivity(cardId),
    initialData: [],
  });

  const activeComments = useMemo(() => comments.filter((comment) => !comment.is_deleted), [comments]);

  const createMutation = useMutation({
    mutationFn: async ({ tempId, body }) => {
      if (!commentsSupported) throw new Error('Comments are unavailable in this schema.');
      const created = await createCardComment(cardId, body);
      return { created, tempId };
    },
    onMutate: async ({ body, tempId }) => {
      await queryClient.cancelQueries({ queryKey: ['card-comments', cardId] });
      const prev = queryClient.getQueryData(['card-comments', cardId]);
      queryClient.setQueryData(['card-comments', cardId], (old = []) => [
        ...old,
        {
          id: tempId,
          card_id: cardId,
          author_id: user?.id || null,
          body,
          is_deleted: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          optimistic: true,
        },
      ]);
      setDraft('');
      return { prev, previousDraft: body };
    },
    onError: (_error, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['card-comments', cardId], context.prev);
      if (context?.previousDraft) setDraft(context.previousDraft);
    },
    onSuccess: ({ created, tempId }) => {
      queryClient.setQueryData(
        ['card-comments', cardId],
        (old = []) => old.map((comment) => (comment.id === tempId ? created : comment)),
      );
      queryClient.invalidateQueries({ queryKey: ['card-activity', cardId] });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['card-comments', cardId] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }) => updateCardComment(id, { body }),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: ['card-comments', cardId] });
      const prev = queryClient.getQueryData(['card-comments', cardId]);
      queryClient.setQueryData(
        ['card-comments', cardId],
        (old = []) => old.map((comment) => (comment.id === id ? { ...comment, body, updated_at: new Date().toISOString() } : comment)),
      );
      setEditingId(null);
      setEditingText('');
      return { prev };
    },
    onError: (_error, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['card-comments', cardId], context.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['card-comments', cardId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => updateCardComment(id, { is_deleted: true }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['card-comments', cardId] });
      const prev = queryClient.getQueryData(['card-comments', cardId]);
      queryClient.setQueryData(
        ['card-comments', cardId],
        (old = []) => old.map((comment) => (comment.id === id ? { ...comment, is_deleted: true } : comment)),
      );
      return { prev };
    },
    onError: (_error, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['card-comments', cardId], context.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['card-comments', cardId] }),
  });

  return (
    <div className="space-y-4 border-t border-border/50 pt-4">
      <div>
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-2">
          <MessageSquare className="w-3 h-3" /> Comments
        </label>
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Write a comment..."
            className="flex-1 bg-secondary/30 border border-border/50 rounded-lg px-3 py-2 text-sm min-h-[72px]"
            disabled={!commentsSupported}
          />
          <ButtonLike
            onClick={() => createMutation.mutate({ body: draft.trim(), tempId: `temp-${Date.now()}` })}
            disabled={!commentsSupported || !draft.trim() || createMutation.isPending}
            title="Add comment"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </ButtonLike>
        </div>
        {!commentsSupported && (
          <p className="text-xs text-amber-400 mt-2">
            Comments and activity are unavailable in this app schema yet.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {activeComments.map((comment) => {
          const canEdit = user?.id && user.id === comment.author_id;
          return (
            <div key={comment.id} className="rounded-lg border border-border/40 bg-secondary/20 p-2.5">
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-muted-foreground">
                  {getAuthorLabel(comment, user)} · <RelativeDate value={comment.created_at || comment.created_date} />
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <button className="p-1 rounded hover:bg-secondary/60" onClick={() => { setEditingId(comment.id); setEditingText(comment.body || ''); }}>
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button className="p-1 rounded hover:bg-red-500/10 text-red-400" onClick={() => deleteMutation.mutate(comment.id)}>
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
              {editingId === comment.id ? (
                <div className="space-y-1.5">
                  <textarea
                    value={editingText}
                    onChange={(event) => setEditingText(event.target.value)}
                    className="w-full bg-secondary/30 border border-border/50 rounded-lg px-2 py-1.5 text-sm min-h-[64px]"
                  />
                  <div className="flex gap-2 justify-end">
                    <button className="text-xs text-muted-foreground" onClick={() => { setEditingId(null); setEditingText(''); }}>Cancel</button>
                    <button
                      className="text-xs px-2 py-1 rounded bg-primary text-white"
                      onClick={() => updateMutation.mutate({ id: comment.id, body: editingText.trim() })}
                      disabled={!editingText.trim()}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
              )}
            </div>
          );
        })}
        {!activeComments.length && <p className="text-xs text-muted-foreground/60">No comments yet.</p>}
      </div>

      <div className="pt-2 border-t border-border/30">
        <label className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1 mb-2">
          <Clock3 className="w-3 h-3" /> Activity
        </label>
        <div className="space-y-1.5">
          {activities.map((event) => (
            <div key={event.id} className="text-xs text-muted-foreground bg-secondary/20 rounded-md px-2 py-1.5">
              {activityLabel(event)} · <RelativeDate value={event.created_at || event.created_date} />
            </div>
          ))}
          {!activities.length && <p className="text-xs text-muted-foreground/60">No activity yet.</p>}
        </div>
      </div>
    </div>
  );
}

function ButtonLike({ children, ...props }) {
  return <button className="px-3 rounded-lg bg-primary text-white disabled:opacity-50" {...props}>{children}</button>;
}
