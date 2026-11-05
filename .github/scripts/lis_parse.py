"""Разбор карточки товара lis78.ru: варианты с остатками, цена, фото, характеристики."""
import html
import re


def clean(text):
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def parse_offers(page):
    """Остатки по вариантам: {'860x2050-L': 3}. В коде варианта зашиты размер и сторона."""
    start = page.find("{'OFFERS':[")
    if start < 0:
        return {}, None
    offers, prices = {}, []
    for chunk in page[start:].split("{'PRICES':")[1:]:
        code = re.search(r"'CODE':'([^']+)'", chunk)
        quantity = re.search(r"'CATALOG_QUANTITY':'?(-?\d+)", chunk)
        price = re.search(r"'CATALOG_PRICE_11':'([\d.]+)", chunk)
        if not code:
            continue
        size = re.search(r"(\d{3,4})x(\d{3,4})", code.group(1))
        side = "L" if code.group(1).endswith("levoe") else "R" if code.group(1).endswith("pravoe") else ""
        key = (f"{size.group(1)}x{size.group(2)}" if size else "any") + (f"-{side}" if side else "")
        offers[key] = max(int(quantity.group(1)), 0) if quantity else 0
        if price:
            prices.append(float(price.group(1)))
    return offers, (round(min(prices)) if prices else None)


def parse_specs(page):
    """Текстовые характеристики вида «Ключ: значение». Описания маркетингом не берём."""
    start = page.find("Характеристики")
    if start < 0:
        return []
    end = page.find("Технические характеристики", start)
    block = page[start:end if end > 0 else start + 8000]
    block = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", block)
    specs = []
    for line in re.sub(r"<[^>]+>", "\n", block).split("\n"):
        line = clean(line)
        if ":" in line and len(line) < 200:
            key, value = line.split(":", 1)
            if key.strip() and value.strip():
                specs.append([key.strip(), value.strip()])
    return specs


def parse_tech(page):
    """Таблица «Технические характеристики»: цвет, бренд и прочее, чередование ключ и значение."""
    start = page.find("Технические характеристики")
    if start < 0:
        return {}
    block = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", page[start:start + 6000])
    lines = [clean(l) for l in re.sub(r"<[^>]+>", "\n", block).split("\n")]
    lines = [l for l in lines if l][1:]
    tech = {}
    for key, value in zip(lines[0::2], lines[1::2]):
        if key in ("Часто спрашивают", "Входные двери", "Межкомнатные двери"):
            break
        tech[key] = value
    return tech


def parse_images(page):
    start = page.find("product__props-block")
    head = page[:start if start > 0 else len(page)]
    found = re.findall(r"/upload/iblock/[^\"' )]+\.(?:jpg|jpeg|png|webp)", head)
    return list(dict.fromkeys(found))


def parse_goods(page, slug, section=None):
    title = re.search(r"<h1[^>]*>([^<]+)", page)
    name = clean(title.group(1)) if title else slug
    model, _, color = name.partition(" - ")
    offers, price = parse_offers(page)
    retail = re.search(r'js-state__price-retail[^>]*>\s*([\d\s\xa0]+)', page)
    if price is None and retail:
        price = int(re.sub(r"\D", "", retail.group(1)) or 0) or None
    return {
        "slug": slug,
        "section": section,
        "name": name,
        "model": model.strip(),
        "color": color.strip(),
        "price": price,
        "offers": offers,
        "images": parse_images(page),
        "specs": parse_specs(page),
        "tech": parse_tech(page),
    }
