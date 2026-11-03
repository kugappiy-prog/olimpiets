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
  return { category: 'door', q: '', purpose: null, thermo: false, custom: false, band: null, series: [], widths: [], fit: false, sort: 'cheap' };
}

export function activeCount(f) {
  return [f.q.trim(), f.purpose, f.thermo, f.custom, f.band, f.series.length, f.widths.length, f.fit].filter(Boolean).length;
}

const widthOf = (size) => size.split('x')[0];

export function seriesList(items) {
  return [...new Set(items.filter((i) => i.kind === 'door').map((i) => i.series))];
}

export function widthList(items) {
  const widths = new Set(items.filter((i) => i.kind === 'door').flatMap((i) => i.sizes.map(widthOf)));
  return [...widths].sort((a, b) => Number(a) - Number(b));
}

function matches(item, f, fits) {
  if (item.kind !== f.category) return false;
  const q = f.q.trim().toLowerCase();
  if (q && !`${item.name} ${item.series}`.toLowerCase().includes(q)) return false;
  if (f.category !== 'door') return true;
  const band = PRICE_BANDS.find(([key]) => key === f.band);
  if (band && !(item.price > band[2] && item.price <= band[3])) return false;
  if (f.series.length && !f.series.includes(item.series)) return false;
  if (f.widths.length && !item.sizes.some((size) => f.widths.includes(widthOf(size)))) return false;
  // Термодвери рассчитаны на улицу и дом, в квартиру их обычно не берут.
  if (f.purpose === 'flat' && item.attrs.thermo) return false;
  if (f.purpose === 'street' && !item.attrs.street) return false;
  if (f.thermo && !item.attrs.thermo) return false;
  if (f.custom && !item.attrs.nonstandard) return false;
  if (f.fit && !fits(item)) return false;
  return true;
}

export function applyFilters(items, f, fits = () => true) {
  const direction = f.sort === 'expensive' ? -1 : 1;
  return items.filter((item) => matches(item, f, fits)).sort((a, b) => direction * ((a.price ?? 0) - (b.price ?? 0)));
}

// Сколько позиций останется, если выбрать значение: показываем рядом и выключаем нулевые варианты.
export function countWith(items, f, patch, fits = () => true) {
  const next = { ...f, ...patch };
  return items.filter((item) => matches(item, next, fits)).length;
}
