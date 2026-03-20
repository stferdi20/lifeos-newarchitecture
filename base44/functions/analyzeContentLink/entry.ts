import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { url, project_id } = await req.json();
    if (!url) return Response.json({ error: 'URL is required' }, { status: 400 });

    // Detect resource type from URL
    const isYouTube = /youtube\.com|youtu\.be/.test(url);
    const isReddit = /reddit\.com/.test(url);
    const isAcademic = /arxiv\.org|scholar\.google|doi\.org|pubmed|researchgate|semanticscholar/.test(url);
    const isPDF = /\.pdf(\?|$)/i.test(url);
    const newsDomains = /bbc\.|cnn\.|reuters\.|nytimes\.|theguardian\.|techcrunch\.|theverge\.|arstechnica\.|wired\.|bloomberg\.|washingtonpost\.|forbes\.|huffpost\.|apnews\.|news\./i;

    let sourceType = 'generic_link';
    if (isYouTube) sourceType = 'youtube_video';
    else if (isReddit) sourceType = 'reddit_post';
    else if (isAcademic) sourceType = 'academic_paper';
    else if (isPDF) sourceType = 'pdf';
    else if (newsDomains.test(url)) sourceType = 'news_article';

    const typePrompts = {
      youtube_video: 'YouTube video: extract the video title, channel name, estimated duration, a comprehensive summary, key insights, actionable steps, and overall sentiment.',
      reddit_post: 'Reddit post: extract the post title, subreddit as author, a summary of the post and top comments, key insights, actionable steps if any, and overall sentiment.',
      news_article: 'News article: extract the article title, publication/author, publish date, a summary, key insights, actionable takeaways, and overall sentiment.',
      academic_paper: 'Academic paper: extract the paper title, authors, publish date, a plain-English summary, key findings/insights, practical implications, and overall sentiment.',
      generic_link: 'Web page: extract the page title, author/source, a summary, key insights, actionable steps, and overall sentiment.',
      pdf: 'PDF document: extract the document title, author if available, a summary, key insights, actionable steps, and overall sentiment.',
      website: 'Website: extract the page title, site name, a summary, key insights, actionable steps, and overall sentiment.',
    };

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Analyze this ${sourceType} URL and extract structured information from it: ${url}

${typePrompts[sourceType]}

Also:
- Suggest 5-8 relevant tags for this content.
- Identify the single main topic of this content (e.g. "Machine Learning", "Productivity", "Web Development").
- Rate the usefulness of this resource from 1 to 10 (10 = extremely useful).
- Extract the publish date if available.
Be thorough and detailed in the insights and actionable steps (aim for 3-6 of each).`,
      add_context_from_internet: true,
      response_json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          source_author: { type: "string" },
          source_duration: { type: "string" },
          preview_image_url: { type: "string" },
          published_date: { type: "string" },
          ai_summary: { type: "string" },
          main_topic: { type: "string" },
          ai_score: { type: "number" },
          ai_key_insights: { type: "array", items: { type: "string" } },
          ai_actionable_steps: { type: "array", items: { type: "string" } },
          ai_sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"] },
          tags: { type: "array", items: { type: "string" } }
        }
      },
      model: "gemini_3_flash"
    });

    // YouTube thumbnail fallback
    let preview_image_url = result.preview_image_url || '';
    if (isYouTube && !preview_image_url) {
      const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
      if (videoIdMatch) {
        preview_image_url = `https://img.youtube.com/vi/${videoIdMatch[1]}/hqdefault.jpg`;
      }
    }

    // Find related content
    const existingNotes = await base44.asServiceRole.entities.Note.list('-created_date', 50);
    let related_content = [];
    if (existingNotes.length > 0) {
      const relatedResult = await base44.integrations.Core.InvokeLLM({
        prompt: `Given this new note titled "${result.title}" about: "${result.ai_summary}"

Here are existing notes (id, title, tags):
${existingNotes.slice(0, 30).map(n => `- id:${n.id} | "${n.title}" | tags: ${(n.tags || []).join(', ')}`).join('\n')}

Identify up to 3 existing notes that are most semantically related. Only pick genuinely relevant ones.`,
        response_json_schema: {
          type: "object",
          properties: {
            related: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  title: { type: "string" },
                  reason: { type: "string" }
                }
              }
            }
          }
        }
      });
      related_content = (relatedResult.related || []).map(r => ({
        type: 'note', id: r.id, title: r.title, reason: r.reason
      }));
    }

    const noteData = {
      title: result.title || url,
      type: sourceType,
      source_url: url,
      saved_date: new Date().toISOString(),
      published_date: result.published_date || '',
      source_author: result.source_author || '',
      source_duration: result.source_duration || '',
      preview_image_url,
      ai_summary: result.ai_summary || '',
      main_topic: result.main_topic || '',
      ai_score: result.ai_score || 5,
      ai_key_insights: result.ai_key_insights || [],
      ai_actionable_steps: result.ai_actionable_steps || [],
      ai_sentiment: result.ai_sentiment || 'neutral',
      tags: result.tags || [],
      content: result.ai_summary || '',
      para_category: 'resource',
      related_content,
      annotations: []
    };

    const created = await base44.asServiceRole.entities.Note.create(noteData);

    // Link to project if project_id provided
    if (project_id) {
      await base44.asServiceRole.entities.ProjectResource.create({
        project_id,
        note_id: created.id
      });
    }

    return Response.json({ note: created });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});