import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Star, Trash2, Tag, Zap, Heart, Clock, Github, Archive, ArchiveRestore, Lightbulb, CheckCircle2, Quote, Users, BookOpen, MessageSquareText, ArrowUpCircle, MessagesSquare, Clapperboard, Download, FolderOpen } from 'lucide-react';
import { LifeArea, Resource } from '@/lib/resources-api';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';
import { ResponsiveModal, ResponsiveModalContent, ResponsiveModalHeader, ResponsiveModalTitle } from '@/components/ui/responsive-modal';

const STATUS_COLORS = {
  active: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  beta: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  deprecated: 'text-red-400 bg-red-500/10 border-red-500/20',
  unknown: 'text-muted-foreground bg-secondary border-border',
};

const CONTENT_SOURCE_LABELS = {
  youtube_transcript: 'Transcript',
  youtube_description: 'Video description',
  html_text: 'Page text',
  reddit_thread: 'Thread text',
  pdf_text: 'PDF text',
  metadata_only: 'Metadata only',
  instagram_caption: 'Instagram caption',
  instagram_caption_transcript: 'Caption + transcript',
};

const ENRICHMENT_STATUS_COLORS = {
  rich: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  partial: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  sparse: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  metadata_only: 'border-border/60 bg-secondary/50 text-muted-foreground',
};

