"""登録用Excelと人数計の連携を実データに触れずに確認する。"""
import csv
import shutil
from pathlib import Path

import openpyxl
import payroll

if True:
    root = Path(__file__).resolve().parent.parent / "_test_new_hire"
    (root / "input").mkdir(parents=True, exist_ok=True)
    (root / "output").mkdir(exist_ok=True)
    shutil.copy2(payroll.MASTER, root / "master.csv")
    shutil.copy2(payroll.TEMPLATE, root / "template.xlsx")
    shutil.copy2(payroll.REGISTER, root / "register.xlsx")
    wb = openpyxl.load_workbook(root / "register.xlsx")
    ws = wb.active
    ws["A5"] = 445
    ws["B5"] = "細見香帆"
    ws["C5"] = "サンプル歯科A"
    ws["D5"] = "DH"
    wb.save(root / "register.xlsx")
    payroll.MASTER = str(root / "master.csv")
    payroll.REGISTER = str(root / "register.xlsx")
    payroll.TEMPLATE = str(root / "template.xlsx")
    payroll.IN_DIR = str(root / "input")
    payroll.SAMPLE_DIR = str(root / "none")
    payroll.OUT_DIR = str(root / "output")
    for kind in ("10日〆勤怠支給控除一覧表", "固定残業10日〆勤怠支給控除一覧表", "ココロハズム勤怠支給控除一覧表"):
        path = root / "input" / f"20261029_{kind}_test.csv"
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["従業員コード", "氏名", "支給合計", "差引支給合計"])
            if kind.startswith("10日〆"):
                writer.writerow(["445", "細見香帆", "300000", "250000"])
                writer.writerow(["歯科A院", "人数計", "1", "1"])
    result = payroll.集計("20261029")
    assert result["院内売上"]["給与"]["サンプル歯科A"] == 300000
    assert result["振込"]["給与"]["サンプル歯科A"] == 250000
    assert result["人数"]["給与"] == 1
    output, _ = payroll.シート書き込み(result)
    wb = openpyxl.load_workbook(output, data_only=True)
    assert [wb["新入職者"].cell(2, c).value for c in (1, 2, 5, 6)] == ["445", "細見香帆", 300000, 250000]
    assert payroll.マスタ読込()["006"]["社員番号"] == "006"
    print("OK: 新入職者の計上、個人別表示、人数計の除外、既存番号の維持")
