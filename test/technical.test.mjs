import assert from 'node:assert/strict';
import test from 'node:test';
import { readBundle } from '../tools/materials.mjs';
import { buildLexicon } from '../tools/lexicon.mjs';
import { buildReferences } from '../tools/references.mjs';
import { tagCriteria, technicalTokens, analyzeRewrite } from '../tools/technical.mjs';

const bundle = readBundle();
const lexicon = buildLexicon(bundle.portraits);
const criteria = bundle['review-criteria'];
const edges = buildReferences(bundle.blocks);
const block = id => bundle.blocks.find(b => b.id === id);
const review = id => bundle.reviews.find(r => r.id === id);

test('技术 token：量程区间被抽出，补遗前后可比对', () => {
  assert.ok(technicalTokens(block('p02').text).has('3–12米'));
  const after = technicalTokens(block('p05').text);
  assert.ok(after.has('3–10米') && !after.has('3–12米'));
});

test('条目挂接：巡查间隔挂维护间隔，量程挂设备适用', () => {
  assert.deepEqual(tagCriteria(block('p03').text, criteria).map(t => t.criterion), ['t3']);
  assert.ok(tagCriteria(block('p07').text, criteria).some(t => t.criterion === 't2'));
});

test('稿内引用：表格标题、前一节、前文、详见、上一版各归其位', () => {
  const has = (from, to, kind) => edges.some(e => e.from === from && e.to === to && e.kind === kind);
  assert.ok(has('p02', 'p01', '前节'));
  assert.ok(has('p04', 'p01', '前文') && has('p04', 'p03', '前文'));
  assert.ok(has('p05', 'p02', '旧版'));
  assert.ok(has('p08', 'p09', '详见'));
});

test('候选改写 n1：身份去净但丢了坡型边界，还新增了「一致」主张', () => {
  const analysis = analyzeRewrite(block('p01'), review('n1').candidate, { lexicon, criteria, edges });
  assert.equal(analysis.verdict, '需修订');
  assert.ok(analysis.removedIdentity.some(s => s.includes('松针支沟')));
  assert.ok(analysis.lostTechnical.some(s => s.includes('湿坡')));
  assert.ok(analysis.addedClaims.some(s => s.includes('一致')));
});

test('候选改写 n2：仅丢限定词，列为轻微差异', () => {
  const analysis = analyzeRewrite(block('p03'), review('n2').candidate, { lexicon, criteria, edges });
  assert.equal(analysis.verdict, '需确认（轻微技术差异）');
  assert.ok(analysis.lostTokens.includes('仅'));
});

test('候选改写 n3：与图2说明的引用断裂，且新增「相同板型」主张', () => {
  const analysis = analyzeRewrite(block('p08'), review('n3').candidate, { lexicon, criteria, edges });
  assert.equal(analysis.verdict, '需修订');
  assert.ok(analysis.brokenReferences.some(b => b.to === 'p09'));
  assert.ok(analysis.addedClaims.some(s => s.includes('相同板型')));
});
