// 发卷后的补遗检查：补遗必须与评审端仍在可读的内容一起查。
// 两类后果：
//  - 补全身份链 → 照发即暴露，须先改写；若已经发出，收回受影响卷次、暂停相关评分提交。
//  - 技术依据换页（如量程更新）→ 找出引用旧依据的评分及失去可比性的结论，其余继续。

import { buildLexicon } from './lexicon.mjs';
import { analyzeVolume } from './identity.mjs';
import { tagCriteria, technicalTokens, suggestMask } from './technical.mjs';

function bidderLabel(bundle, bid) {
  const portrait = bundle.portraits.find(p => p.id === bid);
  return portrait ? portrait.label : bid;
}

function describePart(bundle, partId, lexicon) {
  // partId 形如 p04 或 issue-A@A.1
  const [packetId, anchor] = partId.includes('@') ? partId.split('@') : [null, null];
  const text = packetId
    ? bundle.dispatch.find(d => d.id === packetId)?.material[anchor]
    : bundle.blocks.find(b => b.id === partId)?.text;
  if (!text) return { id: partId, detail: '（找不到文字）' };
  const lex = lexicon ?? buildLexicon(bundle.portraits);
  const { aliases, facts } = analyzeVolume([{ id: partId, text }], lex).parts[0];
  const bits = [
    ...aliases.map(a => `称呼「${a.term}」`),
    ...facts.map(f => `经历「${f.fact}」`),
  ];
  return { id: partId, detail: bits.join('；') || '（无线索）' };
}

// 收回预案：继续使用会暴露身份或新旧证据错配无法修复时启用。
export function withdrawalPlan(bundle, packetIds, reason) {
  const pausedScores = bundle.scores.filter(s => packetIds.includes(s.packet)).map(s => s.id);
  return {
    withdrawn: packetIds,
    reason,
    pausedScores,
    handover: [
      `通知评审端停止使用卷次：${packetIds.join('、')}`,
      '相关评分提交暂停，已给出的分存作草稿',
      '秘书补齐交接：重新匿名核查后再发替换卷次',
      '旧评分仍按它实际引用的卷次在秘书端追查，不得归到新证据',
    ],
  };
}

// 评估补遗。addendumIds 为拟发补遗的原稿编号。
export function assessAddendum(bundle, addendumIds) {
  const lexicon = buildLexicon(bundle.portraits);
  const addenda = addendumIds.map(id => {
    const block = bundle.blocks.find(b => b.id === id);
    if (!block) throw new Error(`找不到补遗 ${id}`);
    return block;
  });

  // 一、身份合并检查：补遗 + 该投标人在评审端仍可读的已发材料。
  let identity = null;
  const byBid = new Map();
  for (const block of addenda) {
    if (!byBid.has(block.bid)) byBid.set(block.bid, []);
    byBid.get(block.bid).push(block);
  }
  for (const [bid, blocks] of byBid) {
    const packets = bundle.dispatch.filter(d => d.bid === bid);
    const readable = packets.flatMap(p => Object.entries(p.material)
      .map(([anchor, text]) => ({ id: `${p.id}@${anchor}`, text })));
    const proposed = blocks.map(b => ({ id: b.id, text: b.text }));
    const volume = analyzeVolume([...readable, ...proposed], lexicon);
    if (volume.identified || volume.conflict) {
      const label = volume.identified ? bidderLabel(bundle, volume.identified) : null;
      const comboParts = volume.combos.flatMap(c => c.parts);
      const blockedBlocks = blocks.filter(b => comboParts.includes(b.id)).map(b => b.id);
      const affectedPackets = [...new Set(comboParts.filter(p => p.includes('@')).map(p => p.split('@')[0]))];
      identity = {
        exposed: Boolean(volume.identified),
        identifiedBid: volume.identified,
        label,
        combos: volume.combos.map(c => ({
          parts: c.parts,
          detail: c.parts.map(p => describePart(bundle, p, lexicon)),
        })),
        blockedBlocks,
        suggestions: blockedBlocks.map(id => {
          const block = bundle.blocks.find(b => b.id === id);
          const signals = analyzeVolume([{ id, text: block.text }], lexicon).parts[0];
          const masked = suggestMask(block.text, signals, { allowExperience: true });
          return { block: id, text: masked.changed ? masked.text : null };
        }),
        withdrawalIfDispatched: withdrawalPlan(
          bundle,
          affectedPackets,
          `补遗 ${blockedBlocks.join('、')} 照发将与在评材料合出 ${label ?? '一家'}`,
        ),
      };
    }
  }

  // 二、技术依据换页：补遗替换旧段时，找出引用旧段的评分与受影响的条目。
  const evidence = [];
  const scoreImpacts = [];
  const basisMoves = [];
  for (const block of addenda) {
    if (!block.old) continue;
    const oldBlock = bundle.blocks.find(b => b.id === block.old);
    const lost = [...technicalTokens(oldBlock.text)].filter(t => !technicalTokens(block.text).has(t));
    const added = [...technicalTokens(block.text)].filter(t => !technicalTokens(oldBlock.text).has(t));
    const changedText = [...lost, ...added].join(' ');
    let criteria = tagCriteria(changedText, bundle['review-criteria']).map(t => t.criterion);
    if (criteria.length === 0) criteria = tagCriteria(oldBlock.text, bundle['review-criteria']).map(t => t.criterion);

    const packets = [];
    const scores = [];
    for (const packet of bundle.dispatch) {
      for (const [anchor, blockId] of Object.entries(packet.links)) {
        if (blockId !== oldBlock.id) continue;
        packets.push({ packet: packet.id, anchor });
        for (const score of bundle.scores.filter(s => s.packet === packet.id && s.anchor === anchor)) {
          scores.push(score.id);
          scoreImpacts.push({
            score: score.id,
            status: '草稿（待复评）',
            reason: `实际引用的依据 ${oldBlock.id} 已被补遗 ${block.id} 替换（${lost.join('、') || '—'} → ${added.join('、') || '—'}）`,
          });
        }
        basisMoves.push({
          packet: packet.id,
          anchor,
          fromBlock: oldBlock.id,
          toBlock: block.id,
          criteria,
          note: '技术依据换到新页；旧评分仍挂在原锚点追查',
        });
      }
    }
    evidence.push({ oldBlock: oldBlock.id, newBlock: block.id, changed: { lost, added }, criteria, packets, scores });
  }

  const impacted = new Set(scoreImpacts.map(s => s.score));
  const continueScores = bundle.scores.filter(s => !impacted.has(s.id)).map(s => s.id);

  const handover = [];
  if (identity?.exposed) {
    handover.push(`补遗 ${identity.blockedBlocks.join('、')} 照发将暴露 ${identity.label}，须先按建议改写再发`);
    handover.push('若已经发出：' + identity.withdrawalIfDispatched.handover.join('；'));
  }
  for (const move of basisMoves) {
    handover.push(`${move.packet} 的 ${move.anchor} 依据已换页（${move.fromBlock}→${move.toBlock}），发新页并登记替代关系`);
  }
  for (const impact of scoreImpacts) {
    handover.push(`评分 ${impact.score} 转草稿待复评；同条目结论暂缓宣布`);
  }

  return { addenda: addendumIds, identity, evidence, scoreImpacts, continueScores, basisMoves, handover };
}
