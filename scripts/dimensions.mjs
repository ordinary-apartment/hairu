// Only explicitly labelled outer dimensions are eligible. No estimates or tag ranges.
export function plainText(value) {
  return String(value ?? '').normalize('NFKC').replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot);/g, token => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' })[token])
    .replace(/\s+/g, ' ').trim();
}

const num = '(\\d+(?:\\.\\d+)?)';
const unit = '\\s*(cm|mm)?';
const gap = '\\s*(?:[×xX*,、/]|・)?\\s*';
const approx = '(?:[約:：\\s]|\\(約\\))*';
const axes = [
  new RegExp(`(?:幅|横幅|W)${approx}${num}${unit}${gap}(?:奥行き?|D)${approx}${num}${unit}${gap}(?:高さ|H)${approx}${num}\\s*\\(?(cm|mm)\\)?`, 'gi'),
];
const positive = /本体(?:外寸|寸法|サイズ)|外(?:形寸法|寸)|商品(?:サイズ|寸法)|製品(?:サイズ|寸法)/g;
const negative = /内寸|内側|収納部|引き出し|引出し|扉内|棚板|梱包|包装|パッケージ|箱サイズ|箱寸法|脚(?:部|元)|天板|開口|有効|座面/g;

// Separate, exclusion-only evidence. A minimum across explicit options is a
// lower bound, never a claim that an incomplete/variant product fits the space.
export function extractDimensionEvidence(itemName, itemCaption, catchcopy = '') {
  const records = [];
  const blocked = new Set();
  const number = '\\d+(?:\\.\\d+)?';
  const value = `${number}\\s*(?:cm|mm)?`;
  const pattern = new RegExp(`(横幅|幅|奥行き?|高さ|W|D|H)${approx}(${value}(?:\\s*[/〜~～-]\\s*${value})*)(?:\\s*\\((cm|mm)\\))?`, 'gi');
  const keys = { 幅: 'width', 横幅: 'width', 奥行: 'depth', 奥行き: 'depth', 高さ: 'height', w: 'width', d: 'depth', h: 'height' };
  const captionGroups = new Map();
  const optionBlocked = new Map();
  function blockAxis(key, group) {
    blocked.add(key);
    if (group != null) {
      if (!captionGroups.has(group)) captionGroups.set(group, new Set());
      if (!optionBlocked.has(group)) optionBlocked.set(group, new Set());
      optionBlocked.get(group).add(key);
    }
  }
  let unspecifiedSizeOptions = false;
  for (const [source, raw] of [['商品名', itemName], ['キャッチコピー', catchcopy], ['商品説明', itemCaption]]) {
    const text = plainText(raw);
    if (/サイズ選択|サイズが選べる|選べるサイズ|サイズ(?:を|が)?選べる|[2-9]サイズ/.test(text)) unspecifiedSizeOptions = true;
    for (const unknown of text.matchAll(/(横幅|幅|奥行き?|高さ|W|D|H)\s*[:約()]*\s*(?:不明|未記載|未定|要確認)/gi)) {
      const before = text.slice(Math.max(0, unknown.index - 100), unknown.index);
      const good = [...before.matchAll(positive)].at(-1);
      const bad = [...before.matchAll(negative)].at(-1);
      if ((!bad || (good && good.index > bad.index)) && (source !== '商品説明' || good)) blockAxis(keys[unknown[1].toLowerCase()], source === '商品説明' ? unknown.index - before.length + good.index : null);
    }
    for (const match of text.matchAll(pattern)) {
      const key = keys[match[1].toLowerCase()];
      const before = text.slice(Math.max(0, match.index - 100), match.index);
      const good = [...before.matchAll(positive)].at(-1);
      const bad = [...before.matchAll(new RegExp(`${negative.source}|部品|パーツ`, 'g'))].at(-1);
      const goodEnd = good ? good.index + good[0].length : -1;
      const badEnd = bad ? bad.index + bad[0].length : -1;
      if (badEnd > goodEnd) continue;
      if (good && /(?:引き出し|引出し|棚板|梱包|脚部|扉内|収納部|部品|パーツ)\s*$/.test(before.slice(0, good.index))) continue;
      if (source === '商品説明') {
        if (!good) continue;
        // Keep the body-size declaration scope; do not reach through prose or
        // a compatibility statement to borrow a dimension from another object.
        const context = before.slice(goodEnd).replace(/横幅|幅|奥行き?|高さ|cm|mm|[WDH]/gi, '');
        if (!/^[\s\d.:約()×xX、,/・;~～〜-]*$/.test(context)) continue;
      }
      if (/[a-z]/i.test(match[1]) && (/\w$/.test(before) || !/cm|mm/i.test(match[0]))) continue;
      const trailing = text.slice(match.index + match[0].length, match.index + match[0].length + 35);
      const group = source === '商品説明' ? match.index - before.length + good.index : null;
      if (/対応|適応|適合|収納可能|設置可能/.test(before.slice(-18)) || /^\s*(?:以下|以内|未満|以上|まで|に対応|対応)/.test(trailing)) continue;
      // Unsupported option syntax or qualifiers invalidate this axis, rather
      // than silently keeping only the first (possibly oversized) option.
      if (/^\s*[,、・]\s*\d/.test(trailing) || /^\s*[/〜~～-]/.test(trailing) || /^\s*(?:または|又は|と|or)\s*(?:高さ|幅|奥行き?)?\s*\d/i.test(trailing) || /^\s*\([^)]*(?:取手|取っ手|含|除)/.test(trailing)) { blockAxis(key, group); continue; }
      const parsed = [...match[2].matchAll(new RegExp(`(${number})\\s*(cm|mm)?`, 'gi'))];
      const sharedUnit = match[3] || parsed.at(-1)?.[2] || 'cm';
      const values = parsed.map(value => Number(value[1]) / ((value[2] || sharedUnit).toLowerCase() === 'mm' ? 10 : 1));
      if (values.some(value => !Number.isFinite(value) || value <= 0 || value > 100000)) { blockAxis(key, group); continue; }
      const evidence = { source, text: `${source === '商品説明' ? good[0] + ': ' : ''}${match[0].trim()}` };
      records.push({ key, values, evidence, group });
      if (source === '商品説明') {
        if (!captionGroups.has(group)) captionGroups.set(group, new Set());
        captionGroups.get(group).add(key);
      }
    }
  }
  // An explicitly separate body-size option with a missing axis makes the
  // lower bound on that axis unknown, even if another option lists a value.
  if (captionGroups.size > 1) {
    for (const key of ['width', 'depth', 'height']) if ([...captionGroups.values()].some(group => !group.has(key))) blocked.add(key);
  }
  const bounds = {};
  const optionKeys = new Set(['width', 'depth', 'height'].filter(key => new Set(records.filter(record => record.key === key).flatMap(record => record.values)).size > 1));
  const identifiedChoice = /[A-Z]タイプ|タイプ\s*[A-Z]/.test(plainText(itemName)) &&
    ['width', 'depth', 'height'].every(key => new Set(records.filter(record => record.key === key && record.evidence.source === '商品名').flatMap(record => record.values)).size === 1);
  for (const key of ['width', 'depth', 'height']) {
    const matches = records.filter(record => record.key === key);
    if (!matches.length || blocked.has(key)) continue;
    const values = [...new Set(matches.flatMap(record => record.values))].sort((a, b) => a - b);
    if (unspecifiedSizeOptions && !optionKeys.size && !identifiedChoice) continue;
    bounds[key] = { min: values[0], values, evidence: matches.map(record => record.evidence) };
  }
  let dimensionOptions = captionGroups.size > 1 ? [...captionGroups.keys()].map(group => {
    const option = {};
    for (const key of ['width', 'depth', 'height']) {
      if (optionBlocked.get(group)?.has(key)) continue;
      const values = records.filter(record => record.group === group && record.key === key).flatMap(record => record.values);
      if (values.length) option[key] = Math.min(...values);
    }
    return option;
  }) : [];
  const completeOptions = bodyCandidates(itemCaption);
  if (dimensionOptions.length > 1 && completeOptions.length === dimensionOptions.length && !optionBlocked.size) {
    dimensionOptions = completeOptions.map(({ width, depth, height }) => ({ width, depth, height }));
  }
  const outside = {};
  for (const key of ['width', 'depth', 'height']) {
    const values = records.filter(record => record.group == null && record.key === key).flatMap(record => record.values);
    if (values.length) outside[key] = Math.min(...values);
  }
  if (dimensionOptions.length && Object.entries(outside).some(([key, value]) => dimensionOptions.every(option => option[key] != null) && value < Math.min(...dimensionOptions.map(option => option[key])))) dimensionOptions.push(outside);
  return { dimensionBounds: bounds, dimensionOptions };
}

