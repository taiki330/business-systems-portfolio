# -*- coding: utf-8 -*-
"""
納品先のパソコンで、動く状態が揃っているかを調べる。
「環境チェック.bat」から呼ばれる。
"""

import csv
import io
import os
import sys

HERE = (os.path.join(os.path.dirname(sys.executable), "tool")
        if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

結果 = []


def 判定(項目, ok, 詳細="", 必須=True):
    印 = "  OK  " if ok else ("  NG  " if 必須 else "  --  ")
    結果.append((ok or not 必須, f"[{印}] {項目}" + (f"\n           {詳細}" if 詳細 else "")))
    return ok


print("=" * 54)
print("  給与売上シート 環境チェック")
print("=" * 54)
print("")
print(f"  設置場所: {ROOT}")
print("")

# --- OS と設置場所 ----------------------------------------------------
import platform
判定("Windows", os.name == "nt",
     f"{platform.system()} {platform.release()}"
     + ("" if os.name == "nt" else "  ※ このしくみはWindows専用です"))

# 個人PCはデスクトップや書類フォルダがOneDriveに同期されていることが多い。
# 同期フォルダに置くと、処理中のファイルがロックされて失敗することがある。
同期の疑い = any(k in ROOT for k in ("OneDrive", "Dropbox", "Google ドライブ", "GoogleDrive", "iCloud"))
判定("設置場所（同期フォルダでないか）", not 同期の疑い,
     "" if not 同期の疑い else
     "OneDriveなどの同期フォルダの中にあります。\n"
     "           処理中にファイルがロックされて失敗することがあります。\n"
     "           C:\\給与売上シート\\ のような同期されない場所へ移してください。",
     必須=False)

# --- Python -----------------------------------------------------------
v = sys.version_info
判定("Python", v >= (3, 9), f"バージョン {v.major}.{v.minor}.{v.micro}（3.9以上が必要）")

# --- ライブラリ -------------------------------------------------------
try:
    import openpyxl
    判定("openpyxl（Excelの読み書き）", True, f"バージョン {openpyxl.__version__}")
except ImportError:
    判定("openpyxl（Excelの読み書き）", False, "pip install openpyxl を実行してください")

# --- Excel -----------------------------------------------------------
# 集計そのものにExcelは要らない（openpyxlだけで動く）。
# ただし出来上がったファイルを開くために、入っている必要がある。
候補 = []
for base in (os.environ.get("ProgramFiles", ""), os.environ.get("ProgramFiles(x86)", "")):
    if base:
        for sub in (r"Microsoft Office\root\Office16",
                    r"Microsoft Office\Office16",
                    r"Microsoft Office\root\Office15"):
            候補.append(os.path.join(base, sub, "EXCEL.EXE"))
みつかった = [p for p in 候補 if os.path.exists(p)]
判定("Excel", bool(みつかった),
     みつかった[0] if みつかった else
     "見つかりませんでした。集計そのものは動きますが、\n"
     "           出来上がったファイルを開くのに必要です。")

# --- ファイル ---------------------------------------------------------
必要ファイル = [
    ("入力シート_原本.xlsx", os.path.join(ROOT, "入力シート_原本.xlsx"), True),
    ("実行.bat", os.path.join(ROOT, "実行.bat"), True),
    ("tool\\従業員マスタ.csv", os.path.join(HERE, "従業員マスタ.csv"), True),
    ("tool\\履歴.json", os.path.join(HERE, "履歴.json"), False),
]
for 名, p, 必須 in 必要ファイル:
    判定(名, os.path.exists(p), "" if os.path.exists(p) else "見つかりません", 必須)

# --- フォルダと書き込み権限 -------------------------------------------
for 名 in ("入力", "出力"):
    p = os.path.join(ROOT, 名)
    try:
        os.makedirs(p, exist_ok=True)
        試 = os.path.join(p, "_書き込みテスト.tmp")
        with io.open(試, "w", encoding="utf-8") as f:
            f.write("test")
        os.remove(試)
        判定(f"{名}フォルダ（書き込み）", True)
    except Exception as e:
        判定(f"{名}フォルダ（書き込み）", False, str(e)[:90])

# --- 従業員マスタの中身 -----------------------------------------------
try:
    with io.open(os.path.join(HERE, "従業員マスタ.csv"), encoding="utf-8-sig", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r.get("社員番号", "").strip()]
    対象 = [r for r in rows if r["状態"].startswith("対象")]
    按分 = [r for r in rows if r["按分ルール"].strip()]
    判定("従業員マスタの中身", len(対象) > 0,
         f"登録 {len(rows)}名（うち計上対象 {len(対象)}名／按分あり {len(按分)}名）")
except Exception as e:
    判定("従業員マスタの中身", False, str(e)[:90])

# --- 結果 -------------------------------------------------------------
print("")
for _, 行 in 結果:
    print(行)
print("")
NG = [行 for ok, 行 in 結果 if not ok]
if NG:
    print("=" * 54)
    print(f"  {len(NG)}件、足りないものがあります。上の [ NG ] をご確認ください。")
    print("=" * 54)
    sys.exit(1)
print("=" * 54)
print("  すべて揃っています。実行.bat が使えます。")
print("=" * 54)
