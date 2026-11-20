// 技术依据标注与改写得失分析。
// 评审条目（review-criteria）是正式依据；这里把每段文字挂到条目上，
// 并抽取量程、限量、限定词等技术 token，比较原文与候选改写的差异。

import { normalizeForMatch, toHalfWidth, findEquipment, bigrams, commonRuns } from './lexicon.mjs';
import { detectSignals } from './identity.mjs';
import { referenceSurvives } from './references.mjs';

// 条目关键词是秘书业务配置：条目正文里的可判断条件对应到文字特征。
export const CRITERION_KEYWORDS = {
  t1: ['坡型', '坡度', '湿坡', '支沟', '坡面', '试验范围', '适用'],
  t2: ['量程', '读数', '有效范围', '范围', '设备', '机型', '工装', '上限', '米'],
  t3: ['巡查', '间隔', '复测', '复检', '当班', '避让', '周'],
  t4: ['材料', '试样', '替换', '装夹', '工装', '干燥', '板型'],
};

export function tagCriteria(text, criteria) {
  const tags = [];
  for (const criterion of criteria) {
    const keywords = CRITERION_KEYWORDS[criterion.id] ?? [criterion.item];
    const hits = keywords.filter(k => text.includes(k));
    if (hits.length > 0) tags.push({ criterion: criterion.id, item: criterion.item, hits });
  }
  return tags;
}

const NUMBER = '[零一二三四五六七八九十两半\\d]+(?:\\.\\d+)?';
const RANGE_RE = new RegExp(`${NUMBER}\\s*[–—-]\\s*${NUMBER}\\s*米?`, 'g');
const MEASURE_RE = new RegExp(`${NUMBER}\\s*(?:米|周|度|天|次|列|侧)`, 'g');
const QUALIFIERS = ['仅', '上限', '下限', '有效范围', '同样适用', '重新评议', '当班', '常规', '干燥', '受压', '试用'];

// 技术 token：量程区间、数量+单位、限定词、设备机型。
// 区间内部的数量（如 3–12 米 里的 12 米）不重复计入。
export function technicalTokens(text) {
  const source = toHalfWidth(text);
  const tokens = new Set();
  const masked = source.split('');
  for (const m of source.matchAll(RANGE_RE)) {
    tokens.add(m[0].replace(/\s+/g, ''));
    for (let i = m.index; i < m.index + m[0].length; i += 1) masked[i] = ' ';
  }
  const rest = masked.join('');
  for (const m of rest.matchAll(MEASURE_RE)) tokens.add(m[0].replace(/\s+/g, ''));
  for (const q of QUALIFIERS) if (source.includes(q)) tokens.add(q);
  for (const e of findEquipment(source)) tokens.add(e.name);
  return tokens;
}

function runsOf(text, covered) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    const on = i < text.length && covered[i];
    if (on && start === -1) start = i;
    if (!on && start !== -1) {
      if (i - start >= 2) out.push(text.slice(start, i));
      start = -1;
    }
  }
  return out;
}

// 原文与改写稿的片段级差异：原文被丢掉的连续片段、改写新增的连续片段。
export function diffSpans(original, revised) {
  const a = normalizeForMatch(original);
  const b = normalizeForMatch(revised);
  const gramsB = bigrams(b);
  const coveredA = new Array(a.length).fill(false);
  for (let i = 0; i < a.length - 1; i += 1) {
    if (gramsB.has(a.slice(i, i + 2))) { coveredA[i] = true; coveredA[i + 1] = true; }
  }
  const gramsA = bigrams(a);
  const coveredB = new Array(b.length).fill(false);
  for (let i = 0; i < b.length - 1; i += 1) {
    if (gramsA.has(b.slice(i, i + 2))) { coveredB[i] = true; coveredB[i + 1] = true; }
  }
  return { dropped: runsOf(a, coveredA.map(v => !v)), added: runsOf(b, coveredB.map(v => !v)) };
}

function isIdentitySpan(span, lexicon) {
  const norm = normalizeForMatch(span);
  if (lexicon.aliases.some(a => a.norm && norm.includes(a.norm))) return true;
  return lexicon.facts.some(f => commonRuns(f.norm, norm, 3).length > 0);
}

