import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { getMediaCatalogHealth } from '../_shared/mediaCatalog/entry.ts';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return Response.json({
      ...getMediaCatalogHealth(),
      functions_version_header: req.headers.get('Base44-Functions-Version') || null,
    });
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
});
