import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBundle, readCollection } from '../tools/materials.mjs';

test('接件资料包含原文和原始记录', () => {
  const bundle = readBundle();
  const excerpts = [["blocks", "p04", "斜坡检修乙证"], ["blocks", "p05", "3–10 米"], ["scores", "s1", "采样区间"]];
  for (const [group, id, phrase] of excerpts) {
    const entry = bundle[group].find(row => row.id === id);
    assert.ok(entry, `${group}/${id} 缺少来件`);
    if (phrase) assert.ok(Object.values(entry).some(value => typeof value === 'string' && value.includes(phrase)), `${group}/${id} 的源文字缺少约定片段`);
  }
});

test('拒绝缺少正式字段的接件', t => {
  const directory = mkdtempSync(join(tmpdir(), 'fair-panel-manuscript-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'portraits.json'), JSON.stringify([{ id: 'bad' }]));
  assert.throws(() => readCollection('portraits', pathToFileURL(directory + sep)), TypeError);
});

test('实际评分锚点能在原匿名发卷清单与发出文字中找到', () => {
  const { blocks, dispatch, scores } = readBundle();
  const original = new Set(blocks.map(block => block.id));
  for (const { packet, anchor } of scores) {
    const issue = dispatch.find(row => row.id === packet);
    assert.ok(original.has(issue.links[anchor]));
    assert.ok(issue.material[anchor].trim());
  }
});
