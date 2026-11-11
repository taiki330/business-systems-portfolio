"""PV用QR札の裏面印刷データを作る。

入力:
  - QRコード生成（印刷用）.pdf … 現行QRの表示順・商品IDの正本
  - 在庫札 サンプル商事のコピー.xlsx … 写真と発注・在庫管理メモの正本

出力:
  - output/pv_qr_backcards/index.html … QR表面と同じ4列カード配置で印刷する裏面
  - output/pv_qr_backcards/assets/*.jpg … 写真＋管理メモを収めた固定サイズ画像
  - output/pv_qr_backcards/照合結果.csv … 自動照合の結果（未照合を含む）

安全方針:
  誤った資材写真を出力しないことを優先する。完全一致または十分に明確な一致だけ
  写真を採用し、それ以外は「在庫札なし」と表示する。
"""

from __future__ import annotations

import csv
import difflib
import glob
import html
import io
import os
import re
import shutil
import sys
import unicodedata
from pathlib import Path

from openpyxl import load_workbook
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pv_qr_backcards"
ASSET = OUT / "assets"


def pdf_reader_class():
    # 作業環境では pypdf をTEMPへ一時導入する。通常のsite-packagesにある場合も対応する。
    temp_module = Path(os.environ.get("TEMP", "")) / "pv_qr_pdf_tools"
    if temp_module.exists():
        sys.path.insert(0, str(temp_module))
    from pypdf import PdfReader  # type: ignore
    return PdfReader


def normalize(value: object) -> str:
    value = unicodedata.normalize("NFKC", str(value or "")).lower()
    # 品名照合では空白・改行・記号の差を無視する。
    return re.sub(r"[^0-9a-z\u3040-\u30ff\u3400-\u9fff]", "", value)


def input_files() -> tuple[Path, Path]:
    pdfs = [Path(p) for p in glob.glob(str(ROOT / "*.pdf"))]
    qr_pdf = max((p for p in pdfs if p.stat().st_size > 1_000_000), key=lambda p: p.stat().st_mtime)
    books = [Path(p) for p in glob.glob(str(ROOT / "*.xlsx"))]
    stock_cards = max(books, key=lambda p: p.stat().st_size)
    return qr_pdf, stock_cards


def read_qr_order(pdf_path: Path) -> list[dict[str, str]]:
    reader = pdf_reader_class()(str(pdf_path))
    items: list[dict[str, str]] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        # 各ページ末尾の商品IDには改行が付かないため、末尾も区切りとして扱う。
        chunks = re.split(r"\n(P\d{4})(?:\n|$)", text)
        # chunks = [最初のPIDの前文, PID, そのPIDの前に印字される名前・カテゴリ, ...]
        for i in range(1, len(chunks), 2):
            product_id = chunks[i]
            before = chunks[i - 1]
            lines = [x.strip() for x in before.splitlines() if x.strip()]
            if not lines:
                continue
            category_maker = lines[-1]
            name = "".join(lines[:-1]).replace("⼊", "入").replace("⻭", "歯")
            if "/" in category_maker:
                category, maker = [x.strip() for x in category_maker.split("/", 1)]
            else:
                category, maker = category_maker, ""
            items.append({"id": product_id, "name": name, "category": category, "maker": maker})
    if not items:
        raise RuntimeError("QR一覧PDFから商品IDを抽出できませんでした。")
    return items


def read_stock_cards(book_path: Path) -> list[dict]:
    wb = load_workbook(book_path, read_only=False, data_only=True)
    cards: list[dict] = []
    for ws in wb.worksheets:
        for image in ws._images:
            anchor = image.anchor._from
            # 在庫札は画像が3行目、品名がその次の4行目、管理方法が5行目に置かれている。
            name = ws.cell(row=anchor.row + 2, column=anchor.col + 1).value
            rule = ws.cell(row=anchor.row + 3, column=anchor.col + 1).value
            if not name:
                continue
            cards.append({
                "sheet": ws.title,
                "name": str(name),
                "rule": str(rule or ""),
                "norm": normalize(name),
                "image": image,
            })
    return cards


