import { PRICE_BANDS, PURPOSES as DOOR_PURPOSES, SORTS, activeCount, applyFilters, countWith, defaultFilters, doorFacts, pickFilters, seriesList, widthList } from './filters.js?v=202611051333';
import { doorsFit, measureFigures } from './measure.js?v=202611051333';
import { CLIENT_TYPES, LIFTS, OLD_DOORS, PAYMENTS, PURPOSES, STEP_TITLES, TIMINGS, ZONES, chatLink, orderSteps, orderText, requestText, stepProblem, validateOrder, validateRequest } from './order.js?v=202611051333';
import { MEASURE_NEEDED, MEASURE_SAVING, MEASURE_SELF, PRICE_LIST, PRICES, estimate, hasDoors, installKind, rangeText } from './pricing.js?v=202611051333';

// Адрес приёма заказов (Cloudflare Worker). Пока пусто, заявка уходит сообщением в чат.
const API_URL = '';
const SECTION_NAMES = {
  ruchki: 'Ручки',
  petli: 'Петли',
  'zamki-i-zashchelki': 'Замки и защёлки',
  'skobyanye-izdeliya': 'Скобяные изделия',
  'razdvizhnye-sistemy': 'Раздвижные системы',
  'umnye-sistemy-otkryvaniya': 'Умные системы',
};
const PAGE_SIZE = 40;
const SIDE_KEYS = { 'Левая': 'L', 'Правая': 'R' };
const CONTACT = { email: 'kugappiy@yandex.ru', telegram: 'jamesanji' };
const TELEGRAM_URL = `https://t.me/${CONTACT.telegram}`;
const SAVING_TEXT = `Замерьте проём сами по нашей инструкции и сэкономьте до ${MEASURE_SAVING.toLocaleString('ru-RU')} ₽ на замере.`;
const WARRANTY_TEXT = 'Гарантия 1 год согласно паспорту двери. Паспорт прилагается к каждой двери.';
const CASHBACK_MAX = '5 000 ₽';
const CASHBACK_TEXT = 'После установки пришлите честный отзыв с фото двери в Telegram. Точную сумму назовём при заказе.';
const cashbackBanner = () => `<aside class="cashback"><b>Кэшбэк до ${CASHBACK_MAX}</b><span>за отзыв с фото</span><p>${esc(CASHBACK_TEXT)}</p></aside>`;
const FINAL_PRICE_TEXT = 'Цена примерная. Итог и скидку подтверждаем лично, после проверки заявки.';
const ICONS = {
  catalog: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/>',
  measure: '<rect x="2.5" y="8" width="19" height="8" rx="1.5"/><path d="M7 8v3M11 8v4M15 8v3M19 8v2"/>',
  works: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z"/>',
  about: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  cart: '<path d="M3 4h2.5l2.2 11h10.1l2-8H6.5"/><circle cx="9.5" cy="19.5" r="1.5"/><circle cx="16.5" cy="19.5" r="1.5"/>',
};
const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const state = { catalog: null, works: { photos: [], reviews: [] }, filters: defaultFilters(), filtersOpen: false, stock: { items: {} }, limit: PAGE_SIZE, hardwareLoaded: false, forms: {}, checkoutStep: 0, draft: {}, order: null };

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Приватный режим: работаем без сохранения.
  }
}

let cart = load('cart', []);
let opening = load('opening', null);

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pickOptions = (group, options, selected) => `<div class="opts" data-group="${group}">
  ${options.map(([value, label]) => `<button type="button" class="opt" data-value="${esc(value)}" aria-pressed="${selected === value}">${esc(label)}</button>`).join('')}
</div>`;
const money = (value) => `${value.toLocaleString('ru-RU')} ₽`;
const sizeLabel = (size) => size.replace('x', '×');
const tg = () => window.Telegram?.WebApp;
const find = (id) => state.catalog.items.find((item) => item.id === id);
const offersOf = (variant) => state.stock.items[variant?.slug]?.offers ?? {};
const variantPrice = (variant, item) => state.stock.items[variant?.slug]?.price ?? variant?.price ?? item.price;

// Цены и остатки обновляются отдельно от каталога, раз в сутки.
function applyStock(items) {
  for (const item of items) {
    if (!item.variants?.length) continue;
    const prices = item.variants.map((v) => variantPrice(v, item)).filter(Boolean);
    if (prices.length) item.price = Math.min(...prices);
    item.stockTotal = item.variants.reduce((sum, v) => sum + Object.values(offersOf(v)).reduce((a, b) => a + b, 0), 0);
    item.stockKnown = item.variants.some((v) => state.stock.items[v.slug]);
  }
}

function stockFor(variant, size, side) {
  const offers = offersOf(variant);
  const keys = Object.keys(offers).filter((key) => key.startsWith(size ?? ''));
  if (!keys.length) return null;
  const sideKey = SIDE_KEYS[side];
  const chosen = sideKey ? keys.filter((key) => key.endsWith(`-${sideKey}`)) : keys;
  return (chosen.length ? chosen : keys).reduce((sum, key) => sum + offers[key], 0);
}

async function ensureHardware() {
  if (state.hardwareLoaded) return;
  try {
    const hardware = await fetch('hardware.json').then((r) => r.json());
    state.catalog.items.push(...hardware.items);
  } catch {
    // Без файла раздел покажет пустой список: остальной каталог работает.
  }
  state.hardwareLoaded = true;
}

function setCart(next) {
  cart = next;
  save('cart', cart);
  renderTabs();
}

function renderTabs() {
  const count = cart.reduce((sum, line) => sum + line.qty, 0);
  const route = location.hash.split('/')[1] || '';
  const inCatalog = ['item', 'services', 'custom', 'wholesale', 'faq', 'pick'].includes(route);
  const current = inCatalog ? '' : route === 'checkout' ? 'cart' : route;
  tabs.innerHTML = [['', 'Каталог', 'catalog'], ['measure', 'Замер', 'measure'], ['works', 'Отзывы', 'works'], ['about', 'О нас', 'about'], ['cart', 'Корзина', 'cart']]
    .map(([path, label, icon]) => `<a href="#/${path}" ${current === path ? 'aria-current="page"' : ''}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon]}</svg>${label}${path === 'cart' && count ? `<b>${count}</b>` : ''}</a>`)
    .join('');
}

function topbar() {
  return `<header class="topbar">
    <a class="brand" href="#/"><img src="logo.svg" alt=""><span class="brand-text"><b>ОЛИМПИЕЦ</b><small>двери и фурнитура</small></span></a>
    <a class="call" href="${TELEGRAM_URL}" target="_blank" rel="noopener" aria-label="Написать в Telegram">Написать</a>
  </header>`;
}

// У двустворчатых и обычных дверей бывает одно имя: в карточке такие различаем по размеру.
function duplicateNames() {
  if (!state.duplicates) {
    const seen = new Set();
    state.duplicates = new Set();
    for (const { name } of state.catalog.items) {
      if (seen.has(name)) state.duplicates.add(name);
      seen.add(name);
    }
  }
  return state.duplicates;
}

function productCard(item) {
  const image = item.images[0]
    ? `<img src="${item.images[0]}" alt="" loading="lazy">`
    : '<span class="noimg">Фото уточняется</span>';
  const facts = item.kind === 'door' ? doorFacts(item).slice(0, 2).join(' · ') : '';
  const stock = item.stockKnown ? `<div class="badge ${item.stockTotal > 0 ? 'in' : 'out'}">${item.stockTotal > 0 ? 'В наличии' : 'Под заказ'}</div>` : '';
  return `<a class="card" href="#/item/${item.id}">
    <div class="photo">${image}${stock}</div>
    <div class="price">${item.price ? money(item.price) : 'Цена по запросу'}</div>
    <div class="title">${esc(item.name)}${duplicateNames().has(item.name) ? `, ${esc(item.sizes.map(sizeLabel).join(', '))}` : ''}</div>
    <div class="tags">${esc(facts || item.series)}</div>
  </a>`;
}

const fitsOpening = (item) => Boolean(opening) && doorsFit(item.sizes, opening).length > 0;

