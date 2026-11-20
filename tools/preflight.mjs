// 发卷前检查与发卷。
// 秘书看到的是完整报告：原话、合起来能识别的几处、改写得失、处置建议。
// 评委只收到已核准的匿名卷：不带内部标记、译写备注和原文索引。

import { buildLexicon } from './lexicon.mjs';
import { detectSignals, analyzeVolume } from './identity.mjs';
import { buildReferences } from './references.mjs';
import { tagCriteria, analyzeRewrite, suggestMask } from './technical.mjs';

function bidderLabel(bundle, bid) {
  const portrait = bundle.portraits.find(p => p.id === bid);
  return portrait ? portrait.label : bid;
}

// 拟发材料：同一投标人的在册段落，被新版替换的旧段不再发出。
export function proposedBlocks(bundle, bid) {
  const blocks = bundle.blocks.filter(b => b.bid === bid);
  const superseded = new Set(blocks.filter(b => b.old).map(b => b.old));
  return {
    proposed: blocks.filter(b => !superseded.has(b.id)),
    superseded: [...superseded],
  };
}

function suggestHandling(block, signals, criteriaTags, candidates, lexicon) {
  const hasIdentity = signals.aliases.length > 0 || signals.facts.length > 0;
  if (!hasIdentity) {
    return { action: '可直发', note: '无身份线索；例行设备指称与通用作业约束不遮' };
  }
  const masked = suggestMask(block.text, signals, { allowExperience: criteriaTags.length === 0 });
  const after = detectSignals(masked.text, lexicon);
  const maskedClean = masked.changed && after.aliases.length === 0 && after.facts.length === 0;

  if (criteriaTags.length === 0) {
    if (maskedClean) return { action: '建议泛化改写', text: masked.text, note: '不承载评审条目，泛化即可' };
    return { action: '退回或秘书改写', note: '经历类线索无法机械泛化，需秘书改写' };
  }
  const usable = candidates.filter(c => c.analysis.verdict === '等义可批准' || c.analysis.verdict === '需确认（轻微技术差异）');
  if (usable.length > 0) {
    return { action: '可批准改写', reviewId: usable[0].review.id, note: '候选改写等义性基本成立，秘书批准即可' };
  }
  if (candidates.length > 0) {
    return { action: '退回修订', note: '现有候选存在技术含义丢失或新增主张' };
  }
  if (maskedClean) {
    return { action: '建议泛化改写', text: masked.text, note: '机械泛化未触及技术依据，秘书复核后可批准' };
  }
  return { action: '待补交', note: '隐去身份与保全必评依据难以两全；标明待补交，由主办方索取可以公平比较的材料' };
}