def choose_card(item: dict[str, str], cards: list[dict]) -> tuple[dict | None, str, float]:
    target = normalize(item["name"])
    if not target:
        return None, "未照合", 0.0

    exact = [c for c in cards if c["norm"] == target]
    if len(exact) == 1:
        return exact[0], "完全一致", 1.0

    # 片方が商品名の主要部を含む場合だけ採用。短い一般名（例: タービン）は除外する。
    contained = []
    for c in cards:
        shorter = min(len(target), len(c["norm"]))
        if shorter >= 8 and (target in c["norm"] or c["norm"] in target):
            contained.append((shorter / max(len(target), len(c["norm"])), c))
    contained.sort(key=lambda x: x[0], reverse=True)
    if contained and (len(contained) == 1 or contained[0][0] - contained[1][0] >= 0.12):
        return contained[0][1], "包含一致", contained[0][0]

    # 最終手段の類似照合。次点との差も求め、あいまいなものは採用しない。
    scored = sorted(
        ((difflib.SequenceMatcher(None, target, c["norm"]).ratio(), c) for c in cards),
        key=lambda x: x[0], reverse=True,
    )
    if scored and scored[0][0] >= 0.82 and (len(scored) == 1 or scored[0][0] - scored[1][0] >= 0.10):
        return scored[0][1], "類似一致", scored[0][0]
    return None, "未照合", scored[0][0] if scored else 0.0


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("C:/Windows/Fonts/meiryob.ttc" if bold else "C:/Windows/Fonts/meiryo.ttc"),
        Path("C:/Windows/Fonts/YuGothB.ttc" if bold else "C:/Windows/Fonts/YuGothM.ttc"),
    ]
    for p in candidates:
        if p.exists():
            return ImageFont.truetype(str(p), size=size)
    return ImageFont.load_default()


def wrapped(draw: ImageDraw.ImageDraw, text: str, max_width: int, fnt: ImageFont.ImageFont) -> list[str]:
    lines, current = [], ""
    for char in text.replace("\n", " "):
        candidate = current + char
        if current and draw.textlength(candidate, font=fnt) > max_width:
            lines.append(current)
            current = char
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def make_asset(item: dict[str, str], card: dict | None, destination: Path) -> None:
    canvas = Image.new("RGB", (600, 600), "white")
    draw = ImageDraw.Draw(canvas)
    if card:
        try:
            source = Image.open(io.BytesIO(card["image"]._data())).convert("RGB")
            source.thumbnail((570, 440), Image.Resampling.LANCZOS)
            x = (600 - source.width) // 2
            canvas.paste(source, (x, 10))
        except Exception:
            card = None
    if not card:
        draw.rectangle((12, 12, 588, 588), outline="#c9d0da", width=3)
        draw.text((300, 220), "在庫札の写真なし", anchor="mm", fill="#5a6270", font=font(28, True))
        draw.text((300, 270), "（写真・管理方法の未登録）", anchor="mm", fill="#5a6270", font=font(19))

    # 管理方法は画像の下部に固定表示する。外側カードの高さを変えないので、QR表面と位置が揃う。
    rule = card["rule"].strip() if card else ""
    if rule:
        top = 462
        draw.rectangle((8, top, 592, 592), fill="#eef7f0", outline="#7ab38d", width=2)
        label = font(19, True)
        body = font(20)
        draw.text((18, top + 11), "在庫・発注の目安", fill="#1e7a4d", font=label)
        y = top + 40
        for line in wrapped(draw, rule, 550, body)[:4]:
            draw.text((18, y), line, fill="#1a1a1a", font=body)
            y += 27
    canvas.save(destination, "JPEG", quality=88, optimize=True)