function filterPanel() {
  const f = state.filters;
  const items = state.catalog.items;
  const search = `<input id="search" type="search" placeholder="Поиск по названию или артикулу" aria-label="Поиск" value="${esc(f.q)}">`;
  const option = (attr, value, label, pressed, count) => `<button type="button" class="opt small" data-${attr}="${esc(value)}" aria-pressed="${pressed}" ${!pressed && count === 0 ? 'disabled' : ''}>${esc(label)}${count === undefined ? '' : ` <small>${count}</small>`}</button>`;
  const flip = (list, value) => (list.includes(value) ? list : [...list, value]);
  const count = (patch) => countWith(items, f, patch, fitsOpening);
  const sort = `<span class="label">Сортировка</span>
    <div class="opts">${SORTS.map(([key, label]) => option('sort', key, label, f.sort === key)).join('')}</div>`;
  if (f.category === 'hardware') return `<section class="panel filters">${search}${sort}</section>`;
  const doorOnly = f.category !== 'door' ? '' : `
    <span class="label">Назначение</span>
    <div class="opts">${DOOR_PURPOSES.map(([key, label]) => option('purpose', key, label, f.purpose === key, count({ purpose: key }))).join('')}</div>
    <span class="label">Особенности</span>
    <div class="opts">
      ${option('toggle', 'thermo', 'Терморазрыв', f.thermo, count({ thermo: true }))}
      ${option('toggle', 'mirror', 'С зеркалом', f.mirror, count({ mirror: true }))}
      ${option('toggle', 'custom', 'Можно свой размер', f.custom, count({ custom: true }))}
    </div>`;
  return `<section class="panel filters">
    ${search}
    <span class="label">Наличие</span>
    <div class="opts">${option('toggle', 'inStock', 'Есть на складе', f.inStock, count({ inStock: true }))}</div>
    ${doorOnly}
    <span class="label">Цена</span>
    <div class="opts">${PRICE_BANDS.map(([key, label]) => option('band', key, label, f.band === key, count({ band: key }))).join('')}</div>
    <span class="label">${f.category === 'door' ? 'Серия' : 'Бренд'}</span>
    <div class="opts">${seriesList(items, f.category).map((s) => option('series', s, s, f.series.includes(s), count({ series: flip(f.series, s) }))).join('')}</div>
    <span class="label">Ширина, мм</span>
    <div class="opts">${widthList(items, f.category).map((w) => option('width', w, w, f.widths.includes(w), count({ widths: flip(f.widths, w) }))).join('')}</div>
    ${sort}
    <button type="button" class="btn ghost" data-reset style="margin-top:14px">Сбросить фильтры</button>
  </section>`;
}

function catalogGrid() {
  const f = state.filters;
  const all = applyFilters(state.catalog.items, f, fitsOpening);
  const items = all.slice(0, state.limit);
  const count = `<p class="muted found">Найдено: ${all.length}${activeCount(f) ? ' <button type="button" class="link small" data-reset>Сбросить</button>' : ''}</p>`;
  if (!all.length) return `${count}<div class="empty"><p class="muted">Ничего не нашлось. Попробуйте смягчить фильтры.</p></div>`;
  const more = all.length > items.length ? `<button type="button" class="btn ghost" data-more style="margin-top:12px">Показать ещё</button>` : '';
  // Промо между карточками: цены видны сразу, а доверие и кэшбэк не теряются внизу длинного списка.
  if (activeCount(f) || items.length <= 6 || f.category !== 'door') return `${count}<div class="grid">${items.map(productCard).join('')}</div>${more}`;
  return `${count}<div class="grid">${items.slice(0, 6).map(productCard).join('')}</div>
    ${cashbackBanner()}
    ${state.works.photos.length ? `<section class="strip">
      <div class="strip-head"><h2>Наши работы</h2><a href="#/works">Отзывы и фото</a></div>
      ${state.works.rating ? `<a class="stars" href="#/works"><b>★ ${state.works.rating.value}</b> ${state.works.rating.count} отзыва на Авито</a>` : ''}
      <div class="strip-row">${state.works.photos.slice(0, 8).map((src) => `<a href="#/works"><img src="${src}" alt="Установленная дверь" loading="lazy"></a>`).join('')}</div>
    </section>` : ''}
    <div class="grid" style="margin-top:16px">${items.slice(6).map(productCard).join('')}</div>${more}`;
}

function renderFilterBar() {
  const f = state.filters;
  const items = state.catalog.items;
  const quick = (attr, value, label, pressed, patch) => {
    const left = countWith(items, f, patch, fitsOpening);
    return `<button class="chip" data-${attr}="${value}" aria-pressed="${pressed}" ${!pressed && left === 0 ? 'disabled' : ''}>${label}</button>`;
  };
  if (f.category === 'hardware') {
    return Object.entries(SECTION_NAMES).map(([key, label]) => quick('section', key, label, f.section === key, { section: key })).join('');
  }
  const stock = quick('toggle', 'inStock', 'В наличии', f.inStock, { inStock: true });
  if (f.category !== 'door') return stock;
  return `${stock}
    ${opening ? quick('toggle', 'fit', `Под мой проём ${opening.w}×${opening.h}`, f.fit, { fit: true }) : ''}
    ${DOOR_PURPOSES.map(([key, label]) => quick('purpose', key, label, f.purpose === key, { purpose: key })).join('')}
    ${quick('toggle', 'thermo', 'Терморазрыв', f.thermo, { thermo: true })}
    ${quick('toggle', 'mirror', 'С зеркалом', f.mirror, { mirror: true })}
    ${quick('toggle', 'custom', 'Свой размер', f.custom, { custom: true })}`;
}

function renderFilterButton() {
  const f = state.filters;
  const count = activeCount(f);
  const label = f.category === 'hardware' ? 'Поиск и сортировка' : 'Фильтры и сортировка';
  return `<button class="filter-btn" data-open-filters aria-expanded="${state.filtersOpen}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>
    <span>${label}</span>
    ${count ? `<b>${count}</b>` : ''}
    <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
  </button>`;
}

function refreshCatalog({ panel = false } = {}) {
  view.querySelector('#filter-open').innerHTML = renderFilterButton();
  view.querySelector('#filter-bar').innerHTML = renderFilterBar();
  view.querySelector('#results').innerHTML = catalogGrid();
  if (panel) view.querySelector('#filter-panel').innerHTML = state.filtersOpen ? filterPanel() : '';
}

function renderCatalog() {
  view.innerHTML = `${topbar()}
    <section class="hero slim">
      <h1>Двери, которые подходят</h1>
      <p class="lead">С&nbsp;установкой в&nbsp;СПб и&nbsp;ЛО. Оплата после монтажа, гарантия 1&nbsp;год.</p>
      <a class="btn pick-btn" href="#/pick">Подобрать дверь за минуту</a>
    </section>
    <nav class="quick" aria-label="Полезное">
      <a class="pill hot" href="#/works">Кэшбэк до ${CASHBACK_MAX}</a>
      <a class="pill" href="#/measure">Свой замер: −${MEASURE_SAVING.toLocaleString('ru-RU')} ₽</a>
      <a class="pill" href="#/custom">На заказ</a>
      <a class="pill" href="#/wholesale">Оптом</a>
      <a class="pill" href="#/services">Монтаж и цены</a>
      <a class="pill" href="#/faq">Вопросы</a>
    </nav>
    <div class="segment" role="group" aria-label="Раздел каталога">
      ${[['door', 'Входные'], ['interior', 'Межкомнатные'], ['hardware', 'Фурнитура']].map(([key, label]) => `<button class="seg" data-category="${key}" aria-pressed="${state.filters.category === key}">${label}</button>`).join('')}
    </div>
    <div id="filter-open"></div>
    <div class="chips" id="filter-bar" role="group" aria-label="Фильтры"></div>
    <div id="filter-panel"></div>
    <div id="results"></div>
    <p class="foot">Цены на ${esc(state.stock.updated?.split(' ')[0] ?? state.catalog.priceDate)}. <a href="#/services">Цены на монтаж и доставку</a>. ${WARRANTY_TEXT} Предложение не является офертой.</p>`;
  refreshCatalog({ panel: true });
}

function stockBadge(count) {
  if (count === null) return '<p class="stock unknown">Наличие уточним при подтверждении</p>';
  return count > 0 ? `<p class="stock in">На складе: ${count} шт.</p>` : '<p class="stock out">Под заказ</p>';
}

