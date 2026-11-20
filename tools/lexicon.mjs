// 词表与归一化：秘书画像别名、经历事实、例行设备指称。
// 约定（见 README）：机型专名是例行设备指称，不自动算作公司身份；
// 画像 facts 是秘书可用的有限公开资料，缺项不等于该属性被证实不存在。

export function toHalfWidth(text) {
  return String(text).normalize('NFKC');
}

// 匹配用归一化：去掉标点、空白和破折号，只留汉字与字母数字。
export function normalizeForMatch(text) {
  return toHalfWidth(text).replace(/[^\p{Script=Han}A-Za-z0-9]/gu, '').toLowerCase();
}

export function bigrams(text) {
  const grams = new Set();
  for (let i = 0; i < text.length - 1; i += 1) grams.add(text.slice(i, i + 2));
  return grams;
}

// 设备机型写法，如「东脊 D-3」。
const EQUIPMENT_PATTERN = /([\p{Script=Han}]{1,8})\s*([A-Za-z]\s*-\s*\d+(?:\.\d+)?)/gu;

export function findEquipment(text) {
  const source = toHalfWidth(text);
  const found = [];
  for (const match of source.matchAll(EQUIPMENT_PATTERN)) {
    found.push({ name: `${match[1]} ${match[2].replace(/\s+/g, '')}` });
  }
  return found;
}

// 由秘书保管的画像构建词表：别名（直接称呼）与经历事实（组合线索）。
// 内容相同的事实（多家共有经历）合并为一条，候选集为全部拥有者。
export function buildLexicon(portraits) {
  const aliases = [];
  const factIndex = new Map();
  for (const portrait of portraits) {
    for (const term of [portrait.label, ...portrait.aliases]) {
      aliases.push({ term, norm: normalizeForMatch(term), bid: portrait.id, label: portrait.label });
    }
    for (const fact of portrait.facts) {
      const norm = normalizeForMatch(fact);
      if (!factIndex.has(norm)) {
        factIndex.set(norm, { text: fact, norm, grams: bigrams(norm), bids: new Set() });
      }
      factIndex.get(norm).bids.add(portrait.id);
    }
  }
  aliases.sort((a, b) => b.norm.length - a.norm.length);
  return { aliases, facts: [...factIndex.values()] };
}

// 经历事实命中：原文二元组覆盖率超过阈值才算同一段经历，
// 避免「常规」「使用」这类泛词把例行文字误判成画像事实。
export function matchFacts(text, lexicon, { threshold = 0.4, minHits = 3 } = {}) {
  const norm = normalizeForMatch(text);
  const matches = [];
  for (const fact of lexicon.facts) {
    if (fact.grams.size === 0) continue;
    const hits = [...fact.grams].filter(g => norm.includes(g));
    const coverage = hits.length / fact.grams.size;
    if (hits.length >= minHits && coverage >= threshold) {
      matches.push({ fact: fact.text, bids: [...fact.bids].sort(), coverage: Number(coverage.toFixed(3)) });
    }
  }
  return matches;
}

export function matchAliases(text, lexicon) {
  const norm = normalizeForMatch(text);
  const found = [];
  const seen = new Set();
  for (const alias of lexicon.aliases) {
    if (!alias.norm || !norm.includes(alias.norm)) continue;
    const key = `${alias.bid}:${alias.norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ term: alias.term, bid: alias.bid, label: alias.label });
  }
  return found;
}

// 两段文字的公共片段（按二元组聚成连续串），用于定位经历/资质的关键语。
export function commonRuns(a, b, minLength = 2) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  const gramsB = bigrams(nb);
  const covered = new Array(na.length).fill(false);
  for (let i = 0; i < na.length - 1; i += 1) {
    if (gramsB.has(na.slice(i, i + 2))) {
      covered[i] = true;
      covered[i + 1] = true;
    }
  }
  const runs = [];
  let start = -1;
  for (let i = 0; i <= na.length; i += 1) {
    const on = i < na.length && covered[i];
    if (on && start === -1) start = i;
    if (!on && start !== -1) {
      if (i - start >= minLength) runs.push(na.slice(start, i));
      start = -1;
    }
  }
  return runs;
}
