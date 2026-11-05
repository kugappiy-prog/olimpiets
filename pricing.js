// Прайс услуг и примерный расчёт. Диапазоны от владельца, рублей. Скидки в расчёте намеренно нет:
// их согласует только владелец.
export const PRICES = {
  measure: [0, 1500],
  perKm: [30, 70],
  delivery: [1000, 3500],
  installStandard: [3000, 5900],
  installPremium: [6000, 8000],
  installThermo: [8000, 8000],
  installCustom: [4500, 11500],
  removeMetal: [500, 3600],
  removeWood: [400, 1500],
  floor: [100, 600],
  disposal: [1000, 5000],
};

export const PRICE_LIST = [
  ['Замер в СПб', PRICES.measure],
  ['Замер за КАД', PRICES.perKm, '/км'],
  ['Доставка по СПб', PRICES.delivery],
  ['Доставка за КАД', PRICES.perKm, '/км'],
  ['Стандартный монтаж', PRICES.installStandard],
  ['Монтаж дорогих моделей', PRICES.installPremium],
  ['Монтаж термодвери', PRICES.installThermo],
  ['Монтаж нестандартной двери', PRICES.installCustom],
  ['Демонтаж металлической двери', PRICES.removeMetal],
  ['Демонтаж деревянной двери', PRICES.removeWood],
  ['Подъём на этаж', PRICES.floor, ' за этаж'],
  ['Утилизация двери', PRICES.disposal],
];

// Порог «дорогой модели»: предположение, владелец может поменять.
export const PREMIUM_FROM = 60000;
export const MEASURE_SELF = 'Замерю сам по инструкции';
export const MEASURE_NEEDED = 'Нужен замерщик';
export const MEASURE_SAVING = PRICES.measure[1];

const INSTALL_LABEL = {
  installStandard: 'Монтаж',
  installPremium: 'Монтаж дорогой модели',
  installThermo: 'Монтаж термодвери',
  installCustom: 'Монтаж нестандартной двери',
};

const number = (value) => value.toLocaleString('ru-RU').replace(/\s/g, ' ');

export function rangeText([min, max], suffix = '') {
  if (min === max) return `около ${number(min)} ₽${suffix}`;
  return `${number(min)}–${number(max)} ₽${suffix}`;
}

export function installKind(item, custom = false) {
  if (custom) return 'installCustom';
  if (item.attrs.thermo) return 'installThermo';
  if (item.price >= PREMIUM_FROM) return 'installPremium';
  return 'installStandard';
}

// Для межкомнатных тоже нужны адрес, этаж и замер; для фурнитуры нет.
export function hasDoors(lines, findItem) {
  return lines.some((line) => findItem(line.id).kind !== 'hardware');
}

export function estimate(lines, answers, findItem) {
  const rows = [];
  const add = (label, [min, max], times = 1) => {
    if (times > 0) rows.push({ label, min: min * times, max: max * times });
  };
  let goods = 0;
  let unpriced = false;
  let doors = 0;
  let interiorInstall = false;
  const installs = {};
  for (const line of lines) {
    const item = findItem(line.id);
    const price = line.custom ? null : (line.price ?? item.price);
    if (price) goods += price * line.qty;
    else unpriced = true;
    if (item.kind === 'door') {
      doors += line.qty;
      const kind = installKind(item, line.custom);
      installs[kind] = (installs[kind] || 0) + line.qty;
    } else if (item.kind === 'interior') {
      // Цен на монтаж межкомнатных в прайсе услуг нет: не придумываем, считаем вручную.
      doors += line.qty;
      interiorInstall = true;
    }
  }

  const needMeasure = answers.measured === MEASURE_NEEDED;
  const outside = answers.zone === 'out';
  const km = Number.parseInt(answers.km, 10) > 0 ? Number.parseInt(answers.km, 10) : 0;
  if (doors) {
    if (needMeasure) add('Замер', PRICES.measure);
    if (needMeasure && outside) add('Выезд замерщика за КАД', PRICES.perKm, km);
    add('Доставка', PRICES.delivery);
    if (outside) add('Доставка за КАД', PRICES.perKm, km);
    for (const [kind, qty] of Object.entries(installs)) add(`${INSTALL_LABEL[kind]}, ${qty} шт.`, PRICES[kind], qty);
    if (answers.old === 'metal') add('Демонтаж старой двери', PRICES.removeMetal, doors);
    if (answers.old === 'wood') add('Демонтаж старой двери', PRICES.removeWood, doors);
    if (answers.old && answers.old !== 'no' && answers.disposal) add('Утилизация старой двери', PRICES.disposal, doors);
    // Без грузового лифта дверь поднимают вручную: в пассажирский она обычно не входит.
    const floor = Number.parseInt(answers.floor, 10);
    if (floor > 1 && (answers.lift === 'none' || answers.lift === 'passenger')) {
      add(`Подъём на ${floor} этаж`, PRICES.floor, (floor - 1) * doors);
    }
  }
  const services = rows.reduce((sum, row) => [sum[0] + row.min, sum[1] + row.max], [0, 0]);
  return {
    rows,
    goods,
    services,
    total: [goods + services[0], goods + services[1]],
    unpriced,
    kmUnknown: Boolean(doors && outside && !km),
    interiorInstall,
    saving: doors && !needMeasure ? MEASURE_SAVING : 0,
  };
}