function renderItem(id) {
  const item = find(id);
  if (!item) {
    if (id?.startsWith('m') && !state.hardwareLoaded) {
      ensureHardware().then(() => renderItem(id));
      return;
    }
    view.innerHTML = `${topbar()}<div class="empty"><h2>Товар не найден</h2><p class="muted">Возможно, он больше не продаётся.</p><a href="#/">В каталог</a></div>`;
    return;
  }
  const isDoor = item.kind === 'door';
  const isHardware = item.kind === 'hardware';
  const variants = item.variants ?? [];
  const fits = opening && !isHardware ? doorsFit(item.sizes, opening) : [];
  const draft = state.draft[id] ?? (state.draft[id] = {
    variant: (variants.find((v) => Object.values(offersOf(v)).some((q) => q > 0)) ?? variants[0])?.slug ?? null,
    size: fits[0] || item.sizes[0] || null,
    side: null,
    customW: '',
    customH: '',
  });
  const variant = variants.find((v) => v.slug === draft.variant) ?? null;
  const custom = draft.size === 'custom';
  const canCustom = item.attrs.nonstandard;
  const hasSides = isDoor || Object.keys(offersOf(variant)).some((key) => /-[LR]$/.test(key));
  const price = custom ? null : variantPrice(variant, item);
  const images = variant?.images?.length ? variant.images : item.images;
  const count = isHardware || custom ? null : stockFor(variant, draft.size, draft.side);
  const sideLabel = (side) => {
    const qty = variant ? stockFor(variant, draft.size, side) : null;
    return qty === null ? '' : qty > 0 ? `<small>${qty} шт.</small>` : '<small>под заказ</small>';
  };
  const sizeCount = (size) => {
    const qty = variant ? stockFor(variant, size) : null;
    return qty === null ? '' : `<small>${qty > 0 ? `${qty} шт.` : 'под заказ'}</small>`;
  };
  view.innerHTML = `<a class="back" href="#/">← Каталог</a>
    <div class="gallery">${images.map((src) => `<img src="${src}" alt="${esc(item.name)}" loading="lazy">`).join('')}</div>
    <section class="panel">
      <h1>${esc(item.name)}</h1>
      <p class="muted">${esc(item.series)}${item.sku ? ` · Артикул ${esc(item.sku)}` : ''}</p>
      <div class="bigprice">${price ? money(price) : 'Цена по запросу'}</div>
      ${isHardware ? '' : stockBadge(count)}
      ${isDoor && doorFacts(item).length ? `<ul class="facts-row">${doorFacts(item).map((fact) => `<li>${esc(fact)}</li>`).join('')}</ul>` : ''}
      ${variants.length > 1 ? `
        <span class="label">Цвет: ${esc(variant?.color)}</span>
        <div class="swatches">${variants.map((v) => `<button type="button" class="swatch" data-variant="${esc(v.slug)}" aria-pressed="${v.slug === draft.variant}" aria-label="${esc(v.color)}">${v.images[0] ? `<img src="${v.images[0]}" alt="" loading="lazy">` : esc(v.color)}</button>`).join('')}</div>` : variant?.color ? `<p class="muted" style="margin-top:10px">Цвет: ${esc(variant.color)}</p>` : ''}
      ${isHardware ? '' : `
        <span class="label">Размер, мм</span>
        <div class="opts">
          ${item.sizes.map((size) => `<button class="opt" data-size="${size}" aria-pressed="${draft.size === size}">${sizeLabel(size)}${fits.includes(size) ? ' ✓' : ''} ${sizeCount(size)}</button>`).join('')}
          ${canCustom ? `<button class="opt" data-size="custom" aria-pressed="${custom}">Другой размер</button>` : ''}
        </div>
        ${custom ? `<div class="two" style="margin-top:10px">
          <input inputmode="numeric" placeholder="Ширина, мм" aria-label="Ширина двери, мм" data-custom="customW" value="${esc(draft.customW)}">
          <input inputmode="numeric" placeholder="Высота, мм" aria-label="Высота двери, мм" data-custom="customH" value="${esc(draft.customH)}">
        </div>
        <p class="note">Заказная дверь: цену рассчитаем после заявки, предоплата 50–70%.</p>` : ''}
        ${hasSides ? `<span class="label">Сторона открывания</span>
        <div class="opts">
          ${['Левая', 'Правая', 'Не знаю'].map((side) => `<button class="opt" data-side="${side}" aria-pressed="${draft.side === side}">${side} ${side === 'Не знаю' || custom ? '' : sideLabel(side)}</button>`).join('')}
        </div>
        <p class="muted" style="margin-top:8px"><a href="#/measure">Как определить размер и сторону</a></p>` : ''}
        ${state.stock.updated ? `<p class="muted" style="margin-top:8px">Наличие на ${esc(state.stock.updated)}</p>` : ''}`}
      ${isDoor ? `<p class="note">Монтаж этой двери: ${rangeText(PRICES[installKind(item, custom)])}. <a href="#/services">Все цены</a><br>${WARRANTY_TEXT}</p>
        ${item.attrs.panels ? '<p class="muted" style="margin-top:8px">Панели можно заменить: напишите пожелание в комментарии к заявке.</p>' : ''}` : ''}
      ${item.kind === 'interior' ? '<p class="note">Цена за полотно. Коробку, наличники и монтаж рассчитаем после заявки.</p>' : ''}
    </section>
    ${itemReviews(item)}
    ${item.specs.length ? `<section class="panel"><h2>Характеристики</h2><dl class="specs">
      ${item.specs.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}
    </dl></section>` : ''}
    <div class="buybar-space"></div>
    <div class="buybar">
      <p class="error" id="item-error" role="alert" hidden></p>
      <div class="buybar-row">
        <b>${price ? money(price) : 'Цена по запросу'}</b>
        <button class="btn" id="add">В корзину</button>
      </div>
    </div>`;
  const rerender = () => {
    const y = window.scrollY;
    renderItem(id);
    window.scrollTo(0, y);
  };
  view.querySelectorAll('[data-size]').forEach((el) => el.addEventListener('click', () => {
    draft.size = el.dataset.size;
    rerender();
  }));
  view.querySelectorAll('[data-side]').forEach((el) => el.addEventListener('click', () => {
    draft.side = el.dataset.side;
    rerender();
  }));
  view.querySelectorAll('[data-variant]').forEach((el) => el.addEventListener('click', () => {
    draft.variant = el.dataset.variant;
    rerender();
  }));
  view.querySelectorAll('[data-custom]').forEach((el) => el.addEventListener('input', () => {
    draft[el.dataset.custom] = el.value;
  }));
  view.querySelector('#add').addEventListener('click', () => addToCart(item, draft, variant, hasSides));
}

// Пара отзывов о похожей покупке: решение принимается здесь, а не на вкладке «Отзывы».
function itemReviews(item) {
  const { rating, reviews } = state.works;
  if (!rating || !reviews?.length) return '';
  const about = (word) => reviews.filter((r) => r.item.toLowerCase().includes(word));
  const preferred = item.kind === 'hardware' ? about('ручк') : item.attrs.thermo ? about('терморазрыв') : [];
  const doors = reviews.filter((r) => r.item.toLowerCase().includes('двер') && !r.item.toLowerCase().includes('ручк'));
  const picked = [...new Set([...preferred, ...(item.kind === 'hardware' ? [] : doors)])].slice(0, 2);
  return `<section class="panel">
    <div class="strip-head"><h2><span class="star">★</span> ${rating.value}</h2><a href="#/works">${rating.count} отзыва на Авито</a></div>
    ${picked.map(reviewCard).join('')}
  </section>`;
}

function addToCart(item, draft, variant, hasSides) {
  const error = view.querySelector('#item-error');
  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
    (view.querySelector('[data-side]') || view.querySelector('[data-custom]'))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const line = { id: item.id, qty: 1, size: null, custom: false, side: null, note: null };
  if (item.kind === 'hardware') {
    line.sku = item.sku ?? null;
    line.image = item.images[0] ?? null;
    line.price = item.price;
  } else {
    if (hasSides && !draft.side) return fail('Выберите сторону открывания');
    line.side = draft.side;
    line.variant = variant?.slug ?? null;
    line.color = variant?.color ?? null;
    line.image = variant?.images?.[0] ?? item.images[0] ?? null;
    if (draft.size === 'custom') {
      const w = parseInt(draft.customW, 10);
      const h = parseInt(draft.customH, 10);
      if (!(w >= 500 && w <= 2000 && h >= 1500 && h <= 2600)) return fail('Укажите ширину и высоту в миллиметрах, например 900 и 2100');
      line.size = `${w}x${h}`;
      line.custom = true;
    } else {
      line.size = draft.size;
      line.price = variantPrice(variant, item);
      line.stock = variant ? stockFor(variant, draft.size, draft.side) : null;
    }
  }
  const same = cart.find((c) => c.id === line.id && c.variant === line.variant && c.size === line.size && c.side === line.side);
  setCart(same ? cart.map((c) => (c === same ? { ...c, qty: c.qty + 1 } : c)) : [...cart, line]);
  tg()?.HapticFeedback?.notificationOccurred('success');
  location.hash = '#/cart';
}

