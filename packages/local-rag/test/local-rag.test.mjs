import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIncrementalIndexEntry,
  chunkText,
  incrementalIndexIsCurrent,
  knowledgeIndexSummary,
  searchIndexedKnowledge,
  searchLocalKnowledge,
  tokenize,
} from '../src/index.js';

const files = [
  {
    id: 'brake',
    name: '前刹车片产品证据.txt',
    tags: ['制动', 'OE', '车型'],
    text: 'SKU BRAKE-001。OE号 04465-0E010。适配信息必须由车型、年款和安装位置证据共同确认，制动系统应由合格人员安装。',
    createdAt: '2026-07-22T00:00:00.000Z',
  },
  {
    id: 'pricing',
    name: '汽配报价说明.txt',
    tags: ['价格', '库存'],
    text: 'BRAKE-001 当前供货价为 28 美元。价格和库存必须在发布前人工复核，不得把未知交期写成承诺。',
    createdAt: '2026-07-22T00:00:00.000Z',
  },
  {
    id: 'privacy',
    name: '本地知识库边界.txt',
    tags: ['本地', '隐私'],
    text: '知识文件、索引、检索片段和业务数据保存在客户电脑本地。云端仅负责授权，不上传知识内容。',
    createdAt: '2026-07-22T00:00:00.000Z',
  },
];

test('Chinese and English tokenization supports local hybrid retrieval with citations', () => {
  assert.ok(tokenize('BRAKE-001 前刹车片适配车型').length > 4);
  assert.ok(chunkText('第一段车型资料。\n\n第二段OE资料。', { chunkSize: 12, overlap: 2 }).length >= 2);

  const result = searchLocalKnowledge({ query: 'BRAKE-001 的 OE 号是什么', files, limit: 3 });
  assert.equal(result.localOnly, true);
  assert.equal(result.algorithm, 'local-hybrid-bm25-hashed-vector');
  assert.equal(result.matches[0].fileId, 'brake');
  assert.match(result.matches[0].citation, /来源1/);
  assert.ok(result.matches[0].matchedTerms.length > 0);
});

test('incremental index is deterministic, serializable, and reused after persistence', () => {
  const indexed = files.map((file) => ({ ...file, ragIndex: buildIncrementalIndexEntry(file) }));
  assert.ok(indexed.every(incrementalIndexIsCurrent));
  assert.equal(typeof indexed[0].ragIndex.chunks[0].vectorBase64, 'string');
  assert.equal('vector' in indexed[0].ragIndex.chunks[0], false);

  const persisted = JSON.parse(JSON.stringify(indexed));
  const result = searchIndexedKnowledge({ query: '发布前如何核验价格库存', files: persisted, limit: 3 });
  assert.equal(result.matches[0].fileId, 'pricing');
  assert.equal(result.index.incremental, true);
  assert.match(result.algorithm, /incremental/);

  const summary = knowledgeIndexSummary(persisted);
  assert.equal(summary.indexedFiles, 3);
  assert.equal(summary.pendingFiles, 0);
  assert.equal(summary.localOnly, true);
  assert.equal(summary.cloudUpload, false);
});

test('changed content invalidates the previous index fingerprint', () => {
  const original = { ...files[0], ragIndex: buildIncrementalIndexEntry(files[0]) };
  assert.equal(incrementalIndexIsCurrent(original), true);
  assert.equal(incrementalIndexIsCurrent({ ...original, text: `${original.text} 新证据` }), false);
});

test('empty queries and empty file sets return no invented matches', () => {
  assert.deepEqual(searchIndexedKnowledge({ query: '', files }).matches, []);
  assert.deepEqual(searchIndexedKnowledge({ query: 'OE号', files: [] }).matches, []);
});
