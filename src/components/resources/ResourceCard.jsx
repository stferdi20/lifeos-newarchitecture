import React, { useEffect, useState } from 'react';
import { recordResourceProfileImageLoad } from '@/lib/resource-profile';
import { cn, formatUiLabel } from '@/lib/utils';
import { format } from 'date-fns';
import { getGenericCaptureStatusLabel, isGenericCaptureActive, isGenericCaptureFailed } from '@/lib/resource-capture';
import { useResourceImage } from '@/lib/drive-images';
import {
  Youtube, MessageSquare, Newspaper, GraduationCap, FileText, Globe, FileDown,
  ExternalLink, Star, Github, CheckSquare, Archive, ArchiveRestore, Clapperboard, Trash2, FolderOpen, AlertTriangle, RefreshCw
} from 'lucide-react';

const typeConfig = {
  youtube:        { icon: Youtube,       color: 'text-red-400',    bg: 'bg-red-500/10',    label: 'YouTube', tintRgb: '239, 68, 68' },
  reddit:         { icon: MessageSquare, color: 'text-orange-400', bg: 'bg-orange-500/10', label: 'Reddit', tintRgb: '249, 115, 22' },
  article:        { icon: Newspaper,     color: 'text-sky-400',    bg: 'bg-sky-500/10',    label: 'Article', tintRgb: '56, 189, 248' },
  website:        { icon: Globe,         color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   label: 'Website', tintRgb: '34, 211, 238' },
  research_paper: { icon: GraduationCap, color: 'text-violet-400', bg: 'bg-violet-500/10', label: 'Paper', tintRgb: '167, 139, 250' },
  pdf:            { icon: FileDown,      color: 'text-amber-400',  bg: 'bg-amber-500/10',  label: 'PDF', tintRgb: '251, 191, 36' },
  note:           { icon: FileText,      color: 'text-emerald-400',bg: 'bg-emerald-500/10',label: 'Note', tintRgb: '52, 211, 153' },
  github_repo:    { icon: Github,        color: 'text-white',      bg: 'bg-white/10',      label: 'GitHub', tintRgb: '229, 231, 235' },
  instagram_reel: { icon: Clapperboard,  color: 'text-pink-300',   bg: 'bg-pink-500/10',   label: 'IG Reel', tintRgb: '244, 114, 182' },
  instagram_post: { icon: Clapperboard,  color: 'text-pink-200',   bg: 'bg-pink-500/10',   label: 'IG Post', tintRgb: '251, 182, 206' },
  instagram_carousel: { icon: Clapperboard, color: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', label: 'IG Carousel', tintRgb: '232, 121, 249' },
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

const CARD_TYPOGRAPHY = {
  title: 'font-semibold tracking-tight text-[15px] leading-tight',
  titleCompact: 'text-[13px] leading-tight',
  meta: 'text-[10px] text-muted-foreground/80',
  metaCompact: 'text-[9px]',
  eyebrow: 'text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55',
  eyebrowCompact: 'text-[9px] tracking-[0.12em]',
  badge: 'text-[10px] font-medium',
  badgeCompact: 'text-[9px]',
  stat: 'text-[10px] font-semibold',
  statCompact: 'text-[9px]',
  previewLabel: 'text-[10px] font-semibold uppercase tracking-wider text-foreground/65',
  previewLabelCompact: 'text-[9px]',
  previewBody: 'text-[12px] leading-6 text-foreground/85',
  previewBodyCompact: 'text-[11px] leading-5',
  warning: 'text-[11px] leading-relaxed text-amber-100/80',
  warningCompact: 'text-[10px] leading-5',
  footer: 'text-[10px] tracking-[0.16em] text-muted-foreground/80 uppercase',
  footerCompact: 'text-[9px] tracking-[0.12em]',
  quietFooter: 'text-[10px] tracking-[0.16em] text-muted-foreground/60 uppercase',
  quietFooterCompact: 'text-[9px] tracking-[0.12em]',
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

function getFallbackAspectRatio(resource = {}) {
  const resourceType = resource.resource_type;
  if (resourceType === 'youtube') return 16 / 9;
  if (resourceType === 'research_paper' || resourceType === 'pdf') return 3 / 4;
  if (resourceType === 'github_repo') return 16 / 10;
  if (resourceType === 'instagram_reel' || resourceType === 'instagram_carousel') return 4 / 5;
  if (resourceType === 'instagram_post') return 1;
  if (resourceType === 'note') return 4 / 5;
  return 4 / 3;
}

function getPreviewClamp(layoutMode, textLength, tagCount) {
  if (layoutMode === 'grid') return 2;
  if (textLength > 220 || tagCount > 5) return 5;
  if (textLength > 160 || tagCount > 3) return 4;
  return 3;
}

function clampClassFromCount(lineCount) {
  if (lineCount >= 5) return 'line-clamp-5';
  if (lineCount === 4) return 'line-clamp-4';
  if (lineCount === 3) return 'line-clamp-3';
  return 'line-clamp-2';
}

function truncateText(value, maxLength = 180) {
  const text = asText(value).trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function getMediaAspectClass({
  layoutMode,
  resource,
  hasThumbnail,
  thumbnailAspectRatio,
  previewTextLength,
  tagCount,
  featured = false,
}) {
  if (layoutMode === 'grid') return 'h-36';

  const fallbackAspect = getFallbackAspectRatio(resource);
  const aspectRatio = thumbnailAspectRatio || fallbackAspect;
  const isPortrait = aspectRatio < 0.95;
  const isWide = aspectRatio > 1.35;
  const isDense = previewTextLength > 160 || tagCount > 4;

  if (resource.resource_type === 'youtube') {
    return isWide ? 'aspect-[16/9]' : 'aspect-[4/3]';
  }

  if (resource.resource_type === 'instagram_reel') {
    return 'aspect-[3/4]';
  }

  if (resource.resource_type === 'instagram_carousel') {
    return 'aspect-[4/5]';
  }

  if (resource.resource_type === 'instagram_post') {
    return isPortrait ? 'aspect-[3/4]' : 'aspect-square';
  }

  if (resource.resource_type === 'research_paper' || resource.resource_type === 'pdf') {
    return isPortrait ? 'aspect-[3/4]' : 'aspect-[4/5]';
  }

  if (resource.resource_type === 'github_repo') {
    return isWide ? 'aspect-[16/10]' : 'aspect-[4/3]';
  }

  if (!hasThumbnail) {
    if (layoutMode === 'gallery' && featured) return 'aspect-[4/5]';
    return isDense ? 'aspect-[4/5]' : 'aspect-[16/10]';
  }

  if (layoutMode === 'gallery' && featured) {
    if (isPortrait) return 'aspect-[4/5]';
    if (isWide) return 'aspect-[16/10]';
    return 'aspect-[5/4]';
  }

  if (isPortrait) return 'aspect-[3/4]';
  if (isWide) return 'aspect-[16/10]';
  return 'aspect-[4/3]';
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
      <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
        <span className={cn('text-base font-bold flex', colorClass)}>{initials}</span>
      </div>
      {safeTopic && (
        <span className={cn(CARD_TYPOGRAPHY.badge, 'text-white/50 uppercase tracking-wide truncate max-w-[80%]')}>
          {safeTopic}
        </span>
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

function getCardChrome({ layoutMode, tintRgb, featured = false }) {
  const tint = tintRgb || '125, 211, 252';
  if (layoutMode === 'gallery') {
    return {
      surface: 'rgba(18, 22, 31, 0.9)',
      borderGradient: featured
        ? `linear-gradient(135deg, rgba(${tint}, 0.38), rgba(255, 255, 255, 0.16) 38%, rgba(${tint}, 0.18) 72%, rgba(${tint}, 0.28) 100%)`
        : `linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(${tint}, 0.22) 38%, rgba(${tint}, 0.14) 72%, rgba(${tint}, 0.2) 100%)`,
      boxShadow: featured
        ? `0 24px 58px -30px rgba(15, 23, 42, 0.72), 0 0 0 1px rgba(255,255,255,0.04), 0 0 36px rgba(${tint}, 0.12)`
        : `0 18px 40px -28px rgba(15, 23, 42, 0.62), 0 0 0 1px rgba(255,255,255,0.03), 0 0 28px rgba(${tint}, 0.08)`,
      innerGlow: featured
        ? `radial-gradient(circle at top left, rgba(${tint}, 0.16), transparent 42%), radial-gradient(circle at 82% 12%, rgba(255,255,255,0.06), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.03), rgba(${tint}, 0.05) 46%, rgba(0,0,0,0) 100%)`
        : `radial-gradient(circle at top left, rgba(${tint}, 0.11), transparent 40%), radial-gradient(circle at 84% 10%, rgba(255,255,255,0.05), transparent 26%), linear-gradient(180deg, rgba(255,255,255,0.025), rgba(${tint}, 0.035) 42%, rgba(0,0,0,0) 100%)`,
      highlightBorder: `linear-gradient(180deg, rgba(255,255,255,0.12), rgba(${tint}, 0.1) 36%, rgba(255,255,255,0.02) 100%)`,
    };
  }

  if (layoutMode === 'magazine') {
    return {
      surface: 'rgba(20, 23, 30, 0.94)',
      borderGradient: `linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(${tint}, 0.1) 46%, rgba(${tint}, 0.08) 100%)`,
      boxShadow: `0 8px 22px -22px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(255,255,255,0.02), 0 0 18px rgba(${tint}, 0.05)`,
      innerGlow: `radial-gradient(circle at top left, rgba(${tint}, 0.08), transparent 40%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(${tint}, 0.025) 40%, rgba(0,0,0,0) 100%)`,
      highlightBorder: `linear-gradient(180deg, rgba(255,255,255,0.08), rgba(${tint}, 0.06) 38%, rgba(255,255,255,0.015) 100%)`,
    };
  }

  return {
    surface: 'rgba(24, 28, 37, 0.96)',
    borderGradient: `linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(${tint}, 0.12) 52%, rgba(${tint}, 0.1) 100%)`,
    boxShadow: `0 10px 26px -24px rgba(15, 23, 42, 0.32), 0 0 0 1px rgba(${tint}, 0.08)`,
    innerGlow: `radial-gradient(circle at top left, rgba(${tint}, 0.06), transparent 38%), linear-gradient(180deg, rgba(255,255,255,0.018), rgba(${tint}, 0.02) 40%, rgba(0,0,0,0) 100%)`,
    highlightBorder: `linear-gradient(180deg, rgba(255,255,255,0.07), rgba(${tint}, 0.05) 38%, rgba(255,255,255,0.01) 100%)`,
  };
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
  layoutMode = 'grid',
  gridDensity = 'normal',
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
  const { imageUrl: displayThumbnail, onError: handleThumbnailError } = useResourceImage(resource);
  const driveUrl = resource.drive_folder_url || resource.drive_files?.[0]?.url || '';
  const showGenericCaptureStatus = !isInstagram && (isGenericCaptureActive(resource) || isGenericCaptureFailed(resource));
  const captureStatusLabel = getGenericCaptureStatusLabel(resource);
  const [thumbnailAspectRatio, setThumbnailAspectRatio] = useState(null);
  const showRetryButton = Boolean(onRetry) && (
    (isInstagram && (resource.download_status !== 'uploaded' || !driveUrl))
    || showGenericCaptureStatus
  );
  const previewItemTextLength = previewItem?.text?.length || 0;
  const previewLineClamp = getPreviewClamp(layoutMode, previewItemTextLength, safeTags.length);
  const previewClampClass = clampClassFromCount(previewLineClamp);
  const isGrid = layoutMode === 'grid';
  const isGallery = layoutMode === 'gallery';
  const isMagazine = layoutMode === 'magazine';
  const isCompactDensity = gridDensity === 'compact';
  const isCompactGrid = isGrid && isCompactDensity;
  const isCompactCard = isCompactDensity;
  const isCompactGallery = false;
  const isCompactMagazine = false;
  const isFreeflow = !isGrid;
  const isFeatured = isGallery && (resource.resource_score >= 8 || ['youtube', 'instagram_reel', 'instagram_carousel'].includes(resource.resource_type));
  const bodySpacingClass = isGallery
    ? (isCompactGallery ? 'space-y-2' : (previewItemTextLength > 180 ? 'space-y-3' : 'space-y-2.5'))
    : isMagazine
      ? (isCompactMagazine ? 'space-y-2.5' : 'space-y-3')
      : '';
  const magazineSummary = truncateText(
    previewItem?.text
      || resource.summary
      || resource.why_it_matters
      || resource.explanation_for_newbies
      || resource.who_its_for,
    170,
  );
  const galleryTags = safeTags.slice(0, isFeatured ? 5 : 4);
  const galleryTagOverflow = safeTags.length - galleryTags.length;
  const mediaAspectClass = getMediaAspectClass({
    layoutMode,
    resource,
    hasThumbnail: Boolean(displayThumbnail),
    thumbnailAspectRatio,
    previewTextLength: previewItemTextLength,
    tagCount: safeTags.length,
    featured: isFeatured,
  });
  const mediaObjectPosition = isFreeflow && thumbnailAspectRatio && thumbnailAspectRatio < 1
    ? 'center top'
    : 'center center';
  const chrome = getCardChrome({ layoutMode, tintRgb: cfg.tintRgb, featured: isFeatured });
  const cardClassName = cn(
    'relative rounded-2xl overflow-hidden transition-all duration-300 group cursor-pointer isolate',
    isGrid && 'bg-card border border-border/50',
    isGallery && 'rounded-[1.85rem] hover:-translate-y-2',
    isCompactGallery && 'rounded-[1.55rem] shadow-[0_12px_28px_-24px_rgba(15,23,42,0.52)] hover:-translate-y-1',
    isMagazine && 'rounded-[1.45rem] hover:-translate-y-0.5',
    isCompactMagazine && 'rounded-[1.2rem]',
    isCompactGrid && 'rounded-xl',
    selectMode && 'select-none',
    selected && 'ring-2 ring-primary border-primary/40',
    isFeatured && 'ring-1 ring-white/10',
    className,
  );
  const cardStyle = isGrid
    ? {
        background: `linear-gradient(180deg, rgba(255,255,255,0.015), rgba(${cfg.tintRgb || '148, 163, 184'}, 0.03) 42%, rgba(24, 28, 37, 0.98) 100%)`,
        borderColor: `rgba(${cfg.tintRgb || '148, 163, 184'}, 0.24)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 26px -24px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(${cfg.tintRgb || '148, 163, 184'}, 0.05)`,
      }
    : {
        background: `linear-gradient(${chrome.surface}, ${chrome.surface}) padding-box, ${chrome.borderGradient} border-box`,
        boxShadow: chrome.boxShadow,
      };

  useEffect(() => {
    setThumbnailAspectRatio(null);
  }, [displayThumbnail, resource.id]);

  const handleThumbnailLoad = (event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget || {};
    if (!naturalWidth || !naturalHeight) return;
    setThumbnailAspectRatio(naturalWidth / naturalHeight);
    recordResourceProfileImageLoad({
      resourceId: resource.id,
      resourceType: resource.resource_type,
      width: naturalWidth,
      height: naturalHeight,
      layoutMode,
    });
  };

  return (
    <div
      onClick={() => onClick?.(resource)}
      className={cardClassName}
      style={cardStyle}
    >
      {!isGrid && (
        <>
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 rounded-[inherit] opacity-100 transition-opacity duration-300',
              isMagazine && 'opacity-70',
              isGallery && 'opacity-100',
              selected && 'opacity-40',
            )}
            style={{
              background: chrome.innerGlow,
            }}
          />
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-px rounded-[inherit] border border-white/[0.035]',
              isGallery && 'border-white/[0.05]',
              isMagazine && 'border-white/[0.03]',
              selected && 'border-transparent',
            )}
            style={{
              background: chrome.highlightBorder,
              maskImage: 'linear-gradient(180deg, black, transparent 72%)',
              WebkitMaskImage: 'linear-gradient(180deg, black, transparent 72%)',
            }}
          />
        </>
      )}
      {isGrid && !selected && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-100"
            style={{
              background: `radial-gradient(circle at top left, rgba(${cfg.tintRgb || '148, 163, 184'}, 0.08), transparent 34%), linear-gradient(180deg, rgba(255,255,255,0.018), rgba(${cfg.tintRgb || '148, 163, 184'}, 0.025) 36%, rgba(0,0,0,0) 100%)`,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-px rounded-[inherit]"
            style={{
              background: `linear-gradient(180deg, rgba(255,255,255,0.08), rgba(${cfg.tintRgb || '148, 163, 184'}, 0.05) 34%, rgba(255,255,255,0.01) 100%)`,
              maskImage: 'linear-gradient(180deg, black, transparent 72%)',
              WebkitMaskImage: 'linear-gradient(180deg, black, transparent 72%)',
            }}
          />
        </>
      )}
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
            'absolute right-2 top-10 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white/80 transition-all duration-200 opacity-0 group-hover:opacity-100',
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
            'absolute top-10 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-red-500/15 bg-black/70 text-red-400/80 transition-all duration-200 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:text-red-300 hover:scale-110',
            onArchiveToggle ? 'right-11' : 'right-2'
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <div className={cn(
        'relative overflow-hidden bg-secondary/30',
        mediaAspectClass,
        isCompactGrid && 'h-28',
        isCompactGallery && 'aspect-[4/5]',
        isCompactMagazine && 'aspect-[16/10]',
        isGallery && 'border-b border-white/5',
        isMagazine && 'border-b border-white/5 opacity-[0.98]',
      )}>
        {displayThumbnail ? (
          <img
            src={displayThumbnail}
            alt={safeTitle}
            onLoad={handleThumbnailLoad}
            onError={handleThumbnailError}
            className="w-full h-full object-cover"
            style={{ objectPosition: mediaObjectPosition }}
          />
        ) : (
          <FallbackPreview title={safeTitle} mainTopic={safeMainTopic} colorClass={cfg.color} url={resource.url} />
        )}
        <div className={cn(
          'absolute inset-0 pointer-events-none',
          isGallery && 'bg-gradient-to-t from-black/70 via-black/20 to-transparent',
          isMagazine && 'bg-gradient-to-t from-black/45 via-black/15 to-transparent',
          isGrid && 'bg-gradient-to-t from-black/60 to-transparent',
        )} />
        <div className={cn(
          'absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full',
          CARD_TYPOGRAPHY.badge,
          isCompactCard && 'gap-0.5 px-1.5',
          isCompactCard && CARD_TYPOGRAPHY.badgeCompact,
          cfg.bg,
          cfg.color,
          isGallery && 'shadow-md shadow-black/20 px-2.5 py-1',
          isMagazine && 'opacity-80',
        )}>
          <Icon className="w-3 h-3" /> {isInstagram ? `IG ${instagramMediaTypeLabel}` : cfg.label}
        </div>
        {resource.resource_score > 0 && (
          <div className={cn(
            'absolute top-2 flex items-center gap-0.5 bg-black/60 text-amber-400 px-1.5 py-0.5 rounded-full',
            CARD_TYPOGRAPHY.stat,
            isCompactCard && 'px-1 py-0.5',
            isCompactCard && CARD_TYPOGRAPHY.statCompact,
            'right-2',
            isGallery && 'bg-black/70 shadow-md shadow-black/20',
            isMagazine && 'bg-black/45 text-amber-300',
          )}>
            <Star className="w-2.5 h-2.5 fill-amber-400" /> {resource.resource_score}
          </div>
        )}
        {/* Status badge for tools/GitHub */}
        {resource.status && resource.status !== 'unknown' && STATUS_COLORS[resource.status] && (
          <div className="absolute bottom-2 left-2">
            <span className={cn(
              'px-2 py-0.5 rounded-full border',
              CARD_TYPOGRAPHY.stat,
              STATUS_COLORS[resource.status],
              isGallery && 'bg-black/40',
              isMagazine && 'opacity-80',
            )}>
              {formatUiLabel(resource.status)}
            </span>
          </div>
        )}
      </div>

      {isMagazine ? (
        <div className={cn('p-3.5', isCompactMagazine && 'p-3', bodySpacingClass)}>
          <div className={cn('space-y-1.5', isCompactMagazine && 'space-y-1')}>
            <div className={cn('flex items-center gap-2', CARD_TYPOGRAPHY.eyebrow, isCompactCard && 'gap-1.5', isCompactCard && CARD_TYPOGRAPHY.eyebrowCompact)}>
              <span>{isInstagram ? `IG ${instagramMediaTypeLabel}` : cfg.label}</span>
              {area && <span>{area.name}</span>}
              {resource.is_archived && <span>Archived</span>}
            </div>
            <h3 className={cn('line-clamp-2 text-foreground/90 group-hover:text-foreground', CARD_TYPOGRAPHY.title, isCompactCard && CARD_TYPOGRAPHY.titleCompact)}>
              {safeTitle}
            </h3>
            {(safeAuthor || instagramAuthorHandle) && (
              <p className={cn('text-muted-foreground/70', CARD_TYPOGRAPHY.meta, isCompactCard && CARD_TYPOGRAPHY.metaCompact)}>
                {instagramAuthorHandle ? `@${instagramAuthorHandle}` : `by ${safeAuthor}`}
              </p>
            )}
          </div>

          {showGenericCaptureStatus && (
            <div className={cn('flex items-center gap-2 text-muted-foreground/65', CARD_TYPOGRAPHY.meta, isCompactCard && 'gap-1.5', isCompactCard && CARD_TYPOGRAPHY.metaCompact)}>
              <span className={cn(
                'inline-flex items-center rounded-full border px-1.5 py-0.5 tracking-wide',
                CARD_TYPOGRAPHY.badge,
                isCompactCard && 'px-1 py-0.5',
                isCompactCard && CARD_TYPOGRAPHY.badgeCompact,
                CAPTURE_STATUS_COLORS[resource.capture_status] || CAPTURE_STATUS_COLORS.queued,
              )}>
                {captureStatusLabel}
              </span>
              {resource.capture_status_message && (
                <span className="line-clamp-1">{resource.capture_status_message}</span>
              )}
            </div>
          )}

          {magazineSummary && (
            <p className={cn('line-clamp-3 text-foreground/68', CARD_TYPOGRAPHY.previewBody, isCompactCard && CARD_TYPOGRAPHY.previewBodyCompact)}>
              {magazineSummary}
            </p>
          )}

          {resource.enrichment_warning && (
            <div className={cn('flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-2.5 py-2', isCompactMagazine && 'gap-1.5 px-2 py-1.5')}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <p className={cn('line-clamp-2', CARD_TYPOGRAPHY.warning, isCompactCard && CARD_TYPOGRAPHY.warningCompact)}>
                {resource.enrichment_warning}
              </p>
            </div>
          )}

          <div className={cn('flex items-center justify-between border-t border-border/20 pt-2', isCompactMagazine && 'pt-1.5')}>
            <div className={cn('flex items-center gap-2', CARD_TYPOGRAPHY.quietFooter, isCompactCard && 'gap-1.5', isCompactCard && CARD_TYPOGRAPHY.quietFooterCompact)}>
              <span>{resource.created_date ? format(new Date(resource.created_date), 'MMM d, yyyy') : ''}</span>
              {isGitHub && resource.github_stars != null && (
                <span>{resource.github_stars.toLocaleString()} stars</span>
              )}
            </div>
            <div className={cn('flex items-center gap-1.5', isCompactMagazine && 'gap-1')}>
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
                  className={cn('inline-flex h-5 w-5 items-center justify-center rounded-md border border-border/60 text-muted-foreground/60 transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60', isCompactMagazine && 'h-[18px] w-[18px]')}
                >
                  <RefreshCw className={cn('h-3 w-3', retryLoading && 'animate-spin')} />
                </button>
              )}
              {resource.url && (
                <a href={resource.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-muted-foreground/60 hover:text-primary transition-colors">
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className={cn('p-4', isCompactGrid && 'p-3 space-y-2.5', isCompactGallery && 'p-3.5', bodySpacingClass)}>
          <h3 className={cn(
            'group-hover:text-primary transition-colors line-clamp-3',
            CARD_TYPOGRAPHY.title,
            isCompactCard && CARD_TYPOGRAPHY.titleCompact,
          )}>
            {safeTitle}
          </h3>

          {showGenericCaptureStatus && (
            <div className={cn('flex flex-wrap items-center gap-1.5', isCompactCard && 'gap-1')}>
              <span className={cn(
                'inline-flex items-center rounded-full border px-1.5 py-0.5 tracking-wide',
                CARD_TYPOGRAPHY.badge,
                isCompactCard && 'px-1 py-0.5',
                isCompactCard && CARD_TYPOGRAPHY.badgeCompact,
                CAPTURE_STATUS_COLORS[resource.capture_status] || CAPTURE_STATUS_COLORS.queued,
              )}>
                {captureStatusLabel}
              </span>
              {resource.capture_status_message && (
                <span className={cn('line-clamp-1 text-muted-foreground', CARD_TYPOGRAPHY.meta, isCompactCard && CARD_TYPOGRAPHY.metaCompact)}>
                  {resource.capture_status_message}
                </span>
              )}
            </div>
          )}

          {(safeAuthor || instagramAuthorHandle) && (
            <p className={cn(CARD_TYPOGRAPHY.meta, isCompactCard && CARD_TYPOGRAPHY.metaCompact)}>
              {instagramAuthorHandle ? `@${instagramAuthorHandle}` : `by ${safeAuthor}`}
            </p>
          )}

          {isInstagram && (
            <div className={cn('flex flex-wrap items-center gap-1.5', isCompactCard && 'gap-1')}>
              <span className={cn('rounded-full bg-fuchsia-500/10 px-1.5 py-0.5 text-fuchsia-100/90', CARD_TYPOGRAPHY.badge, isCompactCard && 'px-1 py-0.5', isCompactCard && CARD_TYPOGRAPHY.badgeCompact)}>
                {instagramMediaTypeLabel}
              </span>
              {resource.instagram_media_items?.length > 0 && (
                <span className={cn('rounded-full bg-pink-500/10 px-1.5 py-0.5 text-pink-200/90', CARD_TYPOGRAPHY.badge, isCompactCard && 'px-1 py-0.5', isCompactCard && CARD_TYPOGRAPHY.badgeCompact)}>
                  {resource.instagram_media_items.length} Media
                </span>
              )}
              {needsReview && (
                <span className={cn('rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-200/90', CARD_TYPOGRAPHY.badge, isCompactCard && 'px-1 py-0.5', isCompactCard && CARD_TYPOGRAPHY.badgeCompact)}>
                  Needs Review
                </span>
              )}
              {driveUrl && (
                <a
                  href={driveUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200 transition-colors hover:bg-emerald-500/20',
                    CARD_TYPOGRAPHY.badge,
                    isCompactCard && 'px-1 py-0.5',
                    isCompactCard && CARD_TYPOGRAPHY.badgeCompact,
                  )}
                >
                  <FolderOpen className="h-3 w-3" />
                  Open in Drive
                </a>
              )}
            </div>
          )}

          {isGitHub && resource.github_stars != null && (
            <div className={cn('flex items-center gap-1', isCompactCard && 'gap-0.5')}>
              <Star className="h-3 w-3 fill-amber-400/90 text-amber-400" />
              <span className={cn(CARD_TYPOGRAPHY.stat, 'text-muted-foreground/80', isCompactCard && CARD_TYPOGRAPHY.statCompact)}>
                {resource.github_stars.toLocaleString()} stars
              </span>
            </div>
          )}

          {previewItem && (
            <div className={cn(
              'rounded-xl border border-border/40 bg-card/60 px-3 py-2.5 shadow-sm shadow-black/10',
              isCompactCard && 'px-2.5 py-2',
              isFeatured && 'bg-card/70',
            )}>
              <p className={cn(CARD_TYPOGRAPHY.previewLabel, isCompactCard && CARD_TYPOGRAPHY.previewLabelCompact)}>
                {previewItem.label}
              </p>
              <p className={cn(
                'mt-1.5',
                isCompactCard && 'mt-1',
                CARD_TYPOGRAPHY.previewBody,
                isCompactCard && CARD_TYPOGRAPHY.previewBodyCompact,
                previewClampClass,
              )}>
                {previewItem.text}
              </p>
            </div>
          )}

          {resource.enrichment_warning && (
            <div className={cn('flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2', isCompactCard && 'gap-1.5 px-2.5 py-1.5')}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
              <p className={cn('line-clamp-2', CARD_TYPOGRAPHY.warning, isCompactCard && CARD_TYPOGRAPHY.warningCompact)}>
                {resource.enrichment_warning}
              </p>
            </div>
          )}

          <div className={cn('flex items-center gap-1 flex-wrap', isCompactCard && 'gap-0.5')}>
            {area && (
              <span className={cn('inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-violet-400/80', CARD_TYPOGRAPHY.badge, isCompactCard && 'px-1 py-0.5', isCompactCard && CARD_TYPOGRAPHY.badgeCompact)}>
                <span>{area.icon}</span> {area.name}
              </span>
            )}
            {safeMainTopic && (
              <span className={cn('inline-block rounded-full bg-primary/10 px-1.5 py-0.5 text-primary/80', CARD_TYPOGRAPHY.badge, isCompactCard && 'px-1 py-0.5', isCompactCard && CARD_TYPOGRAPHY.badgeCompact)}>
                {safeMainTopic}
              </span>
            )}
            {resource.is_archived && (
              <span className={cn('inline-block rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-400/80', CARD_TYPOGRAPHY.badge, isCompactCard && 'px-1 py-0.5', isCompactCard && CARD_TYPOGRAPHY.badgeCompact)}>
                Archived
              </span>
            )}
          </div>

          {galleryTags.length > 0 && (
            <div className={cn('flex items-center gap-1.5 flex-wrap', isCompactCard && 'gap-1')}>
              {galleryTags.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTagClick?.(tag);
                  }}
                  className={cn(
                    'rounded-full bg-secondary/80 px-1.5 py-0.5 text-muted-foreground/80 transition-colors hover:bg-primary/10 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/50',
                    CARD_TYPOGRAPHY.badge,
                    isCompactCard && 'px-1 py-0.5',
                    isCompactCard && CARD_TYPOGRAPHY.badgeCompact,
                  )}
                >
                  #{tag}
                </button>
              ))}
              {galleryTagOverflow > 0 && (
                <span className={cn('text-muted-foreground', CARD_TYPOGRAPHY.badge, isCompactCard && CARD_TYPOGRAPHY.badgeCompact)}>+{galleryTagOverflow}</span>
              )}
            </div>
          )}

          <div className={cn('flex items-center justify-between border-t border-border/30 pt-2', isCompactCard && 'pt-1.5')}>
            <span className={cn(
              CARD_TYPOGRAPHY.footer,
              isCompactCard && CARD_TYPOGRAPHY.footerCompact,
              isFeatured && 'text-foreground/65',
            )}>
              {resource.created_date ? format(new Date(resource.created_date), 'MMM d, yyyy') : ''}
            </span>
            <div className={cn('flex items-center gap-1.5', isCompactCard && 'gap-1')}>
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
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-md border border-border/60 text-muted-foreground/70 transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-60',
                    isCompactCard && 'h-5 w-5',
                  )}
                >
                  <RefreshCw className={cn('h-3 w-3', retryLoading && 'animate-spin')} />
                </button>
              )}
              {resource.url && (
                <a href={resource.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-muted-foreground/70 hover:text-primary transition-colors">
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