function renderMeasure() {
  const figures = measureFigures();
  const result = opening ? doorsFit(['860x2050', '960x2050', '980x2070', '980x2080', '780x2000'], opening) : [];
  view.innerHTML = `${topbar()}
    <h1>Как замерить проём</h1>
    <p class="muted" style="margin-top:6px">5 минут и рулетка. ${SAVING_TEXT} Не уверены? Выберите в заявке «${MEASURE_NEEDED}».</p>
    <section class="panel">
      <div class="step"><span class="num">1</span><div><h3>Найдите настоящий проём</h3>
        <p>Если старая дверь на месте, снимите наличник хотя бы с одной стороны. Мерить нужно от стены до стены, а не по коробке.</p></div></div>
      <div class="step"><span class="num">2</span><div><h3>Ширина в трёх местах</h3>
        <p>Сверху, посередине и снизу. Запишите наименьшее значение.</p><div class="figure">${figures.width}</div></div></div>
      <div class="step"><span class="num">3</span><div><h3>Высота в двух местах</h3>
        <p>Слева и справа, от пола до верха проёма. Если будете менять покрытие пола, скажите нам.</p><div class="figure">${figures.height}</div></div></div>
      <div class="step"><span class="num">4</span><div><h3>Толщина стены</h3>
        <p>Измерьте глубину проёма. Она нужна, чтобы подобрать доборы.</p></div></div>
      <div class="step"><span class="num">5</span><div><h3>Сторона открывания</h3>
        <p>Встаньте снаружи, лицом к двери, которая открывается на вас. Петли слева: дверь левая. Петли справа: правая.</p><div class="figure">${figures.side}</div></div></div>
    </section>
    <section class="panel">
      <h2>Подберём размер</h2>
      <div class="two">
        <label><span class="label">Ширина проёма, мм</span><input id="ow" inputmode="numeric" placeholder="900" value="${opening?.w ?? ''}"></label>
        <label><span class="label">Высота проёма, мм</span><input id="oh" inputmode="numeric" placeholder="2080" value="${opening?.h ?? ''}"></label>
      </div>
      <p class="error" id="m-error" role="alert" hidden></p>
      <button class="btn" id="fit" style="margin-top:14px">Подобрать</button>
      ${opening ? `<div class="note">${result.length
        ? `Подойдёт: <b>${result.map(sizeLabel).join(', ')}</b> мм. Перед заказом мы всё проверим.`
        : 'Стандартный размер не подходит. Нужна заказная дверь или доработка проёма: подскажем после заявки.'}</div>
        <a class="btn ghost" href="#/" id="show-fit" style="margin-top:10px">Показать подходящие двери</a>` : ''}
    </section>
    <p class="foot">Размеры указаны ориентировочно и зависят от проёма.</p>`;
  view.querySelector('#fit').addEventListener('click', () => {
    const w = parseInt(view.querySelector('#ow').value, 10);
    const h = parseInt(view.querySelector('#oh').value, 10);
    if (!(w >= 500 && w <= 2500 && h >= 1500 && h <= 3000)) {
      const error = view.querySelector('#m-error');
      error.textContent = 'Укажите размеры в миллиметрах, например 900 и 2080';
      error.hidden = false;
      return;
    }
    opening = { w, h };
    save('opening', opening);
    state.draft = {};
    renderMeasure();
  });
  view.querySelector('#show-fit')?.addEventListener('click', () => {
    state.filters = { ...defaultFilters(), fit: true };
  });
}

function cartTotal() {
  return cart.reduce((sum, line) => sum + (line.custom ? 0 : (line.price ?? find(line.id)?.price) || 0) * line.qty, 0);
}

function hasCustom() {
  return cart.some((line) => line.custom);
}

function renderCart() {
  cart = cart.filter((line) => find(line.id));
  if (!cart.length) {
    view.innerHTML = `${topbar()}<div class="empty"><h2>Корзина пуста</h2>
      <p class="muted" style="margin:8px 0 18px">Выберите дверь в каталоге.</p><a class="btn" href="#/">В каталог</a></div>`;
    return;
  }
  const lines = cart.map((line, index) => {
    const item = find(line.id);
    const details = [line.color, line.size && sizeLabel(line.size) + (line.custom ? ' (заказной)' : ''), line.side, line.sku && `арт. ${line.sku}`].filter(Boolean).join(', ');
    const linePrice = line.price ?? item.price;
    const price = line.custom || !linePrice ? 'Цена по запросу' : money(linePrice * line.qty);
    return `<div class="line">
      ${line.image ?? item.images[0] ? `<img src="${line.image ?? item.images[0]}" alt="">` : ''}
      <div class="info"><h3>${esc(item.name)}</h3>
        <p class="muted">${esc(details || line.note)}</p>
        <p><b>${price}</b></p>
        <div class="qty">
          <button data-minus="${index}" aria-label="Меньше">−</button><span>${line.qty}</span>
          <button data-plus="${index}" aria-label="Больше">+</button>
          <button class="remove" data-remove="${index}">Убрать</button>
        </div>
      </div></div>`;
  }).join('');
  view.innerHTML = `${topbar()}<h1>Корзина</h1>
    <section class="panel">${lines}
      <div class="total"><span>Итого за товар</span><span>${money(cartTotal())}</span></div>
      <p class="muted" style="margin-top:6px">Примерную цену монтажа и доставки покажем в заявке. <a href="#/services">Все цены</a></p>
    </section>
    <p class="note">${hasCustom()
      ? 'Сейчас платить не нужно. За заказную дверь перед запуском в производство берём предоплату 50–70%, остальное после монтажа.'
      : 'Сейчас платить не нужно. Заявка только подтверждает заказ, оплата после монтажа.'} ${WARRANTY_TEXT}</p>
    <a class="btn" href="#/checkout" style="margin-top:12px">Оформить заявку</a>`;
  const change = (attr, fn) => view.querySelectorAll(`[data-${attr}]`).forEach((el) => el.addEventListener('click', () => {
    fn(Number(el.dataset[attr]));
    renderCart();
  }));
  change('plus', (i) => setCart(cart.map((c, n) => (n === i ? { ...c, qty: Math.min(c.qty + 1, 50) } : c))));
  change('minus', (i) => setCart(cart.map((c, n) => (n === i ? { ...c, qty: Math.max(c.qty - 1, 1) } : c))));
  change('remove', (i) => setCart(cart.filter((_, n) => n !== i)));
}

