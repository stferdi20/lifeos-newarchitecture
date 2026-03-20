import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Use service role to fetch all investments
    const investments = await base44.asServiceRole.entities.Investment.list();

    const priceable = investments.filter(i =>
      ((i.type === 'stock' || i.type === 'crypto') && i.symbol) ||
      (i.type === 'tcg' && i.name)
    );

    if (priceable.length === 0) return Response.json({ updated: 0 });

    const res = await base44.asServiceRole.functions.invoke('fetchPrices', { investments: priceable });
    const results = res?.results || [];

    let updated = 0;
    for (const r of results) {
      if (r.price) {
        await base44.asServiceRole.entities.Investment.update(r.id, {
          current_price: r.price,
          last_updated: new Date().toISOString(),
        });
        updated++;
      }
    }

    return Response.json({ updated, total: priceable.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});