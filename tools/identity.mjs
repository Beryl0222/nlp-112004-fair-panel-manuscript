// 身份线索检测与整卷组合分析。
// 直接称呼（别名）与经历事实各自给出候选集；块内、卷内取交集，
// 交集收缩到一家即构成「指向一家」的组合，并给出最小组合便于秘书核对。

import { matchAliases, matchFacts, findEquipment } from './lexicon.mjs';

function intersect(a, b) {
  const out = new Set();
  for (const v of a) if (b.has(v)) out.add(v);
  return out;
}

// 单段文字的线索：别名、经历事实、例行设备指称，以及块内候选交集。
export function detectSignals(text, lexicon) {
  const aliases = matchAliases(text, lexicon);
  const facts = matchFacts(text, lexicon);
  const equipment = findEquipment(text);
  let candidates = null;
  const narrow = set => {
    const next = set instanceof Set ? set : new Set(set);
    candidates = candidates === null ? next : intersect(candidates, next);
  };
  for (const alias of aliases) narrow([alias.bid]);
  for (const fact of facts) narrow(fact.bids);
  return { aliases, facts, equipment, candidates: candidates ? [...candidates].sort() : null };
}

function* combinations(n, size, start = 0, prefix = []) {
  if (prefix.length === size) {
    yield prefix;
    return;
  }
  for (let i = start; i < n; i += 1) {
    yield* combinations(n, size, i + 1, [...prefix, i]);
  }
}

// 整卷识别：所有线索取交集；交集为一家时给出最小线索组合。
// 交集为空说明卷内线索互相矛盾（可能混入他家材料），单独标出。
export function identify(signalSets) {
  if (signalSets.length === 0) return { identified: null, candidates: [], combos: [], conflict: false };
  let all = null;
  for (const { set } of signalSets) all = all === null ? new Set(set) : intersect(all, set);
  const candidates = [...all].sort();
  const combos = [];
  for (let size = 1; size <= signalSets.length; size += 1) {
    let found = false;
    for (const idxs of combinations(signalSets.length, size)) {
      if (combos.some(combo => combo.indices.every(i => idxs.includes(i)))) continue;
      let inter = null;
      for (const i of idxs) inter = inter === null ? new Set(signalSets[i].set) : intersect(inter, signalSets[i].set);
      if (inter.size === 1) {
        combos.push({ indices: idxs, parts: idxs.map(i => signalSets[i].id), pointsTo: [...inter][0] });
        found = true;
      }
    }
    if (found) break;
  }
  return {
    identified: candidates.length === 1 ? candidates[0] : null,
    candidates,
    combos,
    conflict: candidates.length === 0,
  };
}

// 一组段落（编号 + 文字）的整卷分析。parts: [{ id, text }]。
export function analyzeVolume(parts, lexicon) {
  const details = parts.map(part => ({ id: part.id, ...detectSignals(part.text, lexicon) }));
  const bearing = details.filter(d => d.aliases.length > 0 || d.facts.length > 0);
  const result = identify(bearing.map(d => ({ id: d.id, set: new Set(d.candidates) })));
  const weak = bearing.filter(d => d.candidates && d.candidates.length >= 2)
    .map(d => ({ id: d.id, candidates: d.candidates }));
  return { parts: details, weak, ...result };
}
