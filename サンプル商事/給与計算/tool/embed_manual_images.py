# -*- coding: utf-8 -*-
"""画像をHTML内に埋め込み、単体で開いても表示されるマニュアルにする。"""
import base64
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
manual = root / "操作マニュアル.html"
html = manual.read_text(encoding="utf-8")
pattern = re.compile(r'src="マニュアル画像/([^"]+\.svg)"')
names = ["01_入力フォルダ.svg", "02_今月のCSV.svg", "03_実行.svg", "04_共有用.svg", "05_従業員登録.svg"]

def replace(match):
    path = root / "マニュアル画像" / match.group(1)
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f'src="data:image/svg+xml;base64,{encoded}"'

if pattern.search(html):
    html, count = pattern.subn(replace, html)
else:
    embedded = re.compile(r'src="data:image/svg\+xml;base64,[A-Za-z0-9+/=]+"')
    found = iter(names)
    def refresh(_match):
        path = root / "マニュアル画像" / next(found)
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f'src="data:image/svg+xml;base64,{encoded}"'
    html, count = embedded.subn(refresh, html)
if count != 5:
    raise SystemExit(f"[中止] 埋め込む画像は5枚のはずです: {count}枚")
manual.write_text(html, encoding="utf-8")
print("5枚の画像をマニュアルに埋め込みました")
