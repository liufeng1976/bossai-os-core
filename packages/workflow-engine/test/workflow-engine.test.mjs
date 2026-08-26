import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkflowEngine, systemWorkflows } from '../dist/index.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function skillResult(skillCode, overrides = {}) {
  return {
    runId: crypto.randomUUID(),
    skillCode,
    output: { summary: skillCode },
    riskLevel: 'L1',
    requiresApproval: false,
    status: 'completed',
    ...overrides,
  };
}

test('failed skills fail the workflow and stop later nodes', async () => {
  const calls = [];
  const skills = {
    async run(input) {
      calls.push(input.skillCode);
      return skillResult(input.skillCode, {
        status: 'failed',
        error: { code: 'TEST_FAILURE', message: 'failed' },
      });
    },
  };
  const workflows = [{
    code: 'failure',
    name: 'failure',
    nodes: [
      { id: 'first', type: 'skill', skillCode: 'first' },
      { id: 'second', type: 'skill', skillCode: 'second' },
    ],
  }];
  const engine = new WorkflowEngine(skills, workflows);
  const result = await engine.run('tenant-1', 'failure', {});

  assert.equal(result.status, 'failed');
  assert.deepEqual(calls, ['first']);
  assert.match(result.runId, uuidPattern);
});

test('approval pauses before downstream execution and resume keeps the runId', async () => {
  const calls = [];
  const skills = {
    async run(input) {
      calls.push(input.skillCode);
      return skillResult(input.skillCode);
    },
  };
  const workflows = [{
    code: 'approval',
    name: 'approval',
    nodes: [
      { id: 'before', type: 'skill', skillCode: 'before' },
      { id: 'approval-node', type: 'approval' },
      { id: 'after', type: 'skill', skillCode: 'after' },
    ],
  }];
  const engine = new WorkflowEngine(skills, workflows);
  const waiting = await engine.run('tenant-1', 'approval', { orderId: 'order-1' });

  assert.equal(waiting.status, 'waiting_approval');
  assert.deepEqual(calls, ['before']);
  assert.equal(waiting.waitingNode?.id, 'approval-node');
  assert.equal(waiting.cursor?.nextNodeIndex, 2);
  assert.equal(waiting.context?.input.orderId, 'order-1');

  const resumed = await engine.resume({ run: waiting, decision: 'approved', approval: { approverId: 'user-1' } });
  assert.equal(resumed.status, 'completed');
  assert.equal(resumed.runId, waiting.runId);
  assert.deepEqual(calls, ['before', 'after']);
});

test('a skill requiring approval uses an adjacent approval node and does not run later nodes', async () => {
  const calls = [];
  const skills = {
    async run(input) {
      calls.push(input.skillCode);
      return skillResult(input.skillCode, { requiresApproval: input.skillCode === 'risky', riskLevel: 'L3' });
    },
  };
  const workflows = [{
    code: 'risk',
    name: 'risk',
    nodes: [
      { id: 'risky-node', type: 'skill', skillCode: 'risky' },
      { id: 'approval-node', type: 'approval' },
      { id: 'after', type: 'skill', skillCode: 'after' },
    ],
  }];
  const engine = new WorkflowEngine(skills, workflows);
  const waiting = await engine.run('tenant-1', 'risk', {});

  assert.equal(waiting.status, 'waiting_approval');
  assert.deepEqual(calls, ['risky']);
  assert.equal(waiting.waitingNode?.id, 'approval-node');
  assert.equal(waiting.cursor?.reason, 'skill_requires_approval');
  assert.equal(waiting.cursor?.nextNodeIndex, 2);
});

test('unsupported nodes explicitly fail instead of being skipped', async () => {
  const skills = { async run(input) { return skillResult(input.skillCode); } };
  const workflows = [{
    code: 'unsupported',
    name: 'unsupported',
    nodes: [{ id: 'notify', type: 'notification' }],
  }];
  const engine = new WorkflowEngine(skills, workflows);
  const result = await engine.run('tenant-1', 'unsupported', {});

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.nodeResults[0].error, {
    code: 'UNSUPPORTED_NODE_TYPE',
    message: 'Workflow node type "notification" is not supported by the runtime.',
  });
});

test('rejected approval fails without executing downstream nodes', async () => {
  const calls = [];
  const skills = {
    async run(input) {
      calls.push(input.skillCode);
      return skillResult(input.skillCode);
    },
  };
  const workflows = [{
    code: 'reject',
    name: 'reject',
    nodes: [
      { id: 'approval-node', type: 'approval' },
      { id: 'after', type: 'skill', skillCode: 'after' },
    ],
  }];
  const engine = new WorkflowEngine(skills, workflows);
  const waiting = await engine.run('tenant-1', 'reject', {});
  const rejected = await engine.resume({ run: waiting, decision: 'rejected' });

  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.runId, waiting.runId);
  assert.deepEqual(calls, []);
});

test('BossAI Platform ships no employee-domain system Workflows', async () => {
  assert.deepEqual(systemWorkflows, []);
  const engine = new WorkflowEngine();
  const missing = await engine.run('tenant-1', 'employee-domain-workflow', {});
  assert.equal(missing.status, 'failed');
  assert.equal(missing.nodeResults[0].error.code, 'WORKFLOW_NOT_FOUND');
});