function saveFormDraft(key, form) {
  const fields = {};
  for (const el of form.elements) {
    if (el.name) fields[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  const picks = {};
  form.querySelectorAll('[data-group]').forEach((group) => {
    picks[group.dataset.group] = group.querySelector('[aria-pressed="true"]')?.dataset.value;
  });
  state.forms[key] = { fields, picks };
}

// Ссылки на инструкцию и политику уводят с формы: при возврате всё введённое остаётся.
function restoreFormDraft(key, form) {
  const draft = state.forms[key];
  if (!draft) return;
  for (const el of form.elements) {
    if (!el.name || !(el.name in draft.fields)) continue;
    if (el.type === 'checkbox') el.checked = draft.fields[el.name];
    else el.value = draft.fields[el.name];
  }
  form.querySelectorAll('[data-group]').forEach((group) => {
    const value = draft.picks[group.dataset.group];
    if (value === undefined) return;
    group.querySelectorAll('[data-value]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === value));
  });
}

function checkoutPane(step) {
  const form = load('contact', {});
  const user = tg()?.initDataUnsafe?.user;
  if (step === 'install') {
    return `<span class="label">Где установка</span>
      ${pickOptions('zone', Object.entries(ZONES))}
      <label id="km-field" hidden><span class="label">Сколько км от КАД, примерно</span><input name="km" inputmode="numeric" placeholder="Например, 15"></label>
      <span class="label">Лифт</span>
      ${pickOptions('lift', Object.entries(LIFTS))}
      <label id="floor-field"><span class="label">Этаж</span><input name="floor" inputmode="numeric" placeholder="Например, 5"></label>
      <span class="label">Снять старую дверь?</span>
      ${pickOptions('old', Object.entries(OLD_DOORS))}
      <label class="check" id="disposal-field" hidden><input type="checkbox" name="disposal"><span>Вывезти и утилизировать старую дверь</span></label>`;
  }
  if (step === 'timing') {
    return `<span class="label">Когда планируете монтаж</span>
      ${pickOptions('when', TIMINGS.map((v) => [v, v]))}
      <span class="label">Замер</span>
      ${pickOptions('measured', [[MEASURE_SELF, `${MEASURE_SELF}: бесплатно`], [MEASURE_NEEDED, MEASURE_NEEDED]], opening ? MEASURE_SELF : undefined)}
      <p class="muted" style="margin-top:8px">${SAVING_TEXT} <a href="#/measure">Инструкция</a></p>`;
  }
  if (step === 'contacts') {
    return `<label><span class="label">Имя</span><input name="name" autocomplete="name" value="${esc(form.name ?? user?.first_name ?? '')}"></label>
      <label><span class="label">Телефон</span><input name="phone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00" value="${esc(form.phone ?? '')}"></label>
      <label><span class="label">Адрес или ЖК</span><input name="address" autocomplete="street-address" value="${esc(form.address ?? '')}"></label>`;
  }
  return `<span class="label">Как удобнее оплатить после монтажа</span>
    ${pickOptions('payment', Object.entries(PAYMENTS))}
    <label><span class="label">Комментарий</span><textarea name="comment" placeholder="Удобное время, пожелания"></textarea></label>
    <div class="estimate" id="estimate" aria-live="polite"></div>
    <p class="note">${WARRANTY_TEXT}</p>
    <label class="check"><input type="checkbox" name="consent"><span>Согласен на обработку персональных данных по <a href="#/privacy">политике</a></span></label>`;
}

function renderCheckout() {
  if (!cart.length) {
    location.hash = '#/cart';
    return;
  }
  const steps = orderSteps(hasDoors(cart, find));
  state.checkoutStep = Math.min(state.checkoutStep, steps.length - 1);
  view.innerHTML = `<a class="back" href="#/cart">← Корзина</a>
    <h1>Заявка</h1>
    <div class="progress" role="progressbar" aria-valuemin="1" aria-valuemax="${steps.length}">${steps.map(() => '<i></i>').join('')}</div>
    <p class="step-title" id="step-title"></p>
    <div class="mini-total" id="mini-total" aria-live="polite"></div>
    <form class="panel" id="order" novalidate>
      ${steps.map((step, i) => `<fieldset class="pane" data-pane="${i}" hidden>${checkoutPane(step)}</fieldset>`).join('')}
      <p class="error" id="error" role="alert" hidden></p>
      <div class="step-nav">
        <button type="button" class="btn ghost" id="step-back">Назад</button>
        <button class="btn" id="step-next">Далее</button>
      </div>
      <p class="muted" id="send-hint" style="margin-top:8px" hidden>Откроется чат с готовым сообщением, останется нажать «Отправить».</p>
    </form>`;
  const formEl = view.querySelector('#order');
  restoreFormDraft('checkout', formEl);
  view.querySelectorAll('[data-group]').forEach((group) => group.addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    group.querySelectorAll('[data-value]').forEach((b) => b.setAttribute('aria-pressed', b === button));
    tg()?.HapticFeedback?.selectionChanged();
    updateEstimate(formEl);
  }));
  formEl.addEventListener('input', () => updateEstimate(formEl));
  view.querySelector('#step-back').addEventListener('click', () => showStep(formEl, steps, state.checkoutStep - 1));
  formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    const problem = stepProblem(steps[state.checkoutStep], readAnswers(formEl));
    const error = view.querySelector('#error');
    error.textContent = problem || '';
    error.hidden = !problem;
    if (problem) return;
    if (state.checkoutStep < steps.length - 1) showStep(formEl, steps, state.checkoutStep + 1);
    else submitOrder(formEl);
  });
  showStep(formEl, steps, state.checkoutStep);
  updateEstimate(formEl);
}

function showStep(form, steps, index) {
  state.checkoutStep = Math.max(index, 0);
  const last = state.checkoutStep === steps.length - 1;
  form.querySelectorAll('[data-pane]').forEach((pane) => {
    pane.hidden = Number(pane.dataset.pane) !== state.checkoutStep;
  });
  view.querySelectorAll('.progress i').forEach((bar, i) => bar.classList.toggle('on', i <= state.checkoutStep));
  view.querySelector('.progress').setAttribute('aria-valuenow', state.checkoutStep + 1);
  view.querySelector('#step-title').textContent = `Шаг ${state.checkoutStep + 1} из ${steps.length}: ${STEP_TITLES[steps[state.checkoutStep]]}`;
  view.querySelector('#step-back').hidden = state.checkoutStep === 0;
  view.querySelector('#step-next').textContent = last ? (API_URL ? 'Оформить заказ' : 'Продолжить в Telegram') : 'Далее';
  view.querySelector('#send-hint').hidden = !last || Boolean(API_URL);
  view.querySelector('#error').hidden = true;
  window.scrollTo(0, 0);
}

function readAnswers(form) {
  const picked = (group) => form.querySelector(`[data-group="${group}"] [aria-pressed="true"]`)?.dataset.value;
  const data = Object.fromEntries(new FormData(form));
  return {
    ...data,
    consent: data.consent === 'on',
    disposal: data.disposal === 'on',
    zone: picked('zone'),
    lift: picked('lift'),
    old: picked('old'),
    when: picked('when'),
    measured: picked('measured'),
    payment: picked('payment'),
    opening: opening ? `${opening.w}×${opening.h} мм` : '',
    source: adSource(),
  };
}

function estimateHtml(sum) {
  if (!hasDoors(cart, find)) return `<p class="muted">${esc(FINAL_PRICE_TEXT)}</p>`;
  return `<h3>Примерная стоимость</h3>
    <dl class="rows">
      <div><dt>Товар</dt><dd>${money(sum.goods)}${sum.unpriced ? ' + по запросу' : ''}</dd></div>
      ${sum.rows.map((row) => `<div><dt>${esc(row.label)}</dt><dd>${rangeText([row.min, row.max])}</dd></div>`).join('')}
    </dl>
    <div class="total"><span>Всего</span><span>${rangeText(sum.total)}</span></div>
    ${sum.saving ? `<p class="saving">Замер по инструкции: экономия до ${money(sum.saving)}</p>` : ''}
    ${sum.kmUnknown ? `<p class="muted">Плюс ${rangeText(PRICES.perKm)} за км от КАД.</p>` : ''}
    ${sum.interiorInstall ? '<p class="muted">Коробку, наличники и монтаж межкомнатных дверей рассчитаем после заявки.</p>' : ''}
    <p class="muted" style="margin-top:6px">${esc(FINAL_PRICE_TEXT)}</p>`;
}

function updateEstimate(form) {
  const answers = readAnswers(form);
  const toggle = (id, visible) => {
    const el = form.querySelector(id);
    if (el) el.hidden = !visible;
  };
  toggle('#km-field', answers.zone === 'out');
  toggle('#floor-field', answers.lift !== 'house');
  toggle('#disposal-field', Boolean(answers.old) && answers.old !== 'no');
  const sum = estimate(cart, answers, find);
  form.querySelector('#estimate').innerHTML = estimateHtml(sum);
  view.querySelector('#mini-total').innerHTML = `<span>Примерно</span><b>${rangeText(sum.total)}</b>`;
  saveFormDraft('checkout', form);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Во встроенном браузере Telegram буфер обмена бывает недоступен.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const done = document.execCommand('copy');
    area.remove();
    return done;
  }
}

function openChat(link) {
  const app = tg();
  if (app?.initData && app.openTelegramLink) app.openTelegramLink(link);
  else window.open(link, '_blank') || (location.href = link);
}

function adSource() {
  // Метка канала из рекламной ссылки: t.me/бот/приложение?startapp=метка
  return tg()?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('src') || '';
}

