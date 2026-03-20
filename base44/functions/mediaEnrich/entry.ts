import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';
import { enrichMediaCatalog } from '../_shared/mediaCatalog/entry.ts';

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

    const { type, externalId } = await req.json();

    if (!externalId || !type) {
      return Response.json({});
    }

    try {
      const result = await enrichMediaCatalog(externalId, type);
      return Response.json(result);
    } catch (error) {
      return Response.json(
        { error: `Media provider enrich failed: ${getErrorMessage(error)}` },
        { status: 502 },
      );
    }
  } catch (error) {
    return Response.json({ error: getErrorMessage(error) }, { status: 500 });
  }
});