// 发卷前秘书报告：逐段线索、整卷组合、候选改写得失、处置建议。
export function preflightReport(bundle, bid) {
  const lexicon = buildLexicon(bundle.portraits);
  const criteria = bundle['review-criteria'];
  const edges = buildReferences(bundle.blocks);
  const { proposed, superseded } = proposedBlocks(bundle, bid);

  const volume = analyzeVolume(proposed.map(b => ({ id: b.id, text: b.text })), lexicon);

  const items = proposed.map(block => {
    const signals = detectSignals(block.text, lexicon);
    const criteriaTags = tagCriteria(block.text, criteria);
    const reviews = bundle.reviews.filter(r => r.raw === block.id);
    const candidates = reviews.map(review => ({
      review,
      analysis: analyzeRewrite(block, review.candidate, { lexicon, criteria, edges }),
    }));
    const combos = volume.combos.filter(c => c.parts.includes(block.id));
    const suggestion = suggestHandling(block, signals, criteriaTags, candidates, lexicon);
    return { block, signals, criteriaTags, candidates, combos, suggestion };
  });

  // 按建议处置后的整卷复检（批准类候选 + 泛化建议都落实时）。
  const simulated = items.map(item => {
    if (item.suggestion.action === '可批准改写') {
      const chosen = item.candidates.find(c => c.review.id === item.suggestion.reviewId);
      return { id: item.block.id, text: chosen.review.candidate };
    }
    if (item.suggestion.action === '建议泛化改写') return { id: item.block.id, text: item.suggestion.text };
    const approved = item.candidates.find(c => c.review.category === '批准');
    if (approved) return { id: item.block.id, text: approved.review.candidate };
    return { id: item.block.id, text: item.block.text };
  });
  const afterSuggestions = analyzeVolume(simulated, lexicon);

  return {
    bid,
    label: bidderLabel(bundle, bid),
    proposed: proposed.map(b => b.id),
    superseded,
    identified: volume.identified,
    identifiedLabel: volume.identified ? bidderLabel(bundle, volume.identified) : null,
    combos: volume.combos,
    conflict: volume.conflict,
    weak: volume.weak,
    items,
    afterSuggestions: { identified: afterSuggestions.identified, combos: afterSuggestions.combos },
  };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 评委卷安全闸：不得带出内部编号、画像指称、批注；文字再做一次身份复检。
export function assertReviewerSafe(packet, bundle) {
  const json = JSON.stringify(packet);
  const forbidden = [
    ...bundle.blocks.map(b => b.id),
    ...bundle.portraits.map(p => p.id),
    ...bundle.reviews.map(r => r.id),
  ];
  for (const token of forbidden) {
    if (new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(token)}([^A-Za-z0-9]|$)`).test(json)) {
      throw new Error(`评委卷泄露内部标记：${token}`);
    }
  }
  const lexicon = buildLexicon(bundle.portraits);
  const material = Object.values(packet.material).join('\n');
  const signals = detectSignals(material, lexicon);
  if (signals.aliases.length > 0) {
    throw new Error(`评委卷仍含直接称呼：${signals.aliases.map(a => a.term).join('、')}`);
  }
  const volume = analyzeVolume(
    Object.entries(packet.material).map(([anchor, text]) => ({ id: anchor, text })),
    lexicon,
  );
  if (volume.identified) {
    throw new Error(`评委卷整卷组合仍指向 ${bidderLabel(bundle, volume.identified)}`);
  }
  for (const citation of packet.citations ?? []) {
    if (!Object.hasOwn(packet.material, citation.from) || !Object.hasOwn(packet.material, citation.to)) {
      throw new Error(`评委卷引用落空：${citation.from} → ${citation.to}`);
    }
  }
}

// 组装评委卷与秘书映射。decisions: { rewrites: {blockId: text}, defer: [blockId] }。
// 秘书登记为「批准」的候选改写自动采用；待补交的段落不进卷，登记在秘书端。
export function buildPacket(bundle, bid, decisions = {}) {
  const report = preflightReport(bundle, bid);
  const lexicon = buildLexicon(bundle.portraits);
  const edges = buildReferences(bundle.blocks);
  const criteria = bundle['review-criteria'];

  const finalTexts = new Map();
  const applied = [];
  const unresolved = [];
  const deferred = new Set(decisions.defer ?? []);
  for (const item of report.items) {
    if (deferred.has(item.block.id)) continue;
    let text = null;
    let source = null;
    let reviewId = null;
    if (decisions.rewrites && Object.hasOwn(decisions.rewrites, item.block.id)) {
      text = decisions.rewrites[item.block.id];
      source = '秘书决定';
    } else {
      const approved = item.candidates.find(c => c.review.category === '批准');
      if (approved) {
        text = approved.review.candidate;
        source = `已批准候选 ${approved.review.id}`;
        reviewId = approved.review.id;
      } else if (item.suggestion.action === '可直发') {
        text = item.block.text;
        source = '无身份线索';
      }
    }
    if (text === null) {
      unresolved.push({ id: item.block.id, suggestion: item.suggestion });
    } else {
      finalTexts.set(item.block.id, text);
      applied.push({ id: item.block.id, source, reviewId });
    }
  }
  if (unresolved.length > 0) {
    const list = unresolved.map(u => `${u.id}（${u.suggestion.action}）`).join('、');
    throw new Error(`存在未处置段落，不得发卷：${list}`);
  }

  const volume = analyzeVolume([...finalTexts].map(([id, text]) => ({ id, text })), lexicon);
  if (volume.identified || volume.parts.some(p => p.aliases.length > 0)) {
    throw new Error(`整卷复检未通过：仍指向 ${volume.identified ?? '（直接称呼）'}`);
  }

  const usedCount = bundle.dispatch.length;
  const packetId = `issue-${String.fromCharCode(65 + usedCount)}`;
  const ordered = report.items.filter(item => finalTexts.has(item.block.id));
  const links = {};
  const material = {};
  const anchorOf = {};
  ordered.forEach((item, index) => {
    const anchor = `${packetId.slice(-1)}.${index + 1}`;
    anchorOf[item.block.id] = anchor;
    links[anchor] = item.block.id;
    material[anchor] = finalTexts.get(item.block.id);
  });

  const citations = [];
  const warnings = [];
  for (const edge of edges) {
    if (!Object.hasOwn(anchorOf, edge.from)) continue;
    if (Object.hasOwn(anchorOf, edge.to)) {
      citations.push({ from: anchorOf[edge.from], to: anchorOf[edge.to], phrase: edge.phrase });
    } else {
      warnings.push(`引用未随卷发出：${edge.from} 的「${edge.phrase}」指向 ${edge.to}（被替换或待补交）`);
    }
  }

  const packet = { id: packetId, material, citations };
  assertReviewerSafe(packet, bundle);

  const mapping = {
    packet: packetId,
    bid,
    links,
    rewrites: applied
      .filter(a => a.source !== '无身份线索')
      .map(a => {
        const review = a.reviewId ? bundle.reviews.find(r => r.id === a.reviewId) : null;
        return { anchor: anchorOf[a.id], block: a.id, source: a.source, note: review ? review.note : null };
      }),
    deferred: [...deferred].map(id => {
      const item = report.items.find(i => i.block.id === id);
      return {
        block: id,
        criteria: item ? item.criteriaTags.map(t => t.criterion) : [],
        note: '待补交：由主办方索取可以公平比较的材料，不记零分',
      };
    }),
    warnings,
    weakSignals: volume.weak,
  };
  return { packet, mapping };
}

// 秘书端追查：从匿名卷的同一处追到原文、遮改理由和批准记录。
// 旧评分只按它实际引用的卷次追查，后续替换只作提示、不改归属。
export function secretaryTrace(bundle, packetId, anchor, extraMappings = []) {
  const generated = extraMappings.find(m => m.packet === packetId);
  const links = generated ? generated.links : (bundle.dispatch.find(d => d.id === packetId) ?? {}).links;
  if (!links || !Object.hasOwn(links, anchor)) {
    throw new Error(`找不到卷次 ${packetId} 的 ${anchor}`);
  }
  const blockId = links[anchor];
  const block = bundle.blocks.find(b => b.id === blockId);
  const packet = bundle.dispatch.find(d => d.id === packetId);
  const reviews = bundle.reviews.filter(r => r.raw === blockId);
  const supersededBy = bundle.blocks.find(b => b.old === blockId);
  return {
    packet: packetId,
    anchor,
    发出文字: generated ? null : (packet?.material[anchor] ?? null),
    原稿编号: blockId,
    原文: block.text,
    遮改记录: reviews.map(r => ({ 编号: r.id, 类别: r.category, 候选改写: r.candidate, 备注: r.note })),
    后续替换: supersededBy ? { 编号: supersededBy.id, 提示: '仅供追查，旧评分归属不变' } : null,
  };
}
