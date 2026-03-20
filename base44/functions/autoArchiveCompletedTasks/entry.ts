import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all tasks with 'done' status
    const doneTasks = await base44.entities.Task.filter({ status: 'done' });
    
    // Get current date
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    let archivedCount = 0;
    
    // Archive tasks completed more than 7 days ago
    for (const task of doneTasks) {
      const updatedDate = new Date(task.updated_date);
      if (updatedDate < sevenDaysAgo) {
        await base44.entities.Task.update(task.id, { 
          status: 'archived' 
        });
        archivedCount++;
      }
    }
    
    return Response.json({ 
      success: true, 
      message: `Archived ${archivedCount} completed tasks`,
      archivedCount 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});