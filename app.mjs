import { isFresh, searchProducts, validConditions, validateCatalog } from './lib.mjs';

const $ = id => document.getElementById(id);
const form = $('search-form');
const currency = new Intl.NumberFormat('ja-JP');
const dateFormat = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
let catalog = null;
let conditions = null;
let matches = [];
let displayed = 0;
let loading = false;
let loadPromise;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clearResults() {
  $('products').replaceChildren();
  for (const id of ['load-more', 'results-toolbar', 'conditions-summary', 'empty-state', 'price-note']) $(id).hidden = true;
}

function showError(title, message) {
  clearResults();
  $('initial-state').hidden = true;
  $('error-title').textContent = title;
  $('error-message').textContent = message;
  $('error-panel').hidden = false;
  $('notice').hidden = true;
}

async function loadCatalog() {
  if (loading) return loadPromise;
  loading = true;
  $('retry-button').disabled = true;
  $('catalog-meta').textContent = '商品データを読み込み中…';
  try {
    const response = await fetch(`./data/catalog.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('FETCH_FAILED');
    catalog = validateCatalog(await response.json());
    const updated = dateFormat.format(new Date(catalog.generatedAt));
    $('catalog-meta').textContent = `${currency.format(catalog.items.length)}件の候補 / 取得 ${updated}（日本時間）`;
    $('error-panel').hidden = true;
    if (catalog.status === 'unavailable') {
      showError('商品データを取得できませんでした。', '楽天APIの接続・認証・利用制限などにより取得できていません。定期更新後に再度お試しください。');
      return false;
    }
    if (!isFresh(catalog)) {
      showError('商品データの更新を待っています。', '取得から24時間を過ぎたため、古い価格を表示していません。定期更新後に再度お試しください。');
      return false;
    }
    $('notice').hidden = catalog.status !== 'partial';
    if (catalog.status === 'partial') $('notice').textContent = `一部の家具の取得に失敗しました（${catalog.failedCategories.map(item => item.category).join('、')}）。取得できた候補のみ表示します。`;
    $('initial-state').hidden = Boolean(conditions);
    if (conditions) renderResults();
    return true;
  } catch {
    catalog = null;
    $('catalog-meta').textContent = '商品データを読み込めませんでした';
    showError('商品データを読み込めませんでした。', '通信状況を確認して再読み込みしてください。初回公開時は商品データの準備に数分かかる場合があります。');
    return false;
  } finally {
    loading = false;
    $('retry-button').disabled = false;
  }
}

function productCard(item) {
  const card = element('article', 'product-card');
  const imageLink = element('a', 'product-image-link');
  imageLink.href = item.url;
  imageLink.target = '_blank';
  imageLink.rel = 'noopener noreferrer';
  imageLink.setAttribute('aria-label', `${item.name}の商品ページを開く`);
  const fallback = element('span', 'image-fallback', '画像を表示できません');
  if (item.image) {
    const img = element('img');
    img.src = item.image;
    img.alt = item.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.replaceWith(fallback), { once: true });
    imageLink.append(img);
  } else imageLink.append(fallback);
  card.append(imageLink);
  const body = element('div', 'card-body');
  body.append(element('span', `fit-badge${item.fit ? '' : ' unknown'}`, item.fit ? '記載サイズが条件内' : 'サイズ要確認'));
  const title = element('h3', 'product-title');
  const titleLink = element('a', null, item.name);
  titleLink.href = item.url;
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  title.append(titleLink);
  body.append(title, element('p', 'shop-name', item.shop));
  if (item.dimensions) {
    const sizes = element('dl', 'dimensions');
    for (const [key, label] of [['width', '幅'], ['depth', '奥行'], ['height', '高さ']]) {
      const group = element('div');
      const value = element('dd', null, String(item.dimensions[key]));
      value.append(element('small', null, 'cm'));
      group.append(element('dt', null, label), value);
      sizes.append(group);
    }
    const details = element('details', 'evidence');
    details.append(element('summary', null, 'サイズの記載箇所'), element('p', null, `${item.dimensions.source}：${item.dimensions.evidence}`));
    body.append(sizes, details);
  } else body.append(element('p', 'unknown-reason', item.dimensionReason || '商品ページで本体サイズを確認してください'));
  const priceArea = element('div', 'price-area');
  const price = element('p', 'price', `¥${currency.format(item.price)}`);
  if (item.priceMax) price.append(element('small', null, `〜${currency.format(item.priceMax)}`));
  priceArea.append(price, element('p', 'price-extra', `税込 / ${item.postageIncluded ? '送料込み（地域・条件は商品ページで確認）' : '送料別・送料は商品ページで確認'}`), element('p', 'updated-at', `価格取得 ${dateFormat.format(new Date(catalog.generatedAt))}（日本時間）`));
  const link = element('a', 'product-link', '楽天市場で確認する');
  link.append(element('span', null, '↗'));
  link.href = item.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  body.append(priceArea, link);
  card.append(body);
  return card;
}

function appendProducts() {
  // Recheck expiry before rendering another page, including long-open tabs.
  if (!catalog || !isFresh(catalog)) {
    showError('商品データの更新を待っています。', '取得から24時間を過ぎたため、古い価格を表示していません。データを再読み込みしてください。');
    return;
  }
  const next = matches.slice(displayed, displayed + 24);
  $('products').append(...next.map(productCard));
  displayed += next.length;
  $('load-more').hidden = displayed >= matches.length;
  $('load-more').textContent = `さらに表示する（残り${matches.length - displayed}件） ↓`;
}

function renderResults() {
  if (!catalog || catalog.status === 'unavailable' || !isFresh(catalog)) return;
  conditions.includeUnknown = $('include-unknown').checked;
  conditions.sort = $('sort').value;
  matches = searchProducts(catalog.items, conditions);
  displayed = 0;
  $('products').replaceChildren();
  $('initial-state').hidden = true;
  $('error-panel').hidden = true;
  $('results-toolbar').hidden = false;
  $('conditions-summary').hidden = false;
  $('conditions-summary').textContent = `幅 ${conditions.width} × 奥行 ${conditions.depth} × 高さ ${conditions.height} cm 以下 / ${currency.format(conditions.budget)}円以内 / ${conditions.category || 'すべての収納家具'}`;
  const fitCount = matches.filter(item => item.fit).length;
  $('results-count').textContent = `${matches.length}件の候補（記載サイズが条件内 ${fitCount}件・サイズ要確認 ${matches.length - fitCount}件）`;
  $('empty-state').hidden = matches.length !== 0;
  $('price-note').hidden = matches.length === 0;
  $('price-note').textContent = `取得 ${dateFormat.format(new Date(catalog.generatedAt))}（日本時間）。Hairuはordinary-apartmentが作成・運営しています。価格・販売可能情報は変更される場合があります。購入時に楽天市場店舗に表示されている価格が適用されます。表示価格に幅がある商品は上限価格で予算を判定します。商品説明の自動読取のため、選択サイズ・本体寸法・送料を商品ページで必ず確認してください。`;
  appendProducts();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const input = Object.fromEntries(new FormData(form));
  const next = { width: Number(input.width), depth: Number(input.depth), height: Number(input.height), budget: Number(input.budget), category: input.category };
  if (!validConditions(next)) return;
  $('search-button').disabled = true;
  $('search-button').setAttribute('aria-busy', 'true');
  try {
    await loadPromise;
    if (!catalog || !isFresh(catalog) || catalog.status === 'unavailable') {
      loadPromise = loadCatalog();
      if (!await loadPromise) return;
    }
    conditions = next;
    renderResults();
    $('results-title').focus({ preventScroll: true });
    $('results-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  } finally {
    $('search-button').disabled = false;
    $('search-button').removeAttribute('aria-busy');
  }
});
$('example-button').addEventListener('click', () => {
  for (const [key, value] of Object.entries({ width: 80, depth: 40, height: 120, budget: 20000 })) $(key).value = value;
  $('width').focus();
});
$('retry-button').addEventListener('click', () => { loadPromise = loadCatalog(); });
$('include-unknown').addEventListener('change', () => { if (conditions) renderResults(); });
$('sort').addEventListener('change', () => { if (conditions) renderResults(); });
$('load-more').addEventListener('click', appendProducts);
setInterval(() => {
  if (catalog && catalog.status !== 'unavailable' && !isFresh(catalog)) showError('商品データの更新を待っています。', '取得から24時間を過ぎたため、古い価格を表示していません。データを再読み込みしてください。');
}, 60000);
loadPromise = loadCatalog();
