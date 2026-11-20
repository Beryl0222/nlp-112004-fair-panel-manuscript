import assert from 'node:assert/strict';
import test from 'node:test';
import { readBundle } from '../tools/materials.mjs';
import { buildLexicon } from '../tools/lexicon.mjs';
import { detectSignals, analyzeVolume } from '../tools/identity.mjs';

const bundle = readBundle();
const lexicon = buildLexicon(bundle.portraits);
const block = id => bundle.blocks.find(b => b.id === id);

test('直接称呼：p08 的「汀桥队」指向半汀测建', () => {
  const signals = detectSignals(block('p08').text, lexicon);
  assert.deepEqual(signals.aliases.map(a => a.bid), ['b3']);
  assert.deepEqual(signals.candidates, ['b3']);
});

test('经历组合：p01 与 p04 各自不唯一，合起来指向微涧施工社一家', () => {
  const s1 = detectSignals(block('p01').text, lexicon);
  const s4 = detectSignals(block('p04').text, lexicon);
  assert.deepEqual(s1.candidates, ['b1', 'b2']);
  assert.deepEqual(s4.candidates, ['b1', 'b3']);
  const volume = analyzeVolume([
    { id: 'p01', text: block('p01').text },
    { id: 'p04', text: block('p04').text },
  ], lexicon);
  assert.equal(volume.identified, 'b1');
  assert.deepEqual(volume.combos.map(c => c.parts), [['p01', 'p04']]);
});

test('例行设备名称与通用作业约束不算身份', () => {
  for (const id of ['p02', 'p05', 'p06', 'p07', 'p09']) {
    const signals = detectSignals(block(id).text, lexicon);
    assert.equal(signals.aliases.length, 0, `${id} 不应有别名命中`);
    assert.equal(signals.facts.length, 0, `${id} 不应有经历命中`);
  }
  const equipment = detectSignals(block('p02').text, lexicon).equipment;
  assert.ok(equipment.some(e => e.name === '东脊 D-3'), '机型专名按例行设备登记');
});

test('补遗与在评可读内容合并：A.1 的经历加上 p04 的资质合出一家', () => {
  const issue = bundle.dispatch.find(d => d.id === 'issue-A');
  const readable = Object.entries(issue.material).map(([anchor, text]) => ({ id: `issue-A@${anchor}`, text }));
  const volume = analyzeVolume([...readable, { id: 'p04', text: block('p04').text }], lexicon);
  assert.equal(volume.identified, 'b1');
  const parts = volume.combos.flatMap(c => c.parts);
  assert.ok(parts.includes('issue-A@A.1') && parts.includes('p04'));
});

test('单看已发卷 A.1 只是弱线索，不指向一家', () => {
  const issue = bundle.dispatch.find(d => d.id === 'issue-A');
  const volume = analyzeVolume(
    Object.entries(issue.material).map(([anchor, text]) => ({ id: anchor, text })),
    lexicon,
  );
  assert.equal(volume.identified, null);
  assert.deepEqual(volume.weak, [{ id: 'A.1', candidates: ['b1', 'b2'] }]);
});
