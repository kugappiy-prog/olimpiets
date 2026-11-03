import { estimate, hasDoors, rangeText } from './pricing.js';

// Заявка без сервера: собираем текст, клиент отправляет его сам в чат с продавцом.
export const PAYMENTS = {
  cash: 'Наличными',
  transfer: 'Переводом',
  ip: 'Переводом на ИП',
};

export const ZONES = { spb: 'В СПб', out: 'За КАД' };
export const LIFTS = { none: 'Нет лифта', passenger: 'Пассажирский', freight: 'Грузовой', house: 'Частный дом' };
export const OLD_DOORS = { no: 'Нет', metal: 'Металлическая', wood: 'Деревянная' };
export const TIMINGS = ['Как можно скорее', 'В течение 2 недель', 'В течение месяца', 'Пока выбираю'];

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const money = (value) => `${value.toLocaleString('ru-RU').replace(/\s/g, ' ')} ₽`;

export function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && /^[78]/.test(digits)) return `+7${digits.slice(1)}`;
  return null;
}

// Шаги оформления: для фурнитуры условия монтажа не спрашиваем.
export const STEP_TITLES = { install: 'Условия монтажа', timing: 'Сроки и замер', contacts: 'Контакты', finish: 'Подтверждение' };

export function orderSteps(doors) {
  return doors ? ['install', 'timing', 'contacts', 'finish'] : ['contacts', 'finish'];
}

export function stepProblem(step, form) {
  if (step === 'install') {
    if (!ZONES[form.zone]) return 'Укажите, где установка: в СПб или за КАД';
    if (!LIFTS[form.lift]) return 'Укажите, есть ли лифт';
    if (form.lift !== 'house' && !(Number.parseInt(form.floor, 10) >= 1)) return 'Укажите этаж';
    if (!OLD_DOORS[form.old]) return 'Укажите, нужно ли снять старую дверь';
  }
  if (step === 'timing') {
    if (!form.when) return 'Укажите, когда планируете монтаж';
    if (!form.measured) return 'Выберите вариант замера';
  }
  if (step === 'contacts') {
    if (!clean(form.name, 80)) return 'Укажите имя';
    if (!normalizePhone(form.phone)) return 'Проверьте номер телефона';
    if (!clean(form.address, 200)) return 'Укажите адрес или ЖК';
  }
  if (step === 'finish') {
    if (!PAYMENTS[form.payment]) return 'Выберите способ оплаты';
    if (!form.consent) return 'Нужно согласие на обработку данных';
  }
  return null;
}

export function validateOrder(form, lines, findItem) {
  if (!lines.length) return 'Корзина пуста';
  for (const step of orderSteps(hasDoors(lines, findItem))) {
    const problem = stepProblem(step, form);
    if (problem) return problem;
  }
  return null;
}

