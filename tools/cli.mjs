// 命令行入口：
//   node tools/cli.mjs review [bid]           发卷前秘书检查报告
//   node tools/cli.mjs export <bid> [决定.json]  组装评委卷（含安全闸）与秘书映射
//   node tools/cli.mjs addendum [id ...]      补遗与在评可读内容合并检查（默认 p04 p05）
//   node tools/cli.mjs scores                 评分台账追查
//   node tools/cli.mjs ranking <条目>          尝试宣布排序（演示闸门）
//   node tools/cli.mjs trace <卷次> <锚点>     秘书端从匿名卷一处追到原文与遮改记录

import { readFileSync } from 'node:fs';
import { readBundle } from './materials.mjs';
import { preflightReport, buildPacket, secretaryTrace } from './preflight.mjs';
import { assessAddendum } from './addendum.mjs';
import { traceScore, scoreStatuses, announceRanking } from './scores.mjs';

const bundle = readBundle();
const [command, ...args] = process.argv.slice(2);

function line(s = '') {
  console.log(s);
}

function showReport(report) {
  line(`=== 发卷前匿名检查：${report.label}（${report.bid}） ===`);
  line(`拟发 ${report.proposed.length} 段：${report.proposed.join('、')}` +
    (report.superseded.length ? `；被新版替换不发出：${report.superseded.join('、')}` : ''));
  if (report.identified) {
    line(`整卷结论：不可发卷 —— 线索组合指向 ${report.identifiedLabel}`);
    for (const combo of report.combos) line(`  组合：${combo.parts.join(' + ')}`);
  } else if (report.conflict) {
    line('整卷结论：线索互相矛盾，疑似混入他家材料，退回核查');
  } else {
    line('整卷结论：未指向单一投标方' + (report.weak.length ? `（弱线索 ${report.weak.map(w => `${w.id}→${w.candidates.join('/')}`).join('；')}，已记录）` : ''));
  }
  for (const item of report.items) {
    const { block, signals, criteriaTags, candidates, combos, suggestion } = item;
    const hasIdentity = signals.aliases.length > 0 || signals.facts.length > 0;
    const tag = hasIdentity
      ? (criteriaTags.length ? '身份+技术冲突' : '身份线索')
      : '无身份线索';
    line();
    line(`▶ ${block.id} ${block.anchor} ${block.kind}【${tag}】`);
    line(`  原话：${block.text}`);
    for (const a of signals.aliases) line(`  直接称呼：「${a.term}」→ ${a.label}`);
    for (const f of signals.facts) {
      const names = f.bids.map(b => bundle.portraits.find(p => p.id === b)?.label ?? b);
      line(`  经历线索：「${f.fact}」→ 在册候选 ${names.join('、')}`);
    }
    for (const e of signals.equipment) line(`  例行设备指称（不计身份）：${e.name}`);
    for (const combo of combos) {
      const partners = combo.parts.filter(p => p !== block.id);
      line(partners.length
        ? `  与哪几处合起来能识别：${partners.join('、')} → 合出一家`
        : '  本段单独即可识别一家');
    }
    if (criteriaTags.length) line(`  技术依据：${criteriaTags.map(t => `${t.criterion} ${t.item}`).join('；')}`);
    for (const { review, analysis } of candidates) {
      line(`  候选改写 ${review.id}（${review.category}）：${review.candidate}`);
      if (analysis.removedIdentity.length) line(`    已去身份：${analysis.removedIdentity.join('、')}`);
      if (analysis.lostTechnical.length) line(`    可能丢失：${analysis.lostTechnical.join('、')}`);
      if (analysis.lostTokens.length) line(`    限定词/量值丢失：${analysis.lostTokens.join('、')}`);
      if (analysis.addedClaims.length) line(`    新增主张（需核验）：${analysis.addedClaims.join('、')}`);
      if (analysis.brokenReferences.length) line(`    引用断裂：${analysis.brokenReferences.map(b => `${b.kind}→${b.to}`).join('、')}`);
      line(`    工具结论：${analysis.verdict}${analysis.reasons.length ? `（${analysis.reasons.join('；')}）` : ''}`);
      line(`    秘书备注：${review.note}`);
    }
    line(`  处置建议：${suggestion.action}${suggestion.text ? ` → ${suggestion.text}` : ''}（${suggestion.note}）`);
  }
  line();
  line(`按建议处置后整卷复检：${report.afterSuggestions.identified ? `仍指向 ${report.afterSuggestions.identified}` : '不再指向单一投标方'}`);
}

