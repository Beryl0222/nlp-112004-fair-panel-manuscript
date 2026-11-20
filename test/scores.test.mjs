import assert from 'node:assert/strict';
import test from 'node:test';
import { readBundle } from '../tools/materials.mjs';
import { assessAddendum } from '../tools/addendum.mjs';
import { traceScore, scoreStatuses, announceRanking, assertScoreAttribution, comparability } from '../tools/scores.mjs';

const bundle = readBundle();
const impacts = assessAddendum(bundle, ['p04', 'p05']);

test('评分追查：s1 落在实际引用的卷次与原稿，后续补遗只作提示', () => {
  const trace = traceScore(bundle, 's1', impacts);
  assert.equal(trace.packet, 'issue-A');
  assert.equal(trace.anchor, 'A.2');
  assert.equal(trace.实际引用原稿, 'p02');
  assert.ok(trace.实际引用量程.includes('3–12米'));
  assert.equal(trace.后续替换.编号, 'p05');
  assert.equal(trace.status, '草稿（待复评）');
});

test('禁止把旧评分归到新证据', () => {
  assert.throws(() => assertScoreAttribution(bundle, 's1', 'p05'), /禁止把评分 s1 归到新证据/);
  assert.equal(assertScoreAttribution(bundle, 's1', 'p02'), true);
});

test('有独立依据的打分不受影响', () => {
  const statuses = Object.fromEntries(scoreStatuses(bundle, impacts).map(s => [s.id, s.status]));
  assert.equal(statuses.s1, '草稿（待复评）');
  assert.equal(statuses.s2, '有效');
  assert.equal(statuses.s3, '有效');
});

test('量程更新后 t2 失去可比性，不得宣布排序', () => {
  const result = announceRanking(bundle, 't2', impacts);
  assert.equal(result.可宣布, false);
  assert.ok(result.原因.some(r => r.includes('issue-A')));
});

test('缺可评依据的比较项同样不得宣布排序，缺项记待补材料而非零分', () => {
  const t3 = comparability(bundle, 't3', impacts);
  const issueB = t3.rows.find(r => r.packet === 'issue-B');
  assert.equal(issueB.state, '缺依据（待补材料，不记零分）');
  assert.equal(announceRanking(bundle, 't3', impacts).可宣布, false);
});

test('卷次收回后其评分暂停提交', () => {
  const withWithdrawal = { ...impacts, withdrawn: ['issue-A'] };
  const statuses = Object.fromEntries(scoreStatuses(bundle, withWithdrawal).map(s => [s.id, s.status]));
  assert.equal(statuses.s1, '暂停（卷已收回）');
  assert.equal(statuses.s3, '暂停（卷已收回）');
  assert.equal(statuses.s2, '有效');
});
