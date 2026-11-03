// Правила подбора. Значения ориентировочные: сверить с монтажником перед запуском.
const MIN_GAP = 20; // мм, суммарный монтажный зазор по ширине и по высоте
const MAX_GAP = 100; // мм, при большем зазоре проём нужно дорабатывать

export function doorsFit(sizes, opening) {
  return sizes.filter((size) => {
    const [w, h] = size.split('x').map(Number);
    const gapW = opening.w - w;
    const gapH = opening.h - h;
    return gapW >= MIN_GAP && gapW <= MAX_GAP && gapH >= MIN_GAP && gapH <= MAX_GAP;
  });
}

const frame = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#172B3A" stroke-width="5" rx="2"/>`;
const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#087DB8" stroke-width="3" marker-start="url(#a)" marker-end="url(#a)"/>`;
const marker = '<defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#087DB8"/></marker></defs>';

export function measureFigures() {
  return {
    width: `<svg viewBox="0 0 320 190" role="img" aria-label="Ширина: три замера, сверху, посередине, снизу">${marker}
      ${frame(100, 10, 120, 170)}
      ${arrow(104, 35, 216, 35)}${arrow(104, 95, 216, 95)}${arrow(104, 155, 216, 155)}
      <text x="232" y="39">сверху</text><text x="232" y="99">посередине</text><text x="232" y="159">снизу</text></svg>`,
    height: `<svg viewBox="0 0 320 190" role="img" aria-label="Высота: два замера, слева и справа">${marker}
      ${frame(100, 10, 120, 170)}
      ${arrow(125, 14, 125, 176)}${arrow(195, 14, 195, 176)}
      <text x="48" y="99">слева</text><text x="232" y="99">справа</text></svg>`,
    side: `<svg viewBox="0 0 320 170" role="img" aria-label="Левая дверь с петлями слева и правая дверь с петлями справа">
      ${frame(30, 10, 90, 130)}${frame(200, 10, 90, 130)}
      <rect x="26" y="35" width="9" height="18" fill="#087DB8"/><rect x="26" y="100" width="9" height="18" fill="#087DB8"/>
      <circle cx="108" cy="78" r="5" fill="#172B3A"/>
      <rect x="285" y="35" width="9" height="18" fill="#087DB8"/><rect x="285" y="100" width="9" height="18" fill="#087DB8"/>
      <circle cx="212" cy="78" r="5" fill="#172B3A"/>
      <text x="75" y="162" text-anchor="middle">левая</text><text x="245" y="162" text-anchor="middle">правая</text></svg>`,
  };
}
