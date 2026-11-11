# -*- coding: utf-8 -*-
"""納品用の新入職者登録ブックを作る。"""
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

root = Path(__file__).resolve().parent.parent
wb = Workbook()
ws = wb.active
ws.title = "新入職者の登録"
for row, message in ((1, "新入職者の登録"),
                     (2, "新しい方を5行目から追加して保存してください。登録済みの方は入力しません。"),
                     (3, "社員番号の先頭の0は自動で補います。事務・技工士は担当者へご連絡ください。")):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=4)
    ws.cell(row, 1, message)
ws["A1"].font = Font(size=18, bold=True, color="FFFFFF")
ws["A1"].fill = PatternFill("solid", fgColor="27685B")
for col, label in enumerate(("社員番号", "氏名", "所属医院", "職種"), 1):
    cell = ws.cell(4, col, label)
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = PatternFill("solid", fgColor="27685B")
for col, width in (("A", 18), ("B", 24), ("C", 25), ("D", 16)):
    ws.column_dimensions[col].width = width
for row in range(5, 205):
    ws.cell(row, 1).number_format = "000"
ws.freeze_panes = "A5"
for col, values in (("C", "サンプル歯科B,サンプル歯科A,サンプル歯科C,サンプル商事,訪問"),
                    ("D", "Dr,DH,DA,事務,技工士,受付,その他")):
    dropdown = DataValidation(type="list", formula1='"' + values + '"')
    dropdown.error = "一覧から選んでください"
    dropdown.errorTitle = "入力を確認"
    dropdown.showErrorMessage = True
    ws.add_data_validation(dropdown)
    dropdown.add(f"{col}5:{col}204")
wb.save(root / "従業員登録.xlsx")