def write_html(items: list[dict], records: list[dict]) -> None:
    rows = []
    by_id = {x["id"]: x for x in records}
    for item in items:
        record = by_id[item["id"]]
        rows.append(
            '<div class="card">'
            f'<img src="assets/{html.escape(item["id"])}.jpg" alt="{html.escape(item["name"])}">'
            f'<div class="name">{html.escape(item["name"])}</div>'
            f'<div class="meta">{html.escape(item["category"])}' + (f' / {html.escape(item["maker"])}' if item["maker"] else '') + '</div>'
            f'<div class="pid">{html.escape(item["id"])}</div>'
            '</div>'
        )
    document = '''<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>PV QRコード裏面札</title>
<style>
:root{--line:#c9d0da;--ink:#1a1a1a;--sub:#5a6270;}
*{box-sizing:border-box} body{margin:0;font-family:"Yu Gothic",Meiryo,sans-serif;color:var(--ink);background:#eef1f5;font-size:14px}
header{padding:12px 16px;background:#fff;border-bottom:2px solid #1e5aa8} h1{font-size:17px;margin:0 0 8px}.hint{color:var(--sub);font-size:12.5px}
main{padding:14px 16px 60px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px;text-align:center;page-break-inside:avoid;break-inside:avoid}
.card img{width:150px;height:150px;object-fit:contain}.name{font-size:12.5px;font-weight:700;margin-top:6px;line-height:1.4;word-break:break-all;min-height:2.6em}.meta{font-size:11px;color:var(--sub);margin-top:3px}.pid{font-size:11px;color:var(--sub);font-family:monospace;margin-top:2px}
button{padding:7px 12px;background:#1e5aa8;color:#fff;border:0;border-radius:5px;font-weight:700;cursor:pointer}
@media print{body{background:#fff}header{display:none}main{padding:0}.grid{grid-template-columns:repeat(4,1fr);gap:6px;grid-auto-rows:245px}.card{height:245px;overflow:hidden;border:1px solid #999}.name{height:2.8em;overflow:hidden}@page{size:A4;margin:8mm}}
</style></head><body><header><h1>PV QRコード 裏面札</h1><div class="hint">表面QRと同じ順序・4列配置です。両面印刷は「短辺とじ」で行ってください。<button onclick="window.print()">印刷する</button></div></header><main><div class="grid">'''
    document += "".join(rows)
    document += "</div></main></body></html>"
    (OUT / "index.html").write_text(document, encoding="utf-8")


def closest_qr(card: dict, items: list[dict]) -> tuple[dict, float]:
    """在庫札を現在QRのどこに近いかで並べるための候補を返す。

    ここは印刷順を寄せるためだけの候補であり、自動確定には使わない。
    """
    target = card["norm"]
    best_item, best_score = items[0], 0.0
    for item in items:
        q = normalize(item["name"])
        if not q:
            continue
        if target == q:
            score = 1.0
        elif len(target) >= 4 and (target in q or q in target):
            score = min(len(target), len(q)) / max(len(target), len(q))
        else:
            score = difflib.SequenceMatcher(None, target, q).ratio()
        if score > best_score:
            best_item, best_score = item, score
    return best_item, best_score