export function extractDimensionBounds(...args) { return extractDimensionEvidence(...args).dimensionBounds; }

function bodyCandidates(itemCaption) {
  // The caption must explicitly identify outer/body dimensions. Titles only detect conflicts.
  const candidates = [];
  for (const [source, raw] of [['商品説明', itemCaption]]) {
    const text = plainText(raw);
    for (const pattern of axes) {
      for (const match of text.matchAll(pattern)) {
        const before = text.slice(Math.max(0, match.index - 65), match.index);
        const good = [...before.matchAll(positive)].at(-1);
        const bad = [...before.matchAll(negative)].at(-1);
        const goodEnd = good ? good.index + good[0].length : -1;
        const badEnd = bad ? bad.index + bad[0].length : -1;
        if (badEnd > goodEnd || (source === '商品説明' && (goodEnd < 0 || before.length - goodEnd > 16))) continue;
        if (good && /(?:引き出し|引出し|棚板|梱包|脚部|扉内|収納部)\s*$/.test(before.slice(0, good.index))) continue;
        const prefix = before.slice(goodEnd >= 0 ? goodEnd : Math.max(0, before.length - 12));
        // Reject variant/range statements and context indicating variable dimensions.
        if (/伸縮|可変|選べる|各サイズ|[〜~]|\d\s*[-/]\s*\d/.test(prefix)) continue;
        const trailing = text.slice(match.index + match[0].length, match.index + match[0].length + 40);
        if (/^\s*(?:[〜~～-]\s*\d|\/\s*\d)/.test(trailing)) continue;
        if (/^(?:\s|[()※])*(?:取[手っ]*|ハンドル|脚|キャスター|突起).{0,12}(?:除|含ま)/.test(trailing)) continue;
        const [, width, wu, depth, du, height, hu] = match;
        // A shared final unit is allowed; explicitly mixed units convert individually.
        const values = [width, depth, height].map((value, i) => Number(value) / (([wu, du, hu][i] || hu).toLowerCase() === 'mm' ? 10 : 1));
        if (values.some(value => !Number.isFinite(value) || value <= 0 || value > 1000)) continue;
        const evidenceStart = Math.max(0, match.index - (goodEnd >= 0 ? before.length - good.index : 0));
        candidates.push({ width: values[0], depth: values[1], height: values[2], source, evidence: text.slice(evidenceStart, match.index + match[0].length) });
      }
    }
  }
  return candidates;
}