export function orderText(form, lines, findItem) {
  const out = ['Здравствуйте! Заявка из приложения ОЛИМПИЕЦ:', ''];
  for (const line of lines) {
    const item = findItem(line.id);
    const price = line.custom ? null : item.price;
    const size = line.size ? `, ${line.size.replace('x', '×')}${line.custom ? ' (заказной)' : ''}` : '';
    const side = line.side ? `, ${line.side.toLowerCase()}` : '';
    out.push(`• ${item.name}${size}${side}, ${line.qty} шт.: ${price ? money(price * line.qty) : 'цена по запросу'}`);
    if (line.note) out.push(`  ${clean(line.note, 200)}`);
  }
  const sum = estimate(lines, form, findItem);
  out.push('', `Итого за товар: ${money(sum.goods)}${sum.unpriced ? ' + позиции по запросу' : ''}`);
  if (hasDoors(lines, findItem)) {
    out.push(`Монтаж и услуги примерно: ${rangeText(sum.services)}${sum.kmUnknown ? ' + км за КАД' : ''}`);
    out.push(`Всего примерно: ${rangeText(sum.total)}`);
  }
  out.push('', `Имя: ${clean(form.name, 80)}`);
  out.push(`Телефон: ${normalizePhone(form.phone)}`);
  out.push(`Адрес: ${clean(form.address, 200)}`);
  if (hasDoors(lines, findItem)) {
    const km = form.zone === 'out' && Number.parseInt(form.km, 10) > 0 ? `, ${Number.parseInt(form.km, 10)} км` : '';
    out.push(`Район: ${ZONES[form.zone]}${km}`);
    const floor = form.lift === 'house' ? '' : `, этаж ${Number.parseInt(form.floor, 10)}`;
    out.push(`Лифт: ${LIFTS[form.lift]}${floor}`);
    const disposal = form.old !== 'no' && form.disposal ? ', с утилизацией' : '';
    out.push(`Старая дверь: ${OLD_DOORS[form.old]}${disposal}`);
    out.push(`Монтаж: ${form.when}`);
    out.push(`Замер: ${form.measured}`);
  }
  if (form.opening) out.push(`Проём: ${form.opening}`);
  out.push(`Оплата: ${PAYMENTS[form.payment]}`);
  if (clean(form.comment, 300)) out.push(`Комментарий: ${clean(form.comment, 300)}`);
  if (form.source) out.push(`Источник: ${clean(form.source, 64)}`);
  return out.join('\n');
}

export function chatLink({ telegram }, text) {
  return `https://t.me/${telegram}?text=${encodeURIComponent(text)}`;
}

export const PURPOSES = ['Квартира', 'Дом, улица', 'Офис, техническая'];
export const CLIENT_TYPES = ['Застройщик, подрядчик', 'УК, ТСЖ', 'Магазин, дилер', 'Другое'];

export function validateRequest(kind, form) {
  if (!clean(form.name, 80)) return 'Укажите имя';
  if (!normalizePhone(form.phone)) return 'Проверьте номер телефона';
  if (kind === 'custom') {
    if (!form.purpose) return 'Укажите, куда нужна дверь';
    if (!(Number.parseInt(form.width, 10) >= 500 && Number.parseInt(form.height, 10) >= 1500)) return 'Укажите ширину и высоту в миллиметрах, например 900 и 2100';
  } else {
    if (!form.client) return 'Укажите, кто вы';
    if (!clean(form.object, 200)) return 'Укажите объект или город';
    if (!(Number.parseInt(form.qty, 10) >= 2)) return 'Укажите количество дверей';
    if (!form.when) return 'Укажите сроки';
  }
  if (!form.consent) return 'Нужно согласие на обработку данных';
  return null;
}

export function requestText(kind, form) {
  const out = [kind === 'custom' ? 'Здравствуйте! Заявка на дверь на заказ:' : 'Здравствуйте! Оптовый запрос:', ''];
  if (kind === 'custom') {
    out.push(`Куда: ${form.purpose}`);
    out.push(`Размер: ${Number.parseInt(form.width, 10)}×${Number.parseInt(form.height, 10)} мм`);
    out.push(`Количество: ${Math.max(Number.parseInt(form.qty, 10) || 1, 1)}`);
    if (clean(form.wishes, 300)) out.push(`Пожелания: ${clean(form.wishes, 300)}`);
    if (clean(form.address, 200)) out.push(`Адрес: ${clean(form.address, 200)}`);
  } else {
    out.push(`Клиент: ${form.client}`);
    if (clean(form.company, 100)) out.push(`Компания: ${clean(form.company, 100)}`);
    out.push(`Объект: ${clean(form.object, 200)}`);
    out.push(`Количество: ${Number.parseInt(form.qty, 10)}`);
    if (clean(form.wishes, 300)) out.push(`Какие двери: ${clean(form.wishes, 300)}`);
    out.push(`Сроки: ${form.when}`);
  }
  out.push('', `Имя: ${clean(form.name, 80)}`, `Телефон: ${normalizePhone(form.phone)}`);
  if (form.source) out.push(`Источник: ${clean(form.source, 64)}`);
  return out.join('\n');
}