function isTechnicalSpan(span, criteria) {
  if (technicalTokens(span).size > 0) return true;
  return tagCriteria(span, criteria).length > 0;
}

// 评估一条候选改写：身份是否去净、技术含义丢了多少、有没有新增主张、引用是否断裂。
export function analyzeRewrite(block, candidate, { lexicon, criteria, edges = [] }) {
  const remaining = detectSignals(candidate, lexicon);
  const { dropped, added } = diffSpans(block.text, candidate);
  const tokensBefore = technicalTokens(block.text);
  const tokensAfter = technicalTokens(candidate);
  const lostTokens = [...tokensBefore].filter(t => !tokensAfter.has(t));
  const addedTokens = [...tokensAfter].filter(t => !tokensBefore.has(t));

  const removedIdentity = [];
  const lostTechnical = [];
  for (const span of dropped) {
    const identity = isIdentitySpan(span, lexicon);
    const technical = isTechnicalSpan(span, criteria);
    if (identity) removedIdentity.push(span);
    if (technical && !identity) lostTechnical.push(span);
  }
  // 新增片段只有带技术含义（条目关键词、量值、限定词）才算「新增主张」，
  // 「该队→队伍」这类措辞替换不算。
  const addedClaims = added.filter(span => isTechnicalSpan(span, criteria));
  const brokenReferences = edges.filter(e => e.from === block.id && !referenceSurvives(e, candidate));

  const before = tagCriteria(block.text, criteria).map(t => t.criterion);
  const after = tagCriteria(candidate, criteria).map(t => t.criterion);
  const lostCriteria = before.filter(c => !after.includes(c));

  let verdict = '等义可批准';
  const reasons = [];
  if (remaining.aliases.length > 0 || remaining.facts.length > 0) {
    verdict = '退回（身份未遮净）';
    reasons.push('改写稿仍含身份线索');
  } else if (addedClaims.length > 0 || brokenReferences.length > 0 || lostCriteria.length > 0) {
    verdict = '需修订';
    if (addedClaims.length > 0) reasons.push(`新增主张需核验：${addedClaims.join('、')}`);
    if (brokenReferences.length > 0) reasons.push(`引用断裂：${brokenReferences.map(e => `${e.kind}→${e.to}`).join('、')}`);
    if (lostCriteria.length > 0) reasons.push(`条目覆盖丢失：${lostCriteria.join('、')}`);
  } else if (lostTechnical.length > 0 || lostTokens.length > 0) {
    verdict = '需确认（轻微技术差异）';
    reasons.push('存在限定词或技术片段丢失');
  }

  return {
    verdict,
    reasons,
    removedIdentity,
    lostTechnical,
    lostTokens,
    addedClaims,
    addedTokens,
    brokenReferences: brokenReferences.map(e => ({ kind: e.kind, to: e.to, phrase: e.phrase })),
    lostCriteria,
    remainingSignals: remaining,
  };
}

// 机械泛化建议：别名直接遮；资质类关键语换成「相应资质」。
// 经历类关键语（沟、站、项目等）只有在这段不承载评审条目时才允许机械遮，
// 否则留给秘书改写或标待补交。
export function suggestMask(text, signals, { allowExperience = false } = {}) {
  let out = text;
  const replacements = [];
  for (const alias of signals.aliases) {
    if (out.includes(alias.term)) {
      out = out.replaceAll(alias.term, '〔身份略〕');
      replacements.push([alias.term, '〔身份略〕']);
    }
  }
  for (const fact of signals.facts) {
    for (const run of commonRuns(fact.fact, out, 3)) {
      const qualification = run.endsWith('证');
      if (!qualification && !allowExperience) continue;
      const generic = qualification ? '相应资质' : '〔身份细节略〕';
      if (out.includes(run)) {
        out = out.replaceAll(run, generic);
        replacements.push([run, generic]);
      }
    }
  }
  return { text: out, changed: replacements.length > 0, replacements };
}
