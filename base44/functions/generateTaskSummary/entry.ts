import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { taskId } = await req.json();
    
    if (!taskId) {
      return Response.json({ error: 'taskId required' }, { status: 400 });
    }

    // Fetch the task
    const task = await base44.entities.Task.filter({ id: taskId });
    if (!task || task.length === 0) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    const taskData = task[0];
    
    // Generate AI summary and suggestions
    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt: `You are a project management assistant. Analyze this card and provide a concise summary and next steps.

Task Title: ${taskData.title}
Description: ${taskData.description || 'No description'}
List: ${taskData.list_id || 'Unassigned list'}
Priority: ${taskData.priority}

Please provide:
1. A concise 1-2 sentence summary
2. 2-3 suggested next steps or sub-tasks
3. Any risks or blockers to consider

Format as JSON with keys: summary, nextSteps (array), risks (array)`,
      response_json_schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          nextSteps: { type: 'array', items: { type: 'string' } },
          risks: { type: 'array', items: { type: 'string' } }
        }
      }
    });

    return Response.json({
      success: true,
      taskId,
      aiInsights: aiResponse
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});