function submitOrder(form) {
  const error = view.querySelector('#error');
  const order = readAnswers(form);
  const problem = validateOrder(order, cart, find);
  if (problem) {
    error.textContent = problem;
    error.hidden = false;
    return;
  }
  error.hidden = true;
  const text = orderText(order, cart, find);
  const first = cart[0];
  const photo = first.image ?? find(first.id)?.images?.[0];
  const estimateBlock = estimateHtml(estimate(cart, order, find));
  sendToSeller(text, photo, form).then((sent) => {
    if (sent === 'error') return;
    save('contact', { name: order.name, phone: order.phone, address: order.address });
    delete state.forms.checkout;
    state.checkoutStep = 0;
    state.order = text;
    state.orderSent = sent === 'bot';
    state.orderEstimate = estimateBlock;
    setCart([]);
    tg()?.HapticFeedback?.notificationOccurred('success');
    location.hash = '#/done';
  });
}

// Заказ уходит Якову через бота. Пока бот не подключён или недоступен, клиент отправляет текст сам.
async function sendToSeller(text, photo, form) {
  const initData = tg()?.initData;
  if (API_URL && initData) {
    const button = form.querySelector('button.btn:not(.ghost)');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Отправляем…';
    try {
      const response = await fetch(`${API_URL}/order`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, initData, photo: photo ? new URL(photo, location.href).href : null }),
      });
      if (response.ok) return 'bot';
    } catch {
      // Ниже запасной путь через чат.
    }
    button.disabled = false;
    button.textContent = label;
  }
  openChat(chatLink(CONTACT, text));
  return 'chat';
}

function renderDone() {
  if (!state.order) {
    location.hash = '#/';
    return;
  }
  if (state.orderSent) {
    view.innerHTML = `${topbar()}<section class="panel stack"><h1>Заказ принят</h1>
      <p>Спасибо! Мы получили заказ и свяжемся с вами, чтобы подтвердить цену, замер и монтаж.</p>
      ${state.orderEstimate ? `<div class="estimate">${state.orderEstimate}</div>` : ''}
      ${cashbackBanner()}
      <a class="btn" href="#/">Вернуться в каталог</a></section>`;
    return;
  }
  view.innerHTML = `${topbar()}<section class="panel stack"><h1>Осталось отправить</h1>
    <p>Мы открыли чат с готовым сообщением. Нажмите «Отправить», иначе заявка до нас не дойдёт.</p>
    <button class="btn" id="reopen">Открыть чат ещё раз</button>
    <button class="btn ghost" id="copy">Скопировать текст заявки</button>
    ${state.orderEstimate ? `<div class="estimate">${state.orderEstimate}</div>
    ${cashbackBanner()}` : ''}
    <p class="muted" style="white-space:pre-line">${esc(state.order)}</p>
    <p class="muted">Не получается через Telegram? Пришлите текст заявки на почту: <b>${CONTACT.email}</b></p>
    <button class="btn ghost" id="copy-email">Скопировать почту</button>
    <a href="#/">Вернуться в каталог</a></section>`;
  view.querySelector('#reopen').addEventListener('click', () => openChat(chatLink(CONTACT, state.order)));
  const copyButton = (selector, text, fallback) => view.querySelector(selector).addEventListener('click', async (event) => {
    event.target.textContent = (await copyText(text)) ? 'Скопировано' : fallback;
  });
  copyButton('#copy', state.order, 'Не получилось: выделите текст ниже');
  copyButton('#copy-email', CONTACT.email, 'Не получилось: выделите почту выше');
}

function contactFields() {
  const form = load('contact', {});
  const user = tg()?.initDataUnsafe?.user;
  return `<label><span class="label">Имя</span><input name="name" autocomplete="name" value="${esc(form.name ?? user?.first_name ?? '')}"></label>
    <label><span class="label">Телефон</span><input name="phone" type="tel" autocomplete="tel" placeholder="+7 900 000-00-00" value="${esc(form.phone ?? '')}"></label>`;
}

const requestFooter = `<label class="check"><input type="checkbox" name="consent"><span>Согласен на обработку персональных данных по <a href="#/privacy">политике</a></span></label>
  <p class="error" id="error" role="alert" hidden></p>
  <button class="btn" style="margin-top:16px">${API_URL ? 'Отправить заявку' : 'Продолжить в Telegram'}</button>
  ${API_URL ? '' : '<p class="muted" style="margin-top:8px">Откроется чат с готовым сообщением, останется нажать «Отправить».</p>'}`;

function bindRequest(kind, groups) {
  const form = view.querySelector('#request');
  restoreFormDraft(kind, form);
  form.addEventListener('input', () => saveFormDraft(kind, form));
  view.querySelectorAll('[data-group]').forEach((group) => group.addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    group.querySelectorAll('[data-value]').forEach((b) => b.setAttribute('aria-pressed', b === button));
    saveFormDraft(kind, form);
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const answers = { ...data, consent: data.consent === 'on', source: adSource() };
    for (const group of groups) answers[group] = form.querySelector(`[data-group="${group}"] [aria-pressed="true"]`)?.dataset.value;
    const problem = validateRequest(kind, answers);
    const error = view.querySelector('#error');
    error.textContent = problem || '';
    error.hidden = !problem;
    if (problem) return;
    save('contact', { ...load('contact', {}), name: data.name, phone: data.phone });
    const text = requestText(kind, answers);
    sendToSeller(text, null, form).then((sent) => {
      delete state.forms[kind];
      state.order = text;
      state.orderSent = sent === 'bot';
      state.orderEstimate = '';
      tg()?.HapticFeedback?.notificationOccurred('success');
      location.hash = '#/done';
    });
  });
}

function renderCustom() {
  view.innerHTML = `<a class="back" href="#/">← Каталог</a><h1>Двери на заказ</h1>
    <p class="muted" style="margin-top:6px">Нужен свой размер, цвет или отделка? Опишите дверь: подберём завод и посчитаем цену.</p>
    <section class="panel"><ul class="plain">
      <li>Нестандартные размеры и двустворчатые двери</li>
      <li>Цвет по RAL, другие панели и плёнки</li>
      <li>Монтаж нестандартной двери: ${rangeText(PRICES.installCustom)}</li>
      <li>Предоплата 50–70% перед запуском в производство, остальное после монтажа</li>
    </ul></section>
    <form class="panel" id="request" novalidate>
      <span class="label">Куда нужна дверь</span>
      ${pickOptions('purpose', PURPOSES.map((v) => [v, v]))}
      <div class="two" style="margin-top:6px">
        <label><span class="label">Ширина, мм</span><input name="width" inputmode="numeric" placeholder="900" value="${opening?.w ?? ''}"></label>
        <label><span class="label">Высота, мм</span><input name="height" inputmode="numeric" placeholder="2100" value="${opening?.h ?? ''}"></label>
      </div>
      <p class="muted" style="margin-top:8px"><a href="#/measure">Как замерить проём</a></p>
      <label><span class="label">Количество</span><input name="qty" inputmode="numeric" value="1"></label>
      <label><span class="label">Пожелания</span><textarea name="wishes" placeholder="Цвет, отделка, стекло, замок. Фото примера можно приложить в чате"></textarea></label>
      <label><span class="label">Адрес или ЖК</span><input name="address" autocomplete="street-address"></label>
      ${contactFields()}
      ${requestFooter}
    </form>`;
  bindRequest('custom', ['purpose']);
}

function renderWholesale() {
  view.innerHTML = `<a class="back" href="#/">← Каталог</a><h1>Двери оптом</h1>
    <p class="muted" style="margin-top:6px">Для застройщиков, подрядчиков, управляющих компаний и магазинов.</p>
    <img class="banner" src="media/wholesale.webp" alt="Металлические двери оптом">
    <section class="panel"><ul class="plain">
      <li>Опыт поставок в новые ЖК</li>
      <li>Цена зависит от объёма и модели: пришлём коммерческое предложение</li>
      <li>Подберём модели под проект и бюджет</li>
    </ul></section>
    <form class="panel" id="request" novalidate>
      <span class="label">Кто вы</span>
      ${pickOptions('client', CLIENT_TYPES.map((v) => [v, v]))}
      <label><span class="label">Компания, если есть</span><input name="company" autocomplete="organization"></label>
      <label><span class="label">Объект или город</span><input name="object" placeholder="Например, ЖК, адрес стройки"></label>
      <label><span class="label">Сколько дверей</span><input name="qty" inputmode="numeric" placeholder="Например, 40"></label>
      <label><span class="label">Какие двери нужны</span><textarea name="wishes" placeholder="Квартирные, технические, тамбурные. Спецификацию можно приложить в чате"></textarea></label>
      <span class="label">Сроки</span>
      ${pickOptions('when', TIMINGS.map((v) => [v, v]))}
      ${contactFields()}
      ${requestFooter}
    </form>`;
  bindRequest('wholesale', ['client', 'when']);
}

