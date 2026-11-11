# -*- coding: utf-8 -*-
"""
送信ブック（送信ボタン付き .xlsm）の作成と更新。

openpyxl でこのブックを書き換えるとボタンが消えるため、Excel経由で扱う。

    python send_book.py 作成    … 送信ブックを新規作成（初回のみ）
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BOOK = os.path.abspath(os.path.join(HERE, "..", "送信ブック.xlsm"))

医院順 = ["サンプル歯科B", "サンプル歯科A", "サンプル歯科C", "サンプル商事", "訪問"]
マクロ名 = "SendSharedSheet"


def _excel():
    import win32com.client as win32
    x = win32.Dispatch("Excel.Application")
    x.Visible = False
    x.DisplayAlerts = False
    return x


def 作成():
    """ボタンだけ置いた空のブックを作る。マクロ本体は初回に人が貼り付ける。"""
    if os.path.exists(BOOK):
        raise SystemExit(f"[中止] すでにあります: {BOOK}\n  作り直す場合は先に削除してください。")
    x = _excel()
    try:
        wb = x.Workbooks.Add()
        ws = wb.Worksheets(1)
        ws.Name = "送信"
        ws.Range("A1").Value = "給与売上 集計 ／ 送信"
        ws.Range("A1").Font.Size = 14
        ws.Range("A1").Font.Bold = True
        ws.Range("A3").Value = "まだ集計されていません。実行.bat を動かしてください。"
        ws.Columns("A").ColumnWidth = 30
        for c in "BCDE":
            ws.Columns(c).ColumnWidth = 20
        sh = ws.Shapes.AddShape(5, 430, 8, 150, 40)      # 角丸四角
        sh.Name = "送信ボタン"
        sh.TextFrame.Characters().Text = "▶ 送信"
        sh.TextFrame.Characters().Font.Size = 13
        sh.TextFrame.Characters().Font.Bold = True
        sh.OnAction = マクロ名
        wb.SaveAs(BOOK, FileFormat=52)                   # xlsm
        wb.Close(False)
    finally:
        x.Quit()
    print(f"作成しました: {BOOK}")
    print("次に tool\\ボタンの設置手順.md に従って、マクロを1回だけ貼り付けてください。")


def 更新(R):
    """当月の数字を書き込む。ボタンとマクロはそのまま残る。"""
    if not os.path.exists(BOOK):
        return None
    ym = R["支給日"]
    x = _excel()
    try:
        wb = x.Workbooks.Open(BOOK)
        ws = wb.Worksheets("送信")
        ws.Range("A3:E30").Clear()
        ws.Range("A3").Value = f"{ym[:4]}年{int(ym[4:6])}月{int(ym[6:])}日 支給分"
        ws.Range("A3").Font.Bold = True
        ws.Range("B5").Value = "給与"
        ws.Range("D5").Value = "賞与"
        for col, v in zip("ABCDE", ["医院", "院内売上表", "りそなに振込", "院内売上表", "りそなに振込"]):
            ws.Range(f"{col}6").Value = v
        ws.Range("A5:E6").Font.Bold = True
        r = 7
        for c in 医院順:
            ws.Range(f"A{r}").Value = c
            ws.Range(f"B{r}").Value = R["院内売上"]["給与"][c]
            ws.Range(f"C{r}").Value = R["振込"]["給与"][c]
            ws.Range(f"D{r}").Value = R["院内売上"]["賞与"][c]
            ws.Range(f"E{r}").Value = R["振込"]["賞与"][c]
            r += 1
        ws.Range(f"A{r}").Value = "合計"
        ws.Range(f"B{r}").Value = sum(R["院内売上"]["給与"].values())
        ws.Range(f"C{r}").Value = sum(R["振込"]["給与"].values())
        ws.Range(f"D{r}").Value = sum(R["院内売上"]["賞与"].values())
        ws.Range(f"E{r}").Value = sum(R["振込"]["賞与"].values())
        ws.Range(f"A{r}:E{r}").Font.Bold = True
        r += 2
        ws.Range(f"A{r}").Value = "院内売上人件費に足す分"
        ws.Range(f"A{r}").Font.Bold = True
        for ラベル, 値 in (("にし・歯科B院・歯科A院・プリベンにそれぞれ足す", R["一口"]),
                           ("訪問に足す", R["従業員A支給_訪問"]),
                           ("歯科A院に足す", R["従業員A支給_歯科A院"])):
            r += 1
            ws.Range(f"A{r}").Value = ラベル
            ws.Range(f"B{r}").Value = 値
        r += 2
        警告 = R["警告"]
        ws.Range(f"A{r}").Value = ("確認事項なし。送信できます。" if not 警告
                                   else "⚠ 確認事項が残っています。送信はできません。")
        ws.Range(f"A{r}").Font.Bold = True
        ws.Range(f"A{r}").Font.Color = 0x006B00 if not 警告 else 0x0000CC
        for w in 警告:
            r += 1
            ws.Range(f"A{r}").Value = w
        ws.Range("B7:E30").NumberFormat = "#,##0"
        wb.Save()
        wb.Close(False)
    finally:
        x.Quit()
    return BOOK


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "作成":
        作成()
    else:
        print(__doc__)
