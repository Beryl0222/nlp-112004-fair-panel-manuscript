// 评分台账：旧评分只按它实际引用的卷次追查，禁止归到新证据。
// 同一条目里有卷暂缺可评依据时，已给出的分存作草稿，但不得就可比的一半宣布排序。

import { tagCriteria, technicalTokens } from './technical.mjs';

// 评分状态：有效 / 草稿（待复评）/ 暂停（卷已收回）。
export function scoreStatuses(bundle, impacts = null) {
  const drafts = new Map((impacts?.scoreImpacts ?? []).map(i => [i.score, i]));
  const withdrawn = new Set(impacts?.withdrawn ?? []);
  return bundle.scores.map(score => {
    let status = '有效';
    let reason = null;
    if (withdrawn.has(score.packet)) {
      status = '暂停（卷已收回）';
      reason = '所在卷次已收回，暂停相关评分提交';
    } else if (drafts.has(score.id)) {
      status = drafts.get(score.id).status;
      reason = drafts.get(score.id).reason;
    }
    return { id: score.id, packet: score.packet, criterion: score.criterion, status, reason };
  });
}

// 追查一条评分：落到实际引用的卷次与锚点，追到原稿文字。
// 后续补遗只作提示列出，评分的归属不变。
export function traceScore(bundle, scoreId, impacts = null) {
  const score = bundle.scores.find(s => s.id === scoreId);
  if (!score) throw new Error(`找不到评分 ${scoreId}`);
  const packet = bundle.dispatch.find(d => d.id === score.packet);
  if (!packet) throw new Error(`评分 ${scoreId} 引用的卷次 ${score.packet} 不在发卷清单`);
  const blockId = packet.links[score.anchor];
  const block = bundle.blocks.find(b => b.id === blockId);
  const supersededBy = bundle.blocks.find(b => b.old === blockId);
  const status = scoreStatuses(bundle, impacts).find(s => s.id === scoreId);
  return {
    score: score.id,
    criterion: score.criterion,
    points: score.points,
    packet: packet.id,
    anchor: score.anchor,
    发出文字: packet.material[score.anchor],
    实际引用原稿: blockId,
    原稿文字: block.text,
    实际引用量程: [...technicalTokens(block.text)],
    后续替换: supersededBy ? { 编号: supersededBy.id, 文字: supersededBy.text } : null,
    status: status.status,
    reason: status.reason,
  };
}

// 查分时禁止把旧评分归到新证据：归属必须与发卷清单的链接一致。
export function assertScoreAttribution(bundle, scoreId, blockId) {
  const score = bundle.scores.find(s => s.id === scoreId);
  if (!score) throw new Error(`找不到评分 ${scoreId}`);
  const packet = bundle.dispatch.find(d => d.id === score.packet);
  const actual = packet?.links[score.anchor];
  if (actual !== blockId) {
    throw new Error(`禁止把评分 ${scoreId} 归到新证据 ${blockId}：它实际引用的是 ${actual}`);
  }
  return true;
}

// 同一比较项的可比性：每个在评卷次对该条目是 可评 / 缺依据 / 依据待复评 / 卷已收回。
export function comparability(bundle, criterionId, impacts = null) {
  const criteria = bundle['review-criteria'];
  const replaced = new Map((impacts?.basisMoves ?? []).map(m => [`${m.packet}:${m.anchor}`, m]));
  const withdrawn = new Set(impacts?.withdrawn ?? []);
  const rows = bundle.dispatch.map(packet => {
    const anchors = Object.entries(packet.links)
      .filter(([, blockId]) => {
        const block = bundle.blocks.find(b => b.id === blockId);
        return block && tagCriteria(block.text, criteria).some(t => t.criterion === criterionId);
      })
      .map(([anchor]) => anchor);
    let state;
    if (withdrawn.has(packet.id)) state = '卷已收回';
    else if (anchors.length === 0) state = '缺依据（待补材料，不记零分）';
    else if (anchors.some(a => replaced.has(`${packet.id}:${a}`))) state = '依据待复评';
    else state = '可评';
    return { packet: packet.id, anchors, state };
  });
  return { criterion: criterionId, rows };
}

// 宣布排序的闸门：任何一卷缺可评依据、依据待复评、被收回，或评分未齐，都不得宣布。
export function announceRanking(bundle, criterionId, impacts = null) {
  const { rows } = comparability(bundle, criterionId, impacts);
  const statuses = scoreStatuses(bundle, impacts);
  const reasons = [];
  const drafts = [];
  for (const row of rows) {
    if (row.state !== '可评') {
      reasons.push(`${row.packet}：${row.state}`);
      continue;
    }
    const scores = statuses.filter(s => s.packet === row.packet && s.criterion === criterionId);
    if (scores.length === 0) {
      reasons.push(`${row.packet}：该条目评分未齐`);
    }
    for (const score of scores) {
      if (score.status !== '有效') {
        reasons.push(`${row.packet}：评分 ${score.id} 为${score.status}`);
        drafts.push(score.id);
      }
    }
  }
  return { criterion: criterionId, 可宣布: reasons.length === 0, 原因: reasons, 草稿: drafts };
}
