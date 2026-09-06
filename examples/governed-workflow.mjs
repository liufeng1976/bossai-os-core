import { z } from '../packages/ai-contracts/dist/index.js';
import { SkillEngine } from '../packages/skill-engine/dist/index.js';
import { WorkflowEngine } from '../packages/workflow-engine/dist/index.js';

const demoGateway = {
  async run(request) {
    return {
      provider: 'demo-provider',
      model: 'deterministic-local-demo',
      output: {
        draft: `Draft only: ${String(request.input.request ?? 'No request supplied')}`,
        reason: 'The output is intentionally held behind a workflow approval gate.',
      },
      tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      costEstimate: 0,
      validationStatus: 'valid',
    };
  },
};

const draftSkill = {
  code: 'draft-customer-action',
  name: 'Draft customer action',
  version: '1.0.0',
  promptName: 'demo.draft-customer-action',
  riskLevel: 'L3',
  requiresApproval: true,
  outputSchema: z.object({
    draft: z.string().min(1),
    reason: z.string().min(1),
  }),
};

const workflow = {
  code: 'governed-customer-action',
  name: 'Governed customer action demo',
  nodes: [
    { id: 'draft', type: 'skill', skillCode: draftSkill.code },
    { id: 'human-approval', type: 'approval' },
    { id: 'record-result', type: 'notification' },
  ],
};

const notificationHandler = {
  async execute(_node, context) {
    return {
      externalMessageSent: false,
      note: 'Demo only: approval completed and the result was recorded locally.',
      approvedDraft: context.nodeOutputs.draft,
    };
  },
};

const skills = new SkillEngine(demoGateway, [draftSkill]);
const workflows = new WorkflowEngine(
  skills,
  [workflow],
  { notification: notificationHandler },
);

const initial = await workflows.run('demo-tenant', workflow.code, {
  request: 'Tell the customer their delivery date changed to Friday.',
});

if (initial.status !== 'waiting_approval') {
  throw new Error(`Expected waiting_approval, got ${initial.status}`);
}

console.log('1) Draft created. Workflow status:', initial.status);
console.log('2) Waiting node:', initial.waitingNode?.id);
console.log('3) No external message has been sent.');

const completed = await workflows.resume({
  run: initial,
  decision: 'approved',
  approval: {
    reviewedBy: 'human-demo-reviewer',
    note: 'Approved for the local example.',
  },
});

if (completed.status !== 'completed') {
  throw new Error(`Expected completed after approval, got ${completed.status}`);
}

const recordResult = completed.nodeResults.find((item) => item.nodeId === 'record-result');
if (!recordResult || recordResult.status !== 'completed') {
  throw new Error('Expected the post-approval record-result node to complete.');
}

console.log('4) Human approval recorded. Workflow status:', completed.status);
console.log('5) Final local record:');
console.log(JSON.stringify(recordResult, null, 2));
