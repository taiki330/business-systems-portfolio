# -*- coding: utf-8 -*-
"""納品済み C:\給与計算 に、登録機能だけを安全に追加する。"""
from datetime import datetime
from pathlib import Path
import shutil
import sys

source = Path(__file__).resolve().parent.parent
target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("C:/給与計算")

required = [target / "実行.bat", target / "tool" / "payroll.py", target / "tool" / "従業員マスタ.csv"]
if not all(p.is_file() for p in required):
    raise SystemExit(f"[中止] 更新先の給与計算フォルダが見つかりません: {target}")

items = [("tool/payroll.py", "tool/payroll.py"),
         ("tool/backup.py", "tool/backup.py"),
         ("操作マニュアル.html", "操作マニュアル.html")]
if not (target / "従業員登録.xlsx").exists():
    items.append(("従業員登録.xlsx", "従業員登録.xlsx"))
else:
    print("従業員登録.xlsx は既にあります。入力済みの内容を保持します。")
for relative_source, _ in items:
    if not (source / relative_source).is_file():
        raise SystemExit(f"[中止] 更新ファイルが足りません: {relative_source}")

backup = target / ("更新前の控え_" + datetime.now().strftime("%Y%m%d_%H%M%S"))
backup.mkdir()
for _, relative_target in items:
    current = target / relative_target
    if current.exists():
        saved = backup / relative_target
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(current, saved)
for relative_source, relative_target in items:
    destination = target / relative_target
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source / relative_source, destination)
    print("更新:", destination)
print("完了しました。従業員登録.xlsx に新しい方を入力できます。")