function ResourceListSection({ title, icon: Icon, items = [], accentClass = 'text-violet-400', bulletClass = 'bg-violet-400/70' }) {
  if (!items.length) return null;

  return (
    <div>
      <p className={cn('mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground', accentClass)}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </p>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={`${title}-${i}`} className="flex items-start gap-2 text-sm text-foreground/80">
            <span className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', bulletClass)} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ResourceDetailModal({ open, onClose, resource }) {
  const queryClient = useQueryClient();
  const [areaId, setAreaId] = useState(resource?.area_id || '');
  const [isArchived, setIsArchived] = useState(resource?.is_archived || false);
  const [rating, setRating] = useState(resource?.user_rating || 0);
  const [liked, setLiked] = useState(false);

  const { data: areas = [] } = useQuery({
    queryKey: ['lifeAreas'],
    queryFn: () => LifeArea.list(),
  });

  if (!resource) return null;

  const isGitHub = resource.resource_type === 'github_repo';
  const isReddit = resource.resource_type === 'reddit';
  const isInstagram = resource.resource_type === 'instagram_reel' || resource.resource_type === 'instagram_carousel';
  const showDebugStatus = import.meta.env.DEV || (resource.enrichment_status && resource.enrichment_status !== 'rich');
  const redditCommentTakeaways = Array.isArray(resource.reddit_top_comment_summaries)
    ? resource.reddit_top_comment_summaries.filter(Boolean)
    : [];
  const instagramMediaItems = Array.isArray(resource.instagram_media_items)
    ? resource.instagram_media_items.filter(Boolean)
    : [];
  const derivedSubreddit = (() => {
    if (resource.reddit_subreddit) return resource.reddit_subreddit;
    const author = String(resource.author || '');
    const match = author.match(/r\/([A-Za-z0-9_]+)/);
    return match?.[1] || '';
  })();

  const handleAreaChange = async (value) => {
    setAreaId(value);
    await Resource.update(resource.id, { area_id: value });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
  };

  const handleArchiveToggle = async () => {
    const newVal = !isArchived;
    setIsArchived(newVal);
    await Resource.update(resource.id, { is_archived: newVal });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
  };

  const handleRate = async (star) => {
    setRating(star);
    await Resource.update(resource.id, { user_rating: star });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
  };

  const handleLike = async () => {
    if (liked) return;
    setLiked(true);
    await Resource.update(resource.id, { likes: (resource.likes || 0) + 1 });
    queryClient.invalidateQueries({ queryKey: ['resources'] });
  };

  const handleDelete = async () => {
    await Resource.delete(resource.id);
    queryClient.invalidateQueries({ queryKey: ['resources'] });
    onClose();
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onClose}>
      <ResponsiveModalContent className="bg-card border-border max-w-2xl max-h-[85vh] overflow-y-auto" mobileClassName="bg-card border-border">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2 pr-8">
            {isGitHub && <Github className="w-5 h-5 text-muted-foreground shrink-0" />}
            <span className="truncate">{resource.title}</span>
          </ResponsiveModalTitle>
        </ResponsiveModalHeader>

        <div className="space-y-4 px-4 pb-4 sm:px-0 sm:pb-0">
          {resource.thumbnail && (
            <img src={resource.thumbnail} alt={resource.title} className="w-full h-48 object-cover rounded-xl" />
          )}

          {/* Meta row */}
          <div className="flex items-center gap-3 flex-wrap">
            {resource.author && <span className="text-xs text-muted-foreground">by {resource.author}</span>}
            {resource.resource_score > 0 && (
              <span className="flex items-center gap-1 text-amber-400 text-xs font-semibold">
                <Star className="w-3 h-3 fill-amber-400" /> {resource.resource_score}/10
              </span>
            )}
            {resource.main_topic && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{resource.main_topic}</span>
            )}
            {resource.content_source && (
              <span className="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full border border-border/60 bg-secondary/50 text-muted-foreground">
                {CONTENT_SOURCE_LABELS[resource.content_source] || resource.content_source}
              </span>
            )}
            {resource.content_language && (
              <span className="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
                {resource.content_language}
              </span>
            )}
            {showDebugStatus && resource.enrichment_status && (
              <span className={cn(
                'text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full border',
                ENRICHMENT_STATUS_COLORS[resource.enrichment_status] || ENRICHMENT_STATUS_COLORS.metadata_only,
              )}>
                enrichment {resource.enrichment_status}
              </span>
            )}
            {showDebugStatus && resource.analysis_version && (
              <span className="text-[10px] font-mono tracking-wide text-muted-foreground">
                {resource.analysis_version}
              </span>
            )}
            {resource.status && resource.status !== 'unknown' && (
              <span className={cn('text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full border', STATUS_COLORS[resource.status])}>
                {resource.status}
              </span>
            )}
            {isGitHub && resource.github_stars != null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Star className="w-3 h-3 text-amber-400 fill-amber-400" /> {resource.github_stars.toLocaleString()} stars
              </span>
            )}
            {isGitHub && resource.last_commit_date && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" /> Last commit: {resource.last_commit_date.slice(0, 10)}
              </span>
            )}
            {isReddit && derivedSubreddit && (
              <span className="flex items-center gap-1 text-xs text-orange-300">
                <MessageSquareText className="w-3 h-3" /> r/{derivedSubreddit}
              </span>
            )}
            {isReddit && resource.reddit_post_score != null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowUpCircle className="w-3 h-3" /> {Number(resource.reddit_post_score).toLocaleString()} score
              </span>
            )}
            {isReddit && resource.reddit_comment_count != null && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MessagesSquare className="w-3 h-3" /> {Number(resource.reddit_comment_count).toLocaleString()} comments
              </span>
            )}
            {isReddit && resource.reddit_thread_type && (
              <span className="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full border border-orange-500/20 bg-orange-500/10 text-orange-300">
                {resource.reddit_thread_type}
              </span>
            )}
            {isInstagram && resource.ingestion_source && (
              <span className="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full border border-pink-500/20 bg-pink-500/10 text-pink-200">
                {resource.ingestion_source === 'official_api' ? 'official api' : 'extractor fallback'}
              </span>
            )}
            {isInstagram && resource.download_status && (
              <span className="text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full border border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-200">
                download {resource.download_status}
              </span>
            )}
            {resource.url && (
              <a href={resource.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1 ml-auto">
                <ExternalLink className="w-3 h-3" /> Source
              </a>
            )}
          </div>

          {/* Area + Archive */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select value={areaId || resource.area_id || ''} onValueChange={handleAreaChange}>
              <SelectTrigger className="h-8 w-full text-xs bg-secondary/50 border-border sm:w-44">
                <SelectValue placeholder="Assign area..." />
              </SelectTrigger>
              <SelectContent>
                {areas.map(a => (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="mr-1">{a.icon}</span> {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={handleArchiveToggle}
              className={cn('text-xs gap-1 border-border', isArchived ? 'text-amber-400' : 'text-muted-foreground')}
            >
              {isArchived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
              {isArchived ? 'Unarchive' : 'Archive'}
            </Button>
          </div>

          {/* Summary */}
          {resource.summary && (
            <div className="bg-secondary/30 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">AI Summary</p>
              <p className="text-sm text-foreground/80 leading-relaxed">{resource.summary}</p>
            </div>
          )}

          {resource.why_it_matters && (
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Why It Matters</p>
              <p className="text-sm leading-relaxed text-foreground/80">{resource.why_it_matters}</p>
            </div>
          )}

          {resource.who_its_for && (
            <div className="rounded-xl border border-sky-500/15 bg-sky-500/5 p-4">
              <p className="mb-2 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                <Users className="w-3.5 h-3.5" /> Who It's For
              </p>
              <p className="text-sm leading-relaxed text-foreground/80">{resource.who_its_for}</p>
            </div>
          )}

          {/* Beginner Explanation (tools/GitHub) */}
          {resource.explanation_for_newbies && (
            <div className="bg-violet-500/5 border border-violet-500/10 rounded-xl p-4">
              <p className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold mb-2">Explained Simply</p>
              <p className="text-sm text-foreground/80 leading-relaxed">{resource.explanation_for_newbies}</p>
            </div>
          )}

          {isInstagram && (
            <div className="rounded-xl border border-pink-500/15 bg-pink-500/5 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-pink-200">
                  <Clapperboard className="h-3.5 w-3.5" /> Instagram Metadata
                </p>
                {resource.instagram_author_handle && (
                  <span className="text-xs text-muted-foreground">@{resource.instagram_author_handle}</span>
                )}
                {instagramMediaItems.length > 0 && (
                  <span className="text-xs text-muted-foreground">{instagramMediaItems.length} media item{instagramMediaItems.length === 1 ? '' : 's'}</span>
                )}
              </div>

              {resource.instagram_caption && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Caption</p>
                  <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{resource.instagram_caption}</p>
                </div>
              )}

              {resource.instagram_transcript && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Transcript</p>
                  <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">{resource.instagram_transcript}</p>
                </div>
              )}

              {!resource.instagram_transcript && resource.ingestion_error && /transcript/i.test(resource.ingestion_error) && (
                <p className="text-xs text-amber-300">{resource.ingestion_error}</p>
              )}

              {instagramMediaItems.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Media Sequence</p>
                  <div className="space-y-2">
                    {instagramMediaItems.map((item, index) => (
                      <div key={`${item.source_url || item.thumbnail_url || index}-${index}`} className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2 text-xs text-foreground/75">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground/85">#{(item.index ?? index) + 1}</span>
                          <span className="uppercase tracking-widest text-[10px] text-muted-foreground">{item.type}</span>
                          {item.width && item.height && <span>{item.width}x{item.height}</span>}
                          {item.duration_seconds && <span>{item.duration_seconds}s</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {resource.drive_folder_url && (
                  <a href={resource.drive_folder_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <FolderOpen className="h-3.5 w-3.5" /> Open Drive Folder
                  </a>
                )}
                {resource.download_status && resource.download_status !== 'skipped' && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Download className="h-3.5 w-3.5" /> {resource.download_status}
                  </span>
                )}
              </div>

              {resource.ingestion_error && !/transcript/i.test(resource.ingestion_error) && (
                <p className="text-xs text-amber-300">{resource.ingestion_error}</p>
              )}
            </div>
          )}

          {resource.content && resource.resource_type !== 'note' && (
            <div className="rounded-xl border border-border/50 bg-secondary/20 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Extracted Source Text</p>
                {resource.content_truncated ? (
                  <span className="text-[10px] uppercase tracking-widest text-amber-300">trimmed</span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/75">
                {String(resource.content).slice(0, 4000)}
              </p>
            </div>
          )}

          <ResourceListSection
            title="Key Points"
            icon={Lightbulb}
            items={resource.key_points || []}
            accentClass="text-amber-400"
            bulletClass="bg-amber-400/70"
          />

          <ResourceListSection
            title="Actionable Points"
            icon={CheckCircle2}
            items={resource.actionable_points || []}
            accentClass="text-emerald-400"
            bulletClass="bg-emerald-400/70"
          />

          <ResourceListSection
            title="Use Cases"
            icon={Zap}
            items={resource.use_cases || []}
            accentClass="text-violet-400"
            bulletClass="bg-violet-400/70"
          />

          <ResourceListSection
            title="Learning Outcomes"
            icon={BookOpen}
            items={resource.learning_outcomes || []}
            accentClass="text-cyan-400"
            bulletClass="bg-cyan-400/70"
          />

          <ResourceListSection
            title="Notable Quotes or Moments"
            icon={Quote}
            items={resource.notable_quotes_or_moments || []}
            accentClass="text-rose-400"
            bulletClass="bg-rose-400/70"
          />

          {isReddit && redditCommentTakeaways.length > 0 && (
            <ResourceListSection
              title="Comment Takeaways"
              icon={MessagesSquare}
              items={redditCommentTakeaways}
              accentClass="text-orange-300"
              bulletClass="bg-orange-400/70"
            />
          )}

          {/* Manual note content */}
          {resource.content && resource.resource_type === 'note' && (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{resource.content}</ReactMarkdown>
            </div>
          )}

          {/* Tags */}
          {(resource.tags || []).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Tag className="w-3 h-3 text-muted-foreground" />
              {resource.tags.map(tag => (
                <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">#{tag}</span>
              ))}
            </div>
          )}

          {/* Rating + Actions footer */}
          <div className="flex flex-col gap-3 border-t border-border/50 pt-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Star rating */}
            {(isGitHub || resource.resource_type === 'website') && (
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map(star => (
                  <button key={star} onClick={() => handleRate(star)} className="hover:scale-110 transition-transform">
                    <Star className={cn('w-4 h-4', star <= rating ? 'text-amber-400 fill-amber-400' : 'text-muted-foreground/30')} />
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-3 sm:ml-auto">
              {(isGitHub || resource.resource_type === 'website') && (
                <button onClick={handleLike} className={cn('flex items-center gap-1 text-sm transition-colors', liked ? 'text-rose-400' : 'text-muted-foreground hover:text-rose-400')}>
                  <Heart className={cn('w-4 h-4', liked && 'fill-rose-400')} />
                  {(resource.likes || 0) + (liked ? 1 : 0)}
                </button>
              )}
              <Button variant="ghost" onClick={handleDelete} className="text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs">
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
              </Button>
            </div>
          </div>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
