import React from 'react';
import { Copy, Download, Image as ImageIcon, MoreHorizontal, Pencil, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getSnippetDisplayPreview, getSnippetDisplayTitle } from '@/lib/snippet-display';
import { cn } from '@/lib/utils';

function formatRelativeCopy(snippet) {
  if (!snippet?.last_copied_at) return 'Never copied';
  const timestamp = Date.parse(snippet.last_copied_at);
  if (!Number.isFinite(timestamp)) return 'Copied recently';
  const diffMs = Date.now() - timestamp;
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return 'Copied just now';
  if (diffHours < 24) return `Copied ${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `Copied ${diffDays}d ago`;
}

export default function SnippetCard({
  snippet,
  viewMode = 'grid',
  workspaceName,
  onCopy,
  onCopySecondary,
  onToggleFavorite,
  onEdit,
  onDelete,
}) {
  const isImage = snippet.snippet_type === 'image';
  const tagList = Array.isArray(snippet.tags) ? snippet.tags : [];
  const displayTitle = getSnippetDisplayTitle(snippet);
  const displayPreview = getSnippetDisplayPreview(snippet);

  return (
    <Card className={cn(
      'border-white/10 bg-white/[0.03] shadow-none transition hover:border-white/20 hover:bg-white/[0.05]',
      viewMode === 'list' && 'overflow-hidden'
    )}>
      <CardContent className={cn('p-4', viewMode === 'list' && 'flex flex-col gap-4 md:flex-row md:items-start md:justify-between')}>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
              {isImage ? <ImageIcon className="h-4 w-4 text-sky-300" /> : <Copy className="h-4 w-4 text-emerald-300" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start gap-2">
                <h3 className="min-w-0 flex-1 text-base font-semibold leading-tight text-foreground">{displayTitle}</h3>
                {snippet.is_favorite ? <Star className="h-4 w-4 fill-amber-300 text-amber-300" /> : null}
                <Badge variant="secondary" className="border-white/10 bg-white/[0.06] text-xs capitalize text-foreground/80">
                  {snippet.snippet_type}
                </Badge>
                {workspaceName ? (
                  <Badge variant="outline" className="border-white/10 bg-transparent text-xs text-foreground/70">
                    {workspaceName}
                  </Badge>
                ) : null}
              </div>

              <p className="mt-2 line-clamp-3 break-words text-sm text-muted-foreground">
                {displayPreview}
              </p>

              {isImage && snippet.image_url ? (
                <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  <img src={snippet.image_url} alt={displayTitle} className="h-44 w-full object-cover" />
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {tagList.map((tag) => (
                  <Badge key={tag} variant="outline" className="border-white/10 bg-transparent text-xs text-foreground/60">
                    {tag}
                  </Badge>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-foreground/50">
                <span>{formatRelativeCopy(snippet)}</span>
                <span>{snippet.copy_count || 0} copies</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 md:w-[220px] md:justify-end">
          <Button onClick={() => onCopy(snippet)} className="gap-2 md:min-w-[132px]">
            <Copy className="h-4 w-4" />
            {isImage ? 'Copy Image' : 'Copy Text'}
          </Button>

          {isImage ? (
            <Button type="button" variant="outline" className="gap-2 border-white/10 bg-transparent" onClick={() => onCopySecondary?.(snippet)}>
              <Download className="h-4 w-4" />
              Copy Link
            </Button>
          ) : null}

          <Button
            type="button"
            variant="outline"
            className="gap-2 border-white/10 bg-transparent"
            onClick={() => onToggleFavorite(snippet)}
          >
            <Star className={cn('h-4 w-4', snippet.is_favorite && 'fill-amber-300 text-amber-300')} />
            {snippet.is_favorite ? 'Favorited' : 'Favorite'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="border-white/10 bg-transparent">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(snippet)}>
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDelete(snippet)} className="text-red-300 focus:text-red-200">
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