function renderAbout() {
  const { rating } = state.works;
  view.innerHTML = `${topbar()}<h1>О компании</h1>
    <section class="panel owner">
      <div class="owner-photo placeholder"><img src="logo.svg" alt=""></div>
      <div><h2>Яков</h2><p class="muted">Основатель компании «ОЛИМПИЕЦ»<br>Двери и фурнитура в СПб и ЛО</p></div>
    </section>
    <section class="panel stack">
      <p>Я вышел из дверной компании и уже 6 лет работаю на дверном рынке. За это время закрыл много заказов в новых ЖК и в рознице и продолжаю развиваться.</p>
      <h3>Да, я дилер</h3>
      <p>Поэтому знаю заводы и их двери изнутри. Подскажу, какая модель подойдёт вашему проёму и бюджету, и за что доплачивать не стоит.</p>
      <h3>Переплачиваете ли вы за дилера?</h3>
      <p>Нет. Цены в каталоге соответствуют рекомендованным заводами, отдельной наценки за посредника нет. Условия по вашему заказу обсудим лично.</p>
    </section>
    <section class="facts">
      <div><b>6 лет</b><span>на дверном рынке</span></div>
      ${rating ? `<div><b>★ ${rating.value}</b><span>${rating.count} отзыва на Авито</span></div>` : ''}
      <div><b>СПб и ЛО</b><span>замер, доставка, монтаж</span></div>
      <div><b>После монтажа</b><span>оплата складских дверей</span></div>
      <div><b>Гарантия 1 год</b><span>согласно паспорту двери</span></div>
      <div><b>Паспорт</b><span>прилагается к каждой двери</span></div>
    </section>
    <section class="panel"><h3>В каталоге</h3><p class="muted" style="margin-top:4px">YoDoors, Уральские двери, Райтвер, BIST, ELARTUM, фурнитура Morelli</p></section>
    <a class="btn" href="${TELEGRAM_URL}" target="_blank" rel="noopener" style="margin-top:12px">Написать в Telegram</a>
    <p class="muted" style="margin-top:12px">Почта: <b>${CONTACT.email}</b></p>
    <div class="tiles" style="margin-top:12px">
      <a class="tile" href="#/custom"><h3>Двери на заказ</h3></a>
      <a class="tile" href="#/wholesale"><h3>Двери оптом</h3></a>
    </div>`;
}

function renderFaq() {
  const money0 = (value) => value.toLocaleString('ru-RU');
  const items = [
    ['Как оформить заказ?', 'Выберите дверь, замерьте проём по инструкции или закажите замерщика и заполните заявку. Заявка уходит нам в Telegram, мы связываемся с вами и подтверждаем цену, замер и монтаж.'],
    ['Когда платить?', 'Складские двери оплачиваются после монтажа. За заказную дверь берём предоплату 50–70% перед запуском в производство, остальное после монтажа.'],
    ['Какие способы оплаты?', 'Наличными, переводом или переводом на ИП. Способ можно выбрать в заявке, реквизиты пришлём при подтверждении заказа.'],
    ['Какая гарантия?', WARRANTY_TEXT],
    ['Сколько стоит монтаж и доставка?', `Стандартный монтаж: ${rangeText(PRICES.installStandard)}, доставка по СПб: ${rangeText(PRICES.delivery)}. Примерную сумму для вашего адреса приложение посчитает при оформлении заявки. Итог и скидку подтверждаем лично.`],
    ['Нужен ли замерщик?', `Нет, если замерите проём сами по нашей инструкции: так вы сэкономите до ${money0(MEASURE_SAVING)} ₽. Если сомневаетесь, выберите в заявке замерщика.`],
    ['Куда вы выезжаете?', `В Санкт-Петербург и Ленинградскую область. За КАД к стоимости доставки и выезда замерщика добавляется ${rangeText(PRICES.perKm)} за км.`],
    ['Можно ли дверь нестандартного размера?', 'Да, у части моделей. В карточке такой двери есть вариант «Другой размер», а если нужной модели нет, оставьте заявку на дверь на заказ.'],
    ['Снимете старую дверь?', `Да, демонтаж и вывоз можно выбрать в заявке. Демонтаж металлической двери: ${rangeText(PRICES.removeMetal)}, деревянной: ${rangeText(PRICES.removeWood)}, утилизация: ${rangeText(PRICES.disposal)}.`],
    ['Как получить кэшбэк?', `После установки пришлите честный отзыв с фото двери в Telegram. Кэшбэк до ${CASHBACK_MAX}, точную сумму назовём при заказе.`],
    ['Как быстро установите?', 'Срок зависит от модели и адреса, мы назовём его при подтверждении заявки. Укажите в заявке, когда планируете монтаж.'],
  ];
  view.innerHTML = `${topbar()}<h1>Вопросы и ответы</h1>
    <section class="panel faq">${items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
    <a class="btn" href="#/" style="margin-top:12px">Выбрать дверь</a>
    <a class="btn ghost" href="${TELEGRAM_URL}" target="_blank" rel="noopener" style="margin-top:10px">Задать вопрос в Telegram</a>`;
}

function renderPick() {
  const pick = state.pick ?? (state.pick = { step: 0 });
  const items = state.catalog.items;
  const countFor = (answers) => applyFilters(items, pickFilters({ ...pick, ...answers })).length;
  const questions = [
    { key: 'where', title: 'Куда нужна дверь?', options: [['flat', 'В квартиру'], ['house', 'В дом или на дачу']] },
    ...(pick.where !== 'flat' ? [{ key: 'warm', title: 'Дом отапливается зимой?', hint: 'Для тёплого дома лучше дверь с терморазрывом: она меньше промерзает.', options: [['yes', 'Да, нужна тёплая дверь'], ['no', 'Нет, не важно']] }] : []),
    { key: 'budget', title: 'На какой бюджет рассчитываете?', hint: 'Цена двери без монтажа и доставки.', options: [...PRICE_BANDS.map(([key, label]) => [key, label]), ['any', 'Пока не знаю']] },
  ];
  const step = Math.min(pick.step, questions.length - 1);
  const question = questions[step];
  view.innerHTML = `${step ? '<button type="button" class="back link" id="pick-back">← Назад</button>' : '<a class="back" href="#/">← Каталог</a>'}
    <h1>Подбор двери</h1>
    <div class="progress">${questions.map((_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>
    <p class="step-title">Вопрос ${step + 1} из ${questions.length}</p>
    <section class="panel pane">
      <h2>${esc(question.title)}</h2>
      ${question.hint ? `<p class="muted" style="margin-top:6px">${esc(question.hint)}</p>` : ''}
      <div class="pick-options">
        ${question.options.map(([value, label]) => {
          const left = countFor({ [question.key]: value });
          return `<button type="button" class="pick-option" data-answer="${value}" ${left ? '' : 'disabled'}><span>${esc(label)}</span><small>${left ? `${left} мод.` : 'нет моделей'}</small></button>`;
        }).join('')}
      </div>
    </section>`;
  view.querySelector('#pick-back')?.addEventListener('click', () => {
    pick.step = step - 1;
    renderPick();
  });
  view.querySelectorAll('[data-answer]').forEach((button) => button.addEventListener('click', () => {
    pick[question.key] = button.dataset.answer;
    tg()?.HapticFeedback?.selectionChanged();
    if (step < questions.length - 1) {
      pick.step = step + 1;
      renderPick();
      window.scrollTo(0, 0);
      return;
    }
    state.filters = pickFilters(pick);
    state.filtersOpen = false;
    state.pick = null;
    location.hash = '#/';
  }));
}

function renderServices() {
  view.innerHTML = `${topbar()}<h1>Монтаж и доставка</h1>
    <p class="muted" style="margin-top:6px">${SAVING_TEXT} <a href="#/measure">Инструкция</a></p>
    <section class="panel"><dl class="rows">
      ${PRICE_LIST.map(([label, range, suffix]) => `<div><dt>${esc(label)}</dt><dd>${rangeText(range, suffix)}</dd></div>`).join('')}
    </dl>
    <p class="muted" style="margin-top:12px">Цены ориентировочные. Примерную сумму для вашего адреса покажем в заявке, итог и скидку подтверждаем лично.</p></section>
    <p class="note">${WARRANTY_TEXT}</p>
    ${cashbackBanner()}
    <a class="btn" href="#/" style="margin-top:12px">Выбрать дверь</a>`;
}

