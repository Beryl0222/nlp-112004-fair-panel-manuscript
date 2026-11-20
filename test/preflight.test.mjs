import assert from 'node:assert/strict';
import test from 'node:test';
import { readBundle } from '../tools/materials.mjs';
import { preflightReport, buildPacket, assertReviewerSafe, secretaryTrace } from '../tools/preflight.mjs';

const bundle = readBundle();

test('发卷前报告：b1 整卷被 p01+p04 组合指向，p02 被替换不发出', () => {
  const report = preflightReport(bundle, 'b1');
  assert.equal(report.identified, 'b1');
  assert.deepEqual(report.combos.map(c => c.parts), [['p01', 'p04']]);
  assert.deepEqual(report.superseded, ['p02']);
  const p01 = report.items.find(i => i.block.id === 'p01');
  assert.equal(p01.suggestion.action, '退回修订');
  assert.ok(p01.combos.length > 0, '秘书应看到 p01 与哪几处合起来能识别');
  const p04 = report.items.find(i => i.block.id === 'p04');
  assert.equal(p04.suggestion.action, '建议泛化改写');
  assert.ok(p04.suggestion.text.includes('相应资质'));
  assert.equal(report.afterSuggestions.identified, null, '按建议处置后整卷不再指向一家');
});

test('发卷前报告：b3 的题记是直接称呼，候选改写需修订', () => {
  const report = preflightReport(bundle, 'b3');
  const p08 = report.items.find(i => i.block.id === 'p08');
  assert.deepEqual(p08.signals.aliases.map(a => a.bid), ['b3']);
  assert.equal(p08.suggestion.action, '退回修订');
});

test('身份与必评依据无法两全时标明待补交', () => {
  const synthetic = {
    ...bundle,
    blocks: [...bundle.blocks, {
      id: 'p10', tender: 'M26', bid: 'b2', edition: '1', anchor: '§7', kind: '正文',
      text: '此前和山地站完成松针支沟复测，试验范围 3–8 米。', old: null,
    }],
  };
  const report = preflightReport(synthetic, 'b2');
  const p10 = report.items.find(i => i.block.id === 'p10');
  assert.equal(p10.suggestion.action, '待补交');
  assert.ok(p10.suggestion.note.includes('公平比较'));
});

test('未处置的冲突段落不得发卷', () => {
  assert.throws(() => buildPacket(bundle, 'b1'), /未处置段落/);
  assert.throws(() => buildPacket(bundle, 'b3'), /未处置段落/);
});

test('干净卷可发：评委卷无内部标记，秘书映射可追查', () => {
  const { packet, mapping } = buildPacket(bundle, 'b2');
  const json = JSON.stringify(packet);
  for (const token of ['p06', 'p07', 'b2', '零榆']) {
    assert.ok(!json.includes(token), `评委卷不得含 ${token}`);
  }
  assert.deepEqual(Object.keys(packet.material), ['C.1', 'C.2']);
  assert.deepEqual(mapping.links, { 'C.1': 'p06', 'C.2': 'p07' });
});

test('按秘书决定发卷：引用落到卷内锚点，被替换段只留秘书端提示', () => {
  const decisions = {
    rewrites: {
      p01: '此前完成过支沟复测。本段同样适用于北侧湿坡。',
      p04: '补上实施单位资质，执行前文方案的班组持有相应资质。',
    },
  };
  const { packet, mapping } = buildPacket(bundle, 'b1', decisions);
  assert.deepEqual(Object.keys(packet.material), ['C.1', 'C.2', 'C.3', 'C.4']);
  assert.ok(packet.citations.some(c => c.from === 'C.3' && c.to === 'C.1'), '前文指代应落到卷内锚点');
  assert.ok(mapping.warnings.some(w => w.includes('p02')), '被替换的旧段只在秘书端提示');
  assert.equal(mapping.links['C.1'], 'p01');
});

test('安全闸拦截带内部标记或残留身份的评委卷', () => {
  assert.throws(
    () => assertReviewerSafe({ id: 'issue-X', material: { 'X.1': '见 p01 的说明。' }, citations: [] }, bundle),
    /内部标记/,
  );
  assert.throws(
    () => assertReviewerSafe({ id: 'issue-X', material: { 'X.1': '本次沿用汀桥队记录。' }, citations: [] }, bundle),
    /直接称呼/,
  );
});

test('秘书端从匿名卷一处追到原文与遮改记录', () => {
  const trace = secretaryTrace(bundle, 'issue-A', 'A.2');
  assert.equal(trace.原稿编号, 'p02');
  assert.ok(trace.原文.includes('3–12 米'));
  assert.equal(trace.后续替换.编号, 'p05');
  assert.equal(trace.遮改记录.length, 0, 'p02 旧流程未登记遮改，如实显示为空');
  const approved = secretaryTrace(bundle, 'issue-A', 'A.3');
  assert.equal(approved.遮改记录[0].编号, 'n2');
  assert.equal(approved.遮改记录[0].类别, '批准');
});
