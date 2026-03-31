import React from 'react';
import { cn, formatUiLabel } from '@/lib/utils';
import { format } from 'date-fns';
import { getGenericCaptureStatusLabel, isGenericCaptureActive, isGenericCaptureFailed } from '@/lib/resource-capture';
import { useResourceImage } from '@/lib/drive-images';
import {
  Youtube, MessageSquare, Newspaper, GraduationCap, FileText, Globe, FileDown,
  ExternalLink, Star, Github, CheckSquare, Archive, ArchiveRestore, Clapperboard, Trash2, FolderOpen, AlertTriangle, RefreshCw
} from 'lucide-react';

const typeConfig = {
  youtube:        { icon: Youtube,       color: 'text-red-400',    bg: 'bg-red-500/10',    label: 'YouTube' },
  reddit:         { icon: MessageSquare, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Reddit' },
  article:        { icon: Newspaper,     color: 'text-sky-400',    bg: 'bg-sky-500/10',    label: 'Article' },
  website:        { icon: Globe,         color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   label: 'Website' },
  research_paper: { icon: GraduationCap, color: 'text-violet-400', bg: 'bg-violet-500/10', label: 'Paper' },
  pdf:            { icon: FileDown,      color: 'text-amber-400',  bg: 'bg-amber-500/10',  label: 'PDF' },
  note:           { icon: FileText,      color: 'text-emerald-400',bg: 'bg-emerald-500/10',label: 'Note' },
  github_repo:    { icon: Github,        color: 'text-white',      bg: 'bg-white/10',      label: 'GitHub' },
  instagram_reel: { icon: Clapperboard,  color: 'text-pink-300',   bg: 'bg-pink-500/10',   label: 'IG Reel' },
  instagram_post: { icon: Clapperboard,  color: 'text-pink-200',   bg: 'bg-pink-500/10',   label: 'IG Post' },
  instagram_carousel: { icon: Clapperboard, color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', label: 'IG Carousel' },
};

const GRADIENTS = [
  'from-violet-600/30 to-indigo-900/40',
  'from-cyan-600/30 to-slate-900/40',
  'from-rose-600/30 to-stone-900/40',
  'from-amber-600/30 to-stone-900/40',
  'from-emerald-600/30 to-teal-900/40',
  'from-sky-600/30 to-blue-900/40',
  'from-fuchsia-600/30 to-purple-900/40',
];

const STATUS_COLORS = {
  active: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  beta: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  deprecated: 'text-red-400 bg-red-500/10 border-red-500/20',
  unknown: '',
};

const CAPTURE_STATUS_COLORS = {
  queued: 'border-secondary/60 bg-secondary/50 text-muted-foreground',
  processing: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
  failed: 'border-red-500/20 bg-red-500/10 text-red-200',
  completed: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
};

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h);
}

