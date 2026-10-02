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

export function extractDimensions(itemName, itemCaption) {
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