export function extractDimensions(itemName, itemCaption) {
  const candidates = bodyCandidates(itemCaption);
  const unique = new Map(candidates.map(candidate => [[candidate.width, candidate.depth, candidate.height].join('/'), candidate]));
  if (unique.size !== 1) return { dimensions: null, dimensionReason: unique.size > 1 ? '複数の本体サイズが記載されています' : '本体の幅・奥行・高さを確定できません' };
  const dimensions = [...unique.values()][0];
  // Even a complete title triple cannot resolve multiple named sizes or telescoping furniture.
  const allText = plainText(`${itemName} ${itemCaption}`);
  if (/伸縮|可変|サイズ選択|サイズが選べる/.test(allText)) return { dimensions: null, dimensionReason: 'サイズの選択・調整があるため確認が必要です' };
  // Separate width declarations in title indicate options even if only one caption triple parsed.
  const titleText = plainText(itemName);
  if (/(?:幅|奥行き?|高さ|[WDH])\s*\d+(?:\.\d+)?\s*(?:cm|mm)?\s*[/〜~～-]\s*\d/i.test(titleText)) return { dimensions: null, dimensionReason: '複数のサイズ候補があるため確認が必要です' };
  for (const [key, label] of [['width', '(?:幅|横幅)'], ['depth', '奥行き?'], ['height', '高さ']]) {
    const titleValues = [...titleText.matchAll(new RegExp(`${label}\\s*(\\d+(?:\\.\\d+)?)\\s*(cm|mm)?`, 'gi'))].map(match => Number(match[1]) / (match[2]?.toLowerCase() === 'mm' ? 10 : 1));
    if (titleValues.some(value => Math.abs(value - dimensions[key]) > 0.1)) return { dimensions: null, dimensionReason: '商品名と本体サイズの対応を確認してください' };
  }
  return { dimensions, dimensionReason: null };
}
