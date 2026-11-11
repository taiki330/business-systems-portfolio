# -*- coding: utf-8 -*-
"""操作マニュアル用のエクスプローラー画面図を作る。"""
from pathlib import Path
from html import escape

root = Path(__file__).resolve().parent.parent / "マニュアル画像"
root.mkdir(exist_ok=True)

def draw(filename, location, rows, selected, callout):
    height = 147 + len(rows) * 49 + 55
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="880" height="{height}" viewBox="0 0 880 {height}" role="img" aria-label="{escape(callout)}">',
             '<rect width="880" height="100%" rx="12" fill="#f7f9fb"/>',
             '<rect x="1" y="1" width="878" height="100%" rx="12" fill="none" stroke="#b7c4ce" stroke-width="2"/>',
             '<rect x="1" y="1" width="878" height="47" rx="12" fill="#e8eef3"/>',
             '<text x="25" y="31" font-size="19" fill="#24313b" font-family="Yu Gothic,Meiryo,sans-serif">📁  エクスプローラー</text>',
             '<rect x="28" y="61" width="824" height="48" rx="6" fill="white" stroke="#c8d2da"/>',
             f'<text x="45" y="92" font-size="19" fill="#263746" font-family="Yu Gothic,Meiryo,sans-serif">{escape(location)}</text>',
             '<text x="46" y="135" font-size="16" fill="#657581" font-family="Yu Gothic,Meiryo,sans-serif">名前</text>',
             '<text x="645" y="135" font-size="16" fill="#657581" font-family="Yu Gothic,Meiryo,sans-serif">種類</text>']
    for i, (label, kind) in enumerate(rows):
        y = 148 + i * 49
        if i == selected:
            parts += [f'<rect x="27" y="{y}" width="826" height="44" rx="5" fill="#d9ebfa" stroke="#2477b5" stroke-width="2"/>',
                      f'<rect x="554" y="{y+5}" width="8" height="34" rx="4" fill="#e34b39"/>']
        icon = "📁" if kind == "フォルダー" else ("📊" if kind == "Excel" else "⚙")
        parts += [f'<text x="44" y="{y+30}" font-size="23" font-family="Yu Gothic,Meiryo,sans-serif">{icon}</text>',
                  f'<text x="85" y="{y+29}" font-size="19" fill="#1e2930" font-family="Yu Gothic,Meiryo,sans-serif">{escape(label)}</text>',
                  f'<text x="646" y="{y+29}" font-size="16" fill="#52616b" font-family="Yu Gothic,Meiryo,sans-serif">{escape(kind)}</text>']
    parts += [f'<text x="30" y="{height-23}" font-size="18" font-weight="bold" fill="#a32f1f" font-family="Yu Gothic,Meiryo,sans-serif">↑ 青く囲んだ {escape(callout)}</text>', '</svg>']
    (root / filename).write_text("\n".join(parts), encoding="utf-8")

draw("01_入力フォルダ.svg", "給与計算",
     [("入力", "フォルダー"), ("出力", "フォルダー"), ("tool", "フォルダー"),
      ("実行.bat", "ファイル"), ("従業員登録.xlsx", "Excel")], 0, "「入力」をダブルクリック")
draw("02_今月のCSV.svg", "給与計算  ›  入力",
     [("20261029_10日〆勤怠支給控除一覧表.csv", "CSV"),
      ("20261029_固定残業10日〆勤怠支給控除一覧表.csv", "CSV"),
      ("20261029_ココロハズム勤怠支給控除一覧表.csv", "CSV")], 0,
     "今月のCSVをこのフォルダに入れる")
draw("03_実行.svg", "給与計算",
     [("入力", "フォルダー"), ("出力", "フォルダー"), ("tool", "フォルダー"),
      ("実行.bat", "ファイル"), ("従業員登録.xlsx", "Excel")], 3, "「実行.bat」をダブルクリック")
draw("04_共有用.svg", "給与計算  ›  出力",
     [("20261029_給与売上（入力シート）.xlsx", "Excel"),
      ("20261029_共有用.xlsx", "Excel"),
      ("20261029_確認事項.txt", "ファイル")], 1, "「共有用.xlsx」をメールに付ける")
draw("05_従業員登録.svg", "給与計算",
     [("入力", "フォルダー"), ("出力", "フォルダー"), ("tool", "フォルダー"),
      ("実行.bat", "ファイル"), ("従業員登録.xlsx", "Excel")], 4,
     "「従業員登録.xlsx」をダブルクリック")