def write_manual_card_html(cards: list[dict], items: list[dict]) -> list[dict]:
    """Excelの在庫札を全件印刷する、人手照合用のHTMLを作る。"""
    manual_out = ROOT / "output" / "pv_inventory_cards_manual"
    manual_assets = manual_out / "assets"
    if manual_out.exists():
        shutil.rmtree(manual_out)
    manual_assets.mkdir(parents=True)

    entries = []
    for n, card in enumerate(cards, 1):
        candidate, score = closest_qr(card, items)
        key = f"S{n:04d}"
        # 写真とExcelに書かれた管理方法をそのまま使う。itemは画像生成の表示用IDだけを渡す。
        make_asset({"id": key, "name": card["name"]}, card, manual_assets / f"{key}.jpg")
        entries.append({
            "key": key, "card": card, "candidate": candidate, "score": score,
            "sort": int(candidate["id"][1:]) if score >= 0.35 else 999999,
        })
    entries.sort(key=lambda x: (x["sort"], -x["score"], x["card"]["sheet"], x["card"]["name"]))

    rows = []
    for entry in entries:
        card, candidate, score = entry["card"], entry["candidate"], entry["score"]
        rows.append(
            '<div class="card">'
            f'<img src="assets/{entry["key"]}.jpg" alt="{html.escape(card["name"])}">'
            f'<div class="name">{html.escape(card["name"])}</div>'
            f'<div class="meta">元シート：{html.escape(card["sheet"])} </div>'
            '</div>'
        )
    document = '''<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>PV 在庫札（手作業照合用）</title>
<style>
:root{--line:#c9d0da;--ink:#1a1a1a;--sub:#5a6270}*{box-sizing:border-box}body{margin:0;font-family:"Yu Gothic",Meiryo,sans-serif;color:var(--ink);background:#eef1f5;font-size:14px}
header{padding:12px 16px;background:#fff;border-bottom:2px solid #1e5aa8}h1{font-size:17px;margin:0 0 8px}.hint{color:var(--sub);font-size:12.5px}button{padding:7px 12px;background:#1e5aa8;color:#fff;border:0;border-radius:5px;font-weight:700;cursor:pointer}
main{padding:14px 16px 60px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}.card{border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px;text-align:center;page-break-inside:avoid;break-inside:avoid}.card img{width:150px;height:150px;object-fit:contain}.name{font-size:12.5px;font-weight:700;margin-top:6px;line-height:1.35;word-break:break-all;height:2.7em;overflow:hidden}.meta{font-size:10px;color:var(--sub);margin-top:3px;line-height:1.25}
@media print{body{background:#fff}header{display:none}main{padding:0}.grid{grid-template-columns:repeat(4,1fr);gap:6px;grid-auto-rows:245px}.card{height:245px;overflow:hidden;border:1px solid #999}@page{size:A4;margin:8mm}}
</style></head><body><header><h1>PV 在庫札（手作業照合用）</h1><div class="hint">Excel内の写真・管理方法カードをすべて掲載。QRに近い順で並べています。人の目で確認して切り出してください。<button onclick="window.print()">印刷する</button></div></header><main><div class="grid">'''
    document += "".join(rows)
    document += "</div></main></body></html>"
    (manual_out / "index.html").write_text(document, encoding="utf-8")
    with (manual_out / "並び順・QR候補.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["印刷順", "在庫札シート", "在庫札の品名", "管理方法"])
        for n, entry in enumerate(entries, 1):
            card = entry["card"]
            writer.writerow([n, card["sheet"], card["name"], card["rule"]])
    return entries


def main() -> None:
    qr_pdf, cards_book = input_files()
    items = read_qr_order(qr_pdf)
    cards = read_stock_cards(cards_book)
    if OUT.exists():
        shutil.rmtree(OUT)
    ASSET.mkdir(parents=True)

    records = []
    for item in items:
        card, method, score = choose_card(item, cards)
        make_asset(item, card, ASSET / f'{item["id"]}.jpg')
        records.append({
            "id": item["id"], "qr_name": item["name"], "category": item["category"],
            "method": method, "score": f"{score:.3f}",
            "card_sheet": card["sheet"] if card else "", "card_name": card["name"] if card else "",
            "rule": card["rule"] if card else "",
        })
    write_html(items, records)
    with (OUT / "照合結果.csv").open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(records[0].keys()))
        writer.writeheader(); writer.writerows(records)
    counts = {}
    for x in records: counts[x["method"]] = counts.get(x["method"], 0) + 1
    manual_entries = write_manual_card_html(cards, items)
    print("出力:", OUT)
    print("QR枚数:", len(items), "照合:", counts)
    print("手作業用在庫札:", len(manual_entries))


if __name__ == "__main__":
    main()
