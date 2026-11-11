# -*- coding: utf-8 -*-
"""
やり直しのきかない設定ファイルを、日付つきでまとめて控えに残す。

    python backup.py            … 「控え」フォルダに保存
    python backup.py <保存先>   … 場所を指定（USBメモリなど）

パソコンの買い替えや故障に備えて、ときどき実行してください。
毎月の作業には不要です。
"""

import datetime
import os
import shutil
import sys
import zipfile

HERE = (os.path.join(os.path.dirname(sys.executable), "tool")
        if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

# 失うと作り直しが大変なもの
対象 = [
    ("tool/従業員マスタ.csv", os.path.join(HERE, "従業員マスタ.csv")),
    ("tool/送信設定.csv", os.path.join(HERE, "送信設定.csv")),
    ("tool/履歴.json", os.path.join(HERE, "履歴.json")),
    ("入力シート_原本.xlsx", os.path.join(ROOT, "入力シート_原本.xlsx")),
    ("従業員登録.xlsx", os.path.join(ROOT, "従業員登録.xlsx")),
]


def main(保存先):
    os.makedirs(保存先, exist_ok=True)
    日付 = datetime.date.today().strftime("%Y%m%d")
    zip先 = os.path.join(保存先, f"給与売上シート_控え_{日付}.zip")

    入れたもの, 無かったもの = [], []
    with zipfile.ZipFile(zip先, "w", zipfile.ZIP_DEFLATED) as z:
        for 名, p in 対象:
            if os.path.exists(p):
                z.write(p, 名)
                入れたもの.append(名)
            else:
                無かったもの.append(名)

    print("控えを作りました:")
    print(f"  {zip先}")
    print("")
    for 名 in 入れたもの:
        print(f"  ・{名}")
    if 無かったもの:
        print("")
        print("  見つからなかったもの:")
        for 名 in 無かったもの:
            print(f"  ・{名}")
    print("")
    print("  このファイルを、USBメモリやクラウドなど")
    print("  このパソコン以外の場所にも置いておいてください。")


if __name__ == "__main__":
    print("=" * 46)
    print("  設定の控えを作る")
    print("=" * 46)
    print("")
    先 = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "控え")
    main(先)