function reviewCard(review) {
  return `<blockquote class="review"><p>${esc(review.text)}</p>
    <footer class="muted">${esc(review.author)}, ${esc(review.date)} · ${esc(review.item)}</footer></blockquote>`;
}

function renderWorks() {
  const { photos, reviews, rating } = state.works;
  const shown = 6;
  view.innerHTML = `${topbar()}<h1>Отзывы и работы</h1>
    ${rating ? `<section class="panel score"><div class="bigprice">★ ${rating.value}</div>
      <div><p>${rating.count} отзыва на Авито</p><a href="${rating.url}" target="_blank" rel="noopener">Смотреть на Авито</a></div></section>` : ''}
    ${cashbackBanner()}
    ${reviews.length ? `<section class="panel">${reviews.slice(0, shown).map(reviewCard).join('')}
      ${reviews.length > shown ? `<details class="more"><summary>Все отзывы</summary>${reviews.slice(shown).map(reviewCard).join('')}</details>` : ''}
      <p class="muted" style="margin-top:12px">Отзывы приведены дословно. Часть покупателей получила кэшбэк за отзыв с фотографией.</p></section>` : ''}
    <h2 style="margin-top:20px">Фото установленных дверей</h2>
    <div class="works">${photos.map((src, i) => `<button data-photo="${i}" aria-label="Открыть фото"><img src="${src}" alt="Установленная дверь" loading="lazy"></button>`).join('')}</div>
    <a class="btn" href="#/" style="margin-top:14px">Выбрать дверь</a>
    <dialog id="photo"><img alt="Установленная дверь"><button class="btn ghost">Закрыть</button></dialog>`;
  const dialog = view.querySelector('#photo');
  view.querySelectorAll('[data-photo]').forEach((el) => el.addEventListener('click', () => {
    dialog.querySelector('img').src = photos[Number(el.dataset.photo)];
    dialog.showModal();
  }));
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function renderPrivacy() {
  view.innerHTML = `<button type="button" class="back link" id="privacy-back">← Назад</button>
    <section class="panel stack"><h1>Политика обработки персональных данных</h1>
      <p>Вы сами отправляете нам в Telegram имя, телефон, адрес и данные заявки. Мы используем их, чтобы связаться с вами и выполнить заказ: замер, доставку и монтаж.</p>
      <p>Данные не продаём и передаём только исполнителям заказа: замерщику, доставке и монтажникам.</p>
      <p>Чтобы отозвать согласие или удалить данные, напишите на <b>${CONTACT.email}</b> или в <a href="${TELEGRAM_URL}" target="_blank" rel="noopener">Telegram</a>.</p>
    </section>`;
  view.querySelector('#privacy-back').addEventListener('click', () => history.back());
}

function route() {
  const [, page, id] = location.hash.split('/');
  renderTabs();
  window.scrollTo(0, 0);
  if (page === 'item') renderItem(id);
  else if (page === 'measure') renderMeasure();
  else if (page === 'cart') renderCart();
  else if (page === 'checkout') renderCheckout();
  else if (page === 'done') renderDone();
  else if (page === 'privacy') renderPrivacy();
  else if (page === 'works') renderWorks();
  else if (page === 'services') renderServices();
  else if (page === 'faq') renderFaq();
  else if (page === 'pick') renderPick();
  else if (page === 'custom') renderCustom();
  else if (page === 'wholesale') renderWholesale();
  else if (page === 'about') renderAbout();
  else renderCatalog();
  const app = tg();
  if (app?.BackButton) {
    if (page) app.BackButton.show();
    else app.BackButton.hide();
  }
  // Случайно смахнуть приложение на середине заявки обидно: Telegram переспросит.
  if (app?.initData) {
    if (page === 'checkout' && cart.length) app.enableClosingConfirmation?.();
    else app.disableClosingConfirmation?.();
  }
}

view.addEventListener('click', (event) => {
  const f = state.filters;
  const target = event.target.closest('[data-toggle],[data-open-filters],[data-category],[data-purpose],[data-section],[data-band],[data-series],[data-width],[data-sort],[data-reset],[data-more]');
  if (!target || target.disabled) return;
  const flip = (list, value) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  if ('openFilters' in target.dataset) {
    state.filtersOpen = !state.filtersOpen;
    refreshCatalog({ panel: true });
    return;
  }
  if ('more' in target.dataset) {
    state.limit += PAGE_SIZE;
    refreshCatalog();
    return;
  }
  state.limit = PAGE_SIZE;
  if (target.dataset.category) {
    state.filters = { ...defaultFilters(), category: target.dataset.category };
    view.querySelectorAll('[data-category]').forEach((b) => b.setAttribute('aria-pressed', b === target));
    if (target.dataset.category === 'hardware' && !state.hardwareLoaded) {
      view.querySelector('#results').innerHTML = '<p class="muted found">Загружаем фурнитуру…</p>';
      ensureHardware().then(() => refreshCatalog({ panel: true }));
      return;
    }
  } else if ('reset' in target.dataset) state.filters = { ...defaultFilters(), category: f.category };
  else if (target.dataset.section) f.section = f.section === target.dataset.section ? null : target.dataset.section;
  else if (target.dataset.purpose) f.purpose = f.purpose === target.dataset.purpose ? null : target.dataset.purpose;
  else if (target.dataset.toggle) f[target.dataset.toggle] = !f[target.dataset.toggle];
  else if (target.dataset.band) f.band = f.band === target.dataset.band ? null : target.dataset.band;
  else if (target.dataset.series) f.series = flip(f.series, target.dataset.series);
  else if (target.dataset.width) f.widths = flip(f.widths, target.dataset.width);
  else if (target.dataset.sort) f.sort = target.dataset.sort;
  tg()?.HapticFeedback?.selectionChanged();
  refreshCatalog({ panel: true });
});

view.addEventListener('input', (event) => {
  if (event.target.id !== 'search') return;
  state.filters.q = event.target.value;
  state.limit = PAGE_SIZE;
  // Панель не перерисовываем, чтобы поле поиска не теряло фокус.
  view.querySelector('#filter-open').innerHTML = renderFilterButton();
  view.querySelector('#filter-bar').innerHTML = renderFilterBar();
  view.querySelector('#results').innerHTML = catalogGrid();
});

// Внутри Telegram внешние ссылки надо открывать через его методы, иначе они могут не сработать.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="http"]');
  const app = tg();
  if (!link || !app?.initData) return;
  event.preventDefault();
  if (link.href.startsWith('https://t.me/')) app.openTelegramLink(link.href);
  else app.openLink(link.href);
});

function connectTelegram() {
  const app = tg();
  if (!app?.initData) return;
  document.documentElement.dataset.theme = app.colorScheme === 'dark' ? 'dark' : 'light';
  app.onEvent?.('themeChanged', () => {
    document.documentElement.dataset.theme = app.colorScheme === 'dark' ? 'dark' : 'light';
  });
  const paintChrome = () => {
    const color = app.colorScheme === 'dark' ? '#0F1E29' : '#F3F4F6';
    app.setHeaderColor?.(color);
    app.setBackgroundColor?.(color);
  };
  paintChrome();
  app.onEvent?.('themeChanged', paintChrome);
  app.ready();
  app.expand();
  app.BackButton?.onClick(() => history.back());
  route();
}

async function start() {
  try {
    const [catalog, works, stock] = await Promise.all([
      fetch('catalog.json').then((r) => r.json()),
      fetch('works.json').then((r) => r.json()).catch(() => state.works),
      fetch('stock.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => state.stock),
    ]);
    state.catalog = catalog;
    state.works = works;
    state.stock = stock;
    applyStock(state.catalog.items);
    if (cart.some((line) => line.sku)) await ensureHardware();
  } catch {
    view.innerHTML = `<div class="empty"><h2>Каталог не загрузился</h2>
      <p class="muted" style="margin:8px 0">Проверьте интернет или напишите нам: ${CONTACT.email}</p></div>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  if (tg()) connectTelegram();
  else window.addEventListener('load', connectTelegram, { once: true });
}

start();
