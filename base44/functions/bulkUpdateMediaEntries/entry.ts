import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

const CONCURRENCY = 10;

async function runWithConcurrency<T>(items: T[], worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      await worker(next);
    }
  });

  await Promise.all(workers);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { ids = [], update = {} } = await req.json();

    if (!Array.isArray(ids) || ids.length === 0) {
      return Response.json({ updated: 0 });
    }

    await runWithConcurrency(ids, async (id) => {
      await base44.entities.MediaEntry.update(id, update);
    });

    return Response.json({ updated: ids.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
