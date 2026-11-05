#!/usr/bin/env python3
"""Обновляет app/stock.json: остатки и цены lis78.ru для товаров из каталога.

Запускается по расписанию в GitHub Actions. Если сайт поставщика недоступен, старые данные
не затираются: иначе в приложении всё внезапно стало бы «под заказ».
"""
import json
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lis_parse import parse_goods  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://lis78.ru/catalog/goods/"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
DELAY = 1.2
MIN_SUCCESS = 0.8


def slugs_from_catalog(catalog):
    return sorted({v["slug"] for item in catalog["items"] for v in item.get("variants", [])})


def fetch(slug):
    request = urllib.request.Request(BASE + slug, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=40) as response:
        return response.read().decode("utf8", "ignore")


def main(app_dir):
    catalog = json.loads((app_dir / "catalog.json").read_text(encoding="utf8"))
    slugs = slugs_from_catalog(catalog)
    target = app_dir / "stock.json"
    result, failed = {}, []
    for slug in slugs:
        try:
            parsed = parse_goods(fetch(slug), slug)
            if parsed["offers"]:
                result[slug] = {"offers": parsed["offers"], "price": parsed["price"]}
            else:
                failed.append(slug)
        except Exception as error:
            print("ошибка", slug, error, flush=True)
            failed.append(slug)
        time.sleep(DELAY)
    if not slugs or len(result) / len(slugs) < MIN_SUCCESS:
        print(f"получено {len(result)} из {len(slugs)}: stock.json не трогаем", flush=True)
        return 1
    previous = json.loads(target.read_text(encoding="utf8")).get("items", {}) if target.exists() else {}
    for slug in failed:
        if slug in previous:
            result[slug] = previous[slug]
    moscow = timezone(timedelta(hours=3))
    target.write_text(json.dumps({"updated": datetime.now(moscow).strftime("%d.%m.%Y %H:%M"), "items": result}, ensure_ascii=False), encoding="utf8")
    print(f"обновлено {len(result)} из {len(slugs)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "app"))
