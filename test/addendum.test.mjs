import assert from 'node:assert/strict';
import test from 'node:test';
import { readBundle } from '../tools/materials.mjs';
import { assessAddendum, withdrawalPlan } from '../tools/addendum.mjs';

const bundle = readBundle();
const result = assessAddendum(bundle, ['p04', 'p05']);

test('补遗补全身份链：与在评可读的 A.1 合出微涧施工社', () => {
  assert.equal(result.identity.exposed, true);
  assert.equal(result.identity.identifiedBid, 'b1');
  const parts = result.identity.combos.flatMap(c => c.parts);
  assert.ok(parts.includes('issue-A@A.1') && parts.includes('p04'));
  assert.deepEqual(result.identity.blockedBlocks, ['p04']);
  assert.ok(result.identity.suggestions[0].text.includes('相应资质'));
});

test('照发即暴露时的收回预案：收回卷次、暂停评分、秘书交接', () => {
  const plan = result.identity.withdrawalIfDispatched;
  assert.deepEqual(plan.withdrawn, ['issue-A']);
  assert.deepEqual(plan.pausedScores.sort(), ['s1', 's3']);
  assert.ok(plan.handover.some(h => h.includes('不得归到新证据')));
});

test('补遗只改量程：找出引用旧量程的评分，其余继续', () => {
  const ev = result.evidence.find(e => e.newBlock === 'p05');
  assert.ok(ev.changed.lost.includes('3–12米'));
  assert.ok(ev.changed.lost.includes('有效范围'));
  assert.ok(ev.changed.added.includes('3–10米'));
  assert.deepEqual(ev.criteria, ['t2']);
  assert.deepEqual(ev.scores, ['s1']);
  assert.deepEqual(result.scoreImpacts.map(i => i.score), ['s1']);
  assert.deepEqual(result.continueScores.sort(), ['s2', 's3']);
});

test('技术依据换页登记：旧锚点到新原稿', () => {
  assert.deepEqual(result.basisMoves, [{
    packet: 'issue-A',
    anchor: 'A.2',
    fromBlock: 'p02',
    toBlock: 'p05',
    criteria: ['t2'],
    note: '技术依据换到新页；旧评分仍挂在原锚点追查',
  }]);
});

test('收回预案本身：暂停的是受影响卷次的评分提交', () => {
  const plan = withdrawalPlan(bundle, ['issue-A'], '演练');
  assert.deepEqual(plan.pausedScores.sort(), ['s1', 's3']);
  assert.ok(plan.handover.some(h => h.includes('交接')));
});
