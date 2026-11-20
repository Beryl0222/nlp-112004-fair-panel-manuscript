// 稿内引用关系：把简称、表格标题、图注与正文指代连成图。
// 用于三件事：身份线索随指代归属、技术依据换页（旧版被替换）、
// 以及评审端匿名卷内引用落到准确段落。

export function buildReferences(blocks) {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const byBid = new Map();
  for (const block of blocks) {
    if (!byBid.has(block.bid)) byBid.set(block.bid, []);
    byBid.get(block.bid).push(block);
  }
  for (const list of byBid.values()) {
    list.sort((x, y) => Number(x.edition) - Number(y.edition) || blocks.indexOf(x) - blocks.indexOf(y));
  }

  const edges = [];
  const add = (from, to, kind, phrase) => {
    if (!to || from.id === to.id) return;
    if (edges.some(e => e.from === from.id && e.to === to.id && e.kind === kind)) return;
    edges.push({ from: from.id, to: to.id, kind, phrase });
  };

  for (const list of byBid.values()) {
    for (let i = 0; i < list.length; i += 1) {
      const block = list[i];
      const text = block.text;
      for (const m of text.matchAll(/表\s*([A-Za-z])/g)) {
        const anchor = `表${m[1].toUpperCase()}`;
        const target = [...list].reverse().find(b => b.anchor === anchor && Number(b.edition) <= Number(block.edition))
          ?? list.find(b => b.anchor === anchor);
        add(block, target, '表格', m[0]);
      }
      for (const m of text.matchAll(/图\s*(\d+)/g)) {
        const target = list.find(b => b.anchor === `图${m[1]}说明`) ?? list.find(b => b.anchor === `图${m[1]}`);
        add(block, target, '图', m[0]);
      }
      for (const m of text.matchAll(/§\s*(\d+)/g)) {
        add(block, list.find(b => b.anchor === `§${m[1]}`), '章节', m[0]);
      }
      if (/前一节|上一节/.test(text) && i > 0) add(block, list[i - 1], '前节', '前一节');
      if (/上一版|前一版/.test(text)) {
        const target = (block.old ? byId.get(block.old) : null)
          ?? list.find(b => b.anchor === block.anchor && Number(b.edition) === Number(block.edition) - 1);
        add(block, target, '旧版', '上一版');
      }
      if (/前文/.test(text)) {
        for (let j = 0; j < i; j += 1) {
          if (Number(list[j].edition) <= Number(block.edition)) add(block, list[j], '前文', '前文');
        }
      }
      const see = text.match(/详见[^。；]*说明/);
      if (see) {
        for (const other of list) {
          if (other.kind === '说明' && other.id !== block.id) add(block, other, '详见', see[0]);
        }
      }
    }
  }
  return edges;
}

// 改写稿是否还保留这条引用说法。
export function referenceSurvives(edge, text) {
  switch (edge.kind) {
    case '表格': return /表\s*[A-Za-z]/.test(text);
    case '图': return /图\s*\d/.test(text);
    case '章节': return /§\s*\d/.test(text);
    case '前节': return /前一节|上一节/.test(text);
    case '旧版': return /上一版|前一版/.test(text);
    case '前文': return /前文/.test(text);
    case '详见': return /详见|说明/.test(text);
    default: return true;
  }
}
