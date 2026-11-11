"""配布版の実行ファイルを隔離した設置先で検証するための入力を作る。"""
import csv
from pathlib import Path
import openpyxl

root = Path(__file__).resolve().parent.parent / "_test_exe_target"
wb = openpyxl.load_workbook(root / "従業員登録.xlsx")
ws = wb.active
ws["A5"] = 445
ws["B5"] = "細見香帆"
ws["C5"] = "サンプル歯科A"
ws["D5"] = "DH"
wb.save(root / "従業員登録.xlsx")
for kind in ("10日〆勤怠支給控除一覧表", "固定残業10日〆勤怠支給控除一覧表", "ココロハズム勤怠支給控除一覧表"):
    path = root / "入力" / f"20261029_{kind}_test.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["従業員コード", "氏名", "支給合計", "差引支給合計"])
        if kind.startswith("10日〆"):
            writer.writerow(["445", "細見香帆", "300000", "250000"])
            writer.writerow(["歯科A院", "人数計", "1", "1"])
