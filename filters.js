// Фильтры каталога. Без обращений к странице, чтобы логику можно было проверить тестами.
// Как на сайтах-референсах: двери и фурнитура это разные разделы, внутри группы значения
// объединяются через «или», а разные группы сужают выбор.
export const PRICE_BANDS = [
  ['to20', 'До 20 000 ₽', 0, 20000],
  ['to30', '20–30 000 ₽', 20000, 30000],
  ['to50', '30–50 000 ₽', 30000, 50000],
  ['to80', '50–80 000 ₽', 50000, 80000],
  ['over80', 'От 80 000 ₽', 80000, Infinity],
];

export const PURPOSES = [
  ['flat', 'В квартиру'],
  ['street', 'На улицу'],
];

export const SORTS = [
  ['cheap', 'Сначала дешевле'],
  ['expensive', 'Сначала дороже'],
];

export function defaultFilters() {
  return { category: 'door', q: '', purpose: null, thermo: false, mirror: false, custom: false, inStock: false, section: null, band: null, series: [], widths: [], fit: false, sort: 'cheap' };
}

export function activeCount(f) {
  return [f.q.trim(), f.purpose, f.thermo, f.mirror, f.custom, f.inStock, f.section, f.band, f.series.length, f.widths.length, f.fit].filter(Boolean).length;
}

const widthOf = (size) => size.split('x')[0];

export function seriesList(items, kind = 'door') {
  return [...new Set(items.filter((i) => i.kind === kind).map((i) => i.series))];
}

export function widthList(items, kind = 'door') {
  const widths = new Set(items.filter((i) => i.kind === kind).flatMap((i) => i.sizes.map(widthOf)));
  return [...widths].sort((a, b) => Number(a) - Number(b));
}

// Зеркальное стекло в стеклопакете это ещё не зеркало на двери, поэтому его не считаем.
export function hasMirror(item) {
  return item.specs.some(([key, value]) => !/стеклопакет/i.test(key) && /зеркал/i.test(value));
}

function contourCount(item) {
  const spec = item.specs.find(([key, value]) => /контур/i.test(`${key} ${value}`));
  if (!spec) return null;
  const value = spec[1];
  const named = value.match(/(\d+)\s*контур/i);
  if (named) return Number(named[1]);
  if (value.includes('(')) return Number(value.match(/\d+/)?.[0]) || null;
  const numbers = value.split('+').map((part) => Number(part.match(/\d+/)?.[0]));
  return numbers.every(Boolean) ? numbers.reduce((a, b) => a + b, 0) : null;
}

function leafThickness(item) {
  const spec = item.specs.find(([key]) => /толщина.*полотна/i.test(key));
  if (!spec) return null;
  // У ELARTUM значение вида «97 мм/97 мм»: короб и полотно, берём полотно.
  return spec[1].split('/').pop().match(/\d+/)?.[0] ?? null;
}

const contourWord = (n) => (n === 1 ? 'контур' : n < 5 ? 'контура' : 'контуров');

export function doorFacts(item) {
  const thickness = leafThickness(item);
  const contours = contourCount(item);
  return [
    thickness && `Полотно ${thickness} мм`,
    contours && `${contours} ${contourWord(contours)}`,
    item.attrs.thermo && 'Терморазрыв',
    hasMirror(item) && 'С зеркалом',
  ].filter(Boolean);
}

// Ответы мастера подбора превращаем в обычные фильтры: дальше клиент может их менять.
export function pickFilters({ where, warm, budget }) {
  return {
    ...defaultFilters(),
    purpose: where === 'house' ? 'street' : 'flat',
    thermo: where === 'house' && warm === 'yes',
    band: budget && budget !== 'any' ? budget : null,
  };
}

function matches(item, f, fits) {
  if (item.kind !== f.category) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${item.name} ${item.series} ${item.sku ?? ''}`.toLowerCase().includes(q)) return false;
  if (f.category === 'hardware') return !f.section || item.section === f.section;
  const band = PRICE_BANDS.find(([key]) => key === f.band);
  if (band && !(item.price > band[2] && item.price <= band[3])) return false;
  if (f.series.length && !f.series.includes(item.series)) return false;
  if (f.widths.length && !item.sizes.some((size) => f.widths.includes(widthOf(size)))) return false;
  if (f.inStock && !(item.stockTotal > 0)) return false;
  if (f.category !== 'door') return true;
  // Термодвери рассчитаны на улицу и дом, в квартиру их обычно не берут.
  if (f.purpose === 'flat' && item.attrs.thermo) return false;
  if (f.purpose === 'street' && !item.attrs.street) return false;
  if (f.thermo && !item.attrs.thermo) return false;
  if (f.mirror && !hasMirror(item)) return false;
  if (f.custom && !item.attrs.nonstandard) return false;
  if (f.fit && !fits(item)) return false;
  return true;
}

export function applyFilters(items, f, fits = () => true) {
  const direction = f.sort === 'expensive' ? -1 : 1;
  // Товары без фото всегда в конце, внутри каждой группы действует выбранная сортировка.
  const noPhoto = (item) => (item.images?.length ? 0 : 1);
  return items.filter((item) => matches(item, f, fits)).sort((a, b) => noPhoto(a) - noPhoto(b) || direction * ((a.price ?? 0) - (b.price ?? 0)));
}

// Сколько позиций останется, если выбрать значение: показываем рядом и выключаем нулевые варианты.
export function countWith(items, f, patch, fits = () => true) {
  const next = { ...f, ...patch };
  return items.filter((item) => matches(item, next, fits)).length;
}