function showAddendum(result) {
  line(`=== 补遗合并检查：${result.addenda.join('、')} ===`);
  if (result.identity?.exposed) {
    const { identity } = result;
    line(`身份：补遗与在评可读内容合出 ${identity.label}，照发即暴露`);
    for (const combo of identity.combos) {
      line(`  组合：${combo.parts.join(' + ')}`);
      for (const d of combo.detail) line(`    ${d.id}：${d.detail}`);
    }
    for (const s of identity.suggestions) {
      if (s.text) line(`  建议改写 ${s.block}：${s.text}`);
    }
    line(`  若已发出须收回：${result.identity.withdrawalIfDispatched.withdrawn.join('、')}，暂停评分 ${result.identity.withdrawalIfDispatched.pausedScores.join('、') || '（无）'}`);
  } else {
    line('身份：与在评可读内容合并后未指向单一投标方');
  }
  for (const ev of result.evidence) {
    line(`依据换页：${ev.oldBlock} → ${ev.newBlock}（丢失 ${ev.changed.lost.join('、') || '—'}；新增 ${ev.changed.added.join('、') || '—'}）`);
    line(`  受影响条目：${ev.criteria.join('、') || '—'}；引用旧依据的评分：${ev.scores.join('、') || '无'}`);
  }
  if (result.scoreImpacts.length) {
    line('转草稿待复评：');
    for (const impact of result.scoreImpacts) line(`  ${impact.score}：${impact.reason}`);
  }
  line(`可继续的评分：${result.continueScores.join('、') || '无'}`);
  if (result.handover.length) {
    line('秘书交接：');
    for (const task of result.handover) line(`  - ${task}`);
  }
}

try {
  if (command === 'review') {
    const bids = args.length ? args : [...new Set(bundle.blocks.map(b => b.bid))];
    for (const bid of bids) showReport(preflightReport(bundle, bid));
  } else if (command === 'export') {
    const [bid, decisionsPath] = args;
    const decisions = decisionsPath ? JSON.parse(readFileSync(decisionsPath, 'utf8')) : {};
    const { packet, mapping } = buildPacket(bundle, bid, decisions);
    line('--- 评委卷（可发出，已过安全闸） ---');
    line(JSON.stringify(packet, null, 2));
    line('--- 秘书映射（不得随卷发出） ---');
    line(JSON.stringify(mapping, null, 2));
  } else if (command === 'addendum') {
    showAddendum(assessAddendum(bundle, args.length ? args : ['p04', 'p05']));
  } else if (command === 'scores') {
    const impacts = assessAddendum(bundle, ['p04', 'p05']);
    line('=== 评分台账（按实际引用卷次追查） ===');
    for (const status of scoreStatuses(bundle, impacts)) {
      const trace = traceScore(bundle, status.id, impacts);
      line(`${trace.score}［${trace.status}］ ${trace.packet} ${trace.anchor} → 原稿 ${trace.实际引用原稿}`);
      line(`  发出文字：${trace.发出文字}`);
      line(`  原稿文字：${trace.原稿文字}`);
      if (trace.后续替换) line(`  后续补遗 ${trace.后续替换.编号}：${trace.后续替换.文字}（仅提示，归属不变）`);
      if (trace.reason) line(`  原因：${trace.reason}`);
    }
  } else if (command === 'ranking') {
    const impacts = assessAddendum(bundle, ['p04', 'p05']);
    const result = announceRanking(bundle, args[0], impacts);
    line(result.可宣布 ? '可以宣布排序' : `不得宣布排序：${result.原因.join('；')}`);
    if (result.草稿.length) line(`已给出的分存作草稿：${result.草稿.join('、')}`);
  } else if (command === 'trace') {
    line(JSON.stringify(secretaryTrace(bundle, args[0], args[1]), null, 2));
  } else {
    line('用法：review [bid] | export <bid> [决定.json] | addendum [id ...] | scores | ranking <条目> | trace <卷次> <锚点>');
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(`错误：${error.message}`);
  process.exitCode = 1;
}