function asText(value, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

function firstText(items) {
  if (!Array.isArray(items)) return '';
  for (const item of items) {
    if (typeof item === 'string' && item.trim()) return item.trim();
    if (typeof item === 'number') return String(item);
  }
  return '';
}

function FallbackPreview({ title, mainTopic, colorClass, url }) {
  const safeTitle = asText(title, '?');
  const safeTopic = asText(mainTopic);
  const grad = GRADIENTS[hashStr(safeTitle || 'x') % GRADIENTS.length];
  let domain = '';
  try { domain = new URL(url).hostname.replace('www.', ''); } catch {}
  const initials = ((domain || safeTitle || '?').split(/\s+|\./).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')) || '?';

  return (
    <div className={cn('w-full h-full bg-gradient-to-br flex flex-col items-center justify-center gap-2 p-4', grad)}>
      <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center">
        <span className={cn('text-base font-bold flex', colorClass)}>{initials}</span>
      </div>
      {safeTopic && (
        <span className="text-[10px] text-white/50 font-medium tracking-wide uppercase truncate max-w-[80%]">{safeTopic}</span>
      )}
    </div>
  );
}

function getPreviewItem(resource) {
  const keyPoint = firstText(resource.key_points);
  if (keyPoint) {
    return {
      label: 'Key Point',
      text: keyPoint,
    };
  }

  const actionablePoint = firstText(resource.actionable_points);
  if (actionablePoint) {
    return {
      label: 'Next Step',
      text: actionablePoint,
    };
  }

  const useCase = firstText(resource.use_cases);
  if (useCase) {
    return {
      label: 'Best Used For',
      text: useCase,
    };
  }

  const summary = asText(resource.summary);
  if (summary) {
    return {
      label: 'Summary',
      text: summary,
    };
  }

  return null;
}

export default function ResourceCard({
  resource,
  onClick,
  onArchiveToggle,
  onDelete,
  onRetry,
  onTagClick,
  areas,
  selectMode = false,
  selected = false,
  className,
  archiveLoading = false,
  retryLoading = false,
}) {
  const area = (areas || []).find(a => a.id === resource.area_id);
  const cfg = typeConfig[resource.resource_type] || typeConfig.website;
  const Icon = cfg.icon;
  const isGitHub = resource.resource_type === 'github_repo';
  const isInstagram = ['instagram_reel', 'instagram_carousel', 'instagram_post'].includes(resource.resource_type);
  const previewItem = getPreviewItem(resource);
  const ArchiveIcon = resource.is_archived ? ArchiveRestore : Archive;
  const archiveLabel = resource.is_archived ? 'Restore resource' : 'Archive resource';
  const safeTitle = asText(resource.instagram_display_title || resource.title, 'Untitled');
  const safeAuthor = asText(resource.author);
  const instagramAuthorHandle = asText(resource.instagram_author_handle);
  const instagramMediaTypeLabel = asText(resource.instagram_media_type_label || (resource.resource_type === 'instagram_reel' ? 'Reel' : resource.resource_type === 'instagram_carousel' ? 'Carousel' : 'Post'));
  const needsReview = resource.instagram_review_state === 'needs_review';
  const safeMainTopic = asText(resource.main_topic);
  const safeTags = Array.isArray(resource.tags) ? resource.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [];
  const safeThumbnail = typeof resource.thumbnail === 'string' && resource.thumbnail.trim() ? resource.thumbnail : '';
  const { imageUrl: displayThumbnail, onError: handleThumbnailError } = useResourceImage(resource);
  const driveUrl = resource.drive_folder_url || resource.drive_files?.[0]?.url || '';
  const showGenericCaptureStatus = !isInstagram && (isGenericCaptureActive(resource) || isGenericCaptureFailed(resource));
  const captureStatusLabel = getGenericCaptureStatusLabel(resource);
  const showRetryButton = Boolean(onRetry) && (
    (isInstagram && (resource.download_status !== 'uploaded' || !driveUrl))
    || showGenericCaptureStatus
  );
  return (
    <div
      onClick={() => onClick?.(resource)}
        className={cn(
          'relative rounded-2xl bg-card border border-border/50 overflow-hidden transition-all duration-300 group cursor-pointer hover:border-primary/30 hover:shadow-xl hover:-translate-y-1',
          selectMode && 'select-none',
          selected && 'ring-2 ring-primary border-primary/40',
        className,
      )}
    >
      {selectMode && (
        <div
          className={cn(
            'absolute top-2 right-2 z-10 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors',
            selected
              ? 'bg-primary border-primary text-white'
              : 'bg-black/40 border-white/40 text-transparent',
          )}
        >
          {selected && <CheckSquare className="w-3 h-3" />}
        </div>
      )}
      {!selectMode && onArchiveToggle && (
        <button
          type="button"
          aria-label={archiveLabel}
          title={archiveLabel}
          disabled={archiveLoading}
          onClick={(e) => {
            e.stopPropagation();
            onArchiveToggle(resource);
          }}
          className={cn(
            'absolute right-2 top-10 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/80 backdrop-blur-sm transition-all duration-200 opacity-0 group-hover:opacity-100',
            archiveLoading
              ? 'cursor-not-allowed opacity-60'
              : 'hover:bg-black/75 hover:text-white hover:scale-110'
          )}
        >
          <ArchiveIcon className="h-3.5 w-3.5" />
        </button>
      )}
      {!selectMode && onDelete && (
        <button
          type="button"
          aria-label="Delete resource"
          title="Delete resource"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm("Are you sure you want to completely delete this resource?")) {
              onDelete(resource.id);
            }
          }}
          className={cn(
            'absolute top-10 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-500/15 bg-black/55 text-red-400/80 backdrop-blur-sm transition-all duration-200 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-300 hover:scale-110',
            onArchiveToggle ? 'right-11' : 'right-2'
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <div className="relative h-36 overflow-hidden bg-secondary/30">
        {displayThumbnail ? (
          <img src={displayThumbnail} alt={safeTitle} onError={handleThumbnailError} className="w-full h-full object-cover" />
        ) : (
          <FallbackPreview title={safeTitle} mainTopic={safeMainTopic} colorClass={cfg.color} url={resource.url} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
        <div className={cn('absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium', cfg.bg, cfg.color)}>
          <Icon className="w-3 h-3" /> {isInstagram ? `IG ${instagramMediaTypeLabel}` : cfg.label}
        </div>
        {resource.resource_score > 0 && (
          <div className={cn(
            'absolute top-2 flex items-center gap-0.5 bg-black/60 text-amber-400 text-[10px] px-1.5 py-0.5 rounded-full font-semibold',
            'right-2',
          )}>
            <Star className="w-2.5 h-2.5 fill-amber-400" /> {resource.resource_score}
          </div>
        )}
        {/* Status badge for tools/GitHub */}
        {resource.status && resource.status !== 'unknown' && STATUS_COLORS[resource.status] && (
          <div className="absolute bottom-2 left-2">
            <span className={cn('text-[10px] tracking-widest font-semibold px-2 py-0.5 rounded-full border', STATUS_COLORS[resource.status])}>
              {formatUiLabel(resource.status)}
            </span>
          </div>
        )}
      </div>

      <div className="p-4">
        <h3 className="text-sm font-semibold line-clamp-2 group-hover:text-primary transition-colors">
          {safeTitle}
        </h3>

        {showGenericCaptureStatus && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cn(
              'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
              CAPTURE_STATUS_COLORS[resource.capture_status] || CAPTURE_STATUS_COLORS.queued,
            )}>
              {captureStatusLabel}
            </span>
            {resource.capture_status_message && (
              <span className="text-[10px] text-muted-foreground line-clamp-1">
                {resource.capture_status_message}
              </span>
            )}
          </div>
        )}

        {(safeAuthor || instagramAuthorHandle) && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {instagramAuthorHandle ? `@${instagramAuthorHandle}` : `by ${safeAuthor}`}
          </p>
        )}

        {isInstagram && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] rounded-full bg-fuchsia-500/10 px-1.5 py-0.5 text-fuchsia-100">
              {instagramMediaTypeLabel}
            </span>
            {resource.instagram_media_items?.length > 0 && (
              <span className="text-[10px] rounded-full bg-pink-500/10 px-1.5 py-0.5 text-pink-200">
                {resource.instagram_media_items.length} Media
              </span>
            )}
            {needsReview && (
              <span className="text-[10px] rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
                Needs Review
              </span>
            )}
            {driveUrl && (
              <a
                href={driveUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200 transition-colors hover:bg-emerald-500/20"
              >
                <FolderOpen className="h-3 w-3" />
                Open in Drive
              </a>
            )}
          </div>
        )}

        {/* GitHub stars */}
        {isGitHub && resource.github_stars != null && (
          <div className="flex items-center gap-1 mt-1.5">
            <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
            <span className="text-xs text-muted-foreground">{resource.github_stars.toLocaleString()} stars</span>
          </div>
        )}

        {previewItem && (
          <div className="mt-3 rounded-xl border border-border/40 bg-secondary/25 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {previewItem.label}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80 line-clamp-2">
              {previewItem.text}
            </p>
          </div>
        )}

        {resource.enrichment_warning && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <p className="text-[11px] leading-relaxed text-amber-100/90 line-clamp-2">
              {resource.enrichment_warning}
            </p>
          </div>
        )}

        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {area && (
            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-medium">
              <span>{area.icon}</span> {area.name}
            </span>
          )}
          {safeMainTopic && (
            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {safeMainTopic}
            </span>
          )}
          {resource.is_archived && (
            <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
              Archived
            </span>
          )}
        </div>

        {safeTags.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {safeTags.slice(0, 4).map(tag => (
              <button
                key={tag}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick?.(tag);
                }}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                #{tag}
              </button>
            ))}
            {safeTags.length > 4 && (
              <span className="text-[10px] text-muted-foreground">+{safeTags.length - 4}</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/30">
          <span className="text-[10px] text-muted-foreground">
            {resource.created_date ? format(new Date(resource.created_date), 'MMM d, yyyy') : ''}
          </span>
          <div className="flex items-center gap-1.5">
            {showRetryButton && (
              <button
                type="button"
                aria-label="Retry resource"
                title="Retry resource"
                disabled={retryLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  onRetry?.(resource);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3 w-3', retryLoading && 'animate-spin')} />
              </button>
            )}
            {resource.url && (
              <a href={resource.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-muted-foreground hover:text-primary transition-colors">
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
