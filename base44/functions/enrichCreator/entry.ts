import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { creator_id, handle, platform } = await req.json();
    if (!handle || !platform) {
      return Response.json({ error: 'handle and platform are required' }, { status: 400 });
    }

    const platformNames = {
      x: 'X (Twitter)',
      threads: 'Threads',
      instagram: 'Instagram',
      tiktok: 'TikTok',
      youtube: 'YouTube',
      linkedin: 'LinkedIn',
      other: 'social media'
    };

    const platformName = platformNames[platform] || 'social media';

    const prompt = `You are analyzing a social media creator's profile to help someone understand their content strategy and style.

Creator handle: @${handle}
Platform: ${platformName}

Search the internet for this creator's ${platformName} profile and their content. Then provide:

1. **niche**: Their primary content niche in 2-5 words (e.g. "fitness & lifestyle", "tech reviews", "cooking tutorials", "AI & productivity")
2. **content_style**: A brief 1-2 sentence description of HOW they create content — their style, tone, format preferences (e.g. "Short-form educational content with fast-paced editing and text overlays. Uses humor and relatable scenarios to explain complex topics.")
3. **description**: A 1-2 sentence summary of WHO they are and WHAT they do
4. **tags**: 5-8 relevant tags for categorization (lowercase, no hashtags). Include their niche, content format, tone, and any notable themes.
5. **profile_picture_url**: If you can find their profile picture URL, include it. Otherwise return null.

Be specific and practical — the goal is to quickly recognize what makes this creator's content strategy work.
If you cannot find information about this creator, still provide your best guess based on the handle and platform, and note the uncertainty in the description.`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: "object",
        properties: {
          niche: { type: "string" },
          content_style: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          profile_picture_url: { type: "string" }
        }
      }
    });

    // Build update data, filtering out empty values
    const updateData = { enriched: true };
    if (result.niche) updateData.niche = result.niche;
    if (result.content_style) updateData.content_style = result.content_style;
    if (result.description) updateData.description = result.description;
    if (result.tags && result.tags.length > 0) updateData.tags = result.tags;
    if (result.profile_picture_url) updateData.profile_picture_url = result.profile_picture_url;

    // Update the entity if we have an ID
    if (creator_id) {
      await base44.asServiceRole.entities.CreatorInspo.update(creator_id, updateData);
    }

    return Response.json({ success: true, data: updateData });
  } catch (error) {
    console.error('Enrichment error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});