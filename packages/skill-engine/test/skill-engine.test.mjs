import assert from 'node:assert/strict';
import test from 'node:test';

import { SkillEngine, systemSkills } from '../dist/index.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const genericOutputSchema = {
  safeParse(value) {
    const valid = value
      && typeof value === 'object'
      && typeof value.summary === 'string'
      && Array.isArray(value.items);
    return valid
      ? { success: true, data: value }
      : { success: false, error: { issues: [{ path: [], message: 'Invalid generic output.' }] } };
  },
};

const genericSkill = {
  code: 'platform_generic_analysis',
  name: 'Platform Generic Analysis',
  version: '1.0.0',
  promptName: 'platform_generic_analysis',
  riskLevel: 'L1',
  requiresApproval: false,
  outputSchema: genericOutputSchema,
};

function validGateway() {
  return {
    async run(request) {
      assert.equal(request.provider, undefined);
      assert.equal(request.model, undefined);
      return {
        provider: 'platform-routed-provider',
        model: 'platform-routed-model',
        output: { summary: 'ok', items: [] },
        tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        costEstimate: 0,
        validationStatus: 'valid',
      };
    },
  };
}

test('BossAI Platform ships no employee-domain system Skills', () => {
  assert.deepEqual(systemSkills, []);
});

test('an injected generic Skill completes only with schema-valid output and a UUID runId', async () => {
  const engine = new SkillEngine(validGateway(), [genericSkill]);
  const result = await engine.run({
    tenantId: 'tenant-1',
    skillCode: genericSkill.code,
    input: { objective: 'generic platform fixture' },
  });

  assert.equal(result.status, 'completed');
  assert.match(result.runId, uuidPattern);
});

test('Skill Engine does not expose caller-selected Provider or model routing fields', () => {
  const sourceInput = { tenantId: 'tenant-1', skillCode: genericSkill.code, input: {} };
  assert.equal('provider' in sourceInput, false);
  assert.equal('model' in sourceInput, false);
});

test('skill fails when a Gateway claims valid but returns schema-invalid output', async () => {
  const gateway = {
    async run() {
      return {
        provider: 'platform-routed-provider',
        model: 'broken-test-adapter',
        output: { summary: 123, items: [] },
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        costEstimate: 0,
        validationStatus: 'valid',
      };
    },
  };
  const engine = new SkillEngine(gateway, [genericSkill]);
  const result = await engine.run({ tenantId: 'tenant-1', skillCode: genericSkill.code, input: {} });

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'OUTPUT_VALIDATION_FAILED');
  assert.match(result.runId, uuidPattern);
});

test('Gateway failures become explicit failed Skill runs', async () => {
  const gateway = {
    async run() {
      const error = new Error('Platform model route unavailable.');
      error.code = 'MODEL_ASSIGNMENT_NOT_FOUND';
      throw error;
    },
  };
  const engine = new SkillEngine(gateway, [genericSkill]);
  const result = await engine.run({ tenantId: 'tenant-1', skillCode: genericSkill.code, input: {} });

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'MODEL_ASSIGNMENT_NOT_FOUND');
});

test('unknown Skills fail with a UUID runId', async () => {
  const engine = new SkillEngine(validGateway(), []);
  const result = await engine.run({ tenantId: 'tenant-1', skillCode: 'missing', input: {} });

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.code, 'SKILL_NOT_FOUND');
  assert.match(result.runId, uuidPattern);
});
