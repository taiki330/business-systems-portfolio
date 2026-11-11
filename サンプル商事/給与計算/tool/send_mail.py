# -*- coding: utf-8 -*-
"""
共有用シートをメールで送る。Outlook経由。

    python send_mail.py            … 出力フォルダの最新の支給日を送る
    python send_mail.py 20260829   … 支給日を指定

送信ブック（.xlsm）の「送信」ボタンから呼ばれる。
確認事項に警告が残っている月は送らない。
"""

import csv
import glob
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "出力")
設定ファイル = os.path.join(HERE, "送信設定.csv")

未設定の目印 = "ここにメールアドレスを入れてください"


def 設定読込():
    if not os.path.exists(設定ファイル):
        raise SystemExit(f"[中止] 送信設定.csv がありません: {設定ファイル}")
    d = {}
    with io.open(設定ファイル, encoding="utf-8-sig", newline="") as f:
        for r in csv.reader(f):
            if len(r) >= 2 and r[0].strip() and r[0].strip() != "項目":
                d[r[0].strip()] = r[1]
    宛先 = d.get("宛先", "").strip()
    if not 宛先 or 宛先 == 未設定の目印:
        raise SystemExit(
            "[中止] 送信先のメールアドレスが未設定です。\n"
            f"  {os.path.abspath(設定ファイル)} を開き、\n"
            "  「宛先」の行にアドレスを入れて保存してください。")
    if "@" not in 宛先:
        raise SystemExit(f"[中止] 宛先がメールアドレスの形式ではありません: {宛先}")
    return d


def 対象月(引数):
    files = sorted(glob.glob(os.path.join(OUT_DIR, "*_共有用.xlsx")))
    if not files:
        raise SystemExit(
            "[中止] 送るファイルがありません。\n"
            "  先に 実行.bat で共有用シートを作成してください。")
    if 引数:
        p = os.path.join(OUT_DIR, f"{引数}_共有用.xlsx")
        if not os.path.exists(p):
            raise SystemExit(f"[中止] {引数} の共有用シートがありません。")
        return 引数, p
    p = files[-1]
    return os.path.basename(p)[:8], p


def 警告確認(ym):
    """確認事項に未解決の警告が残っていないか調べる。"""
    p = os.path.join(OUT_DIR, f"{ym}_確認事項.txt")
    if not os.path.exists(p):
        return []
    本文 = io.open(p, encoding="utf-8").read()
    if "■ 確認が必要な事項はありません" in 本文:
        return []
    残 = []
    拾う = False
    for line in 本文.splitlines():
        if line.startswith("■ 確認が必要です"):
            拾う = True
            continue
        if 拾う:
            if line.startswith("■") or not line.strip():
                break
            残.append(line.strip())
    return 残


def 送信(ym, 添付, 設定, 実際に送る=True):
    """実際に送る=False のときは、中身を組み立てて表示するだけで送信しない。"""
    import win32com.client as win32

    年, 月, 日 = ym[:4], str(int(ym[4:6])), str(int(ym[6:]))
    def 埋める(s):
        return s.replace("{年}", 年).replace("{月}", 月).replace("{日}", 日)

    outlook = win32.Dispatch("Outlook.Application")
    mail = outlook.CreateItem(0)
    mail.To = 設定["宛先"].strip()
    if 設定.get("CC", "").strip():
        mail.CC = 設定["CC"].strip()
    mail.Subject = 埋める(設定.get("件名", "給与売上 集計"))
    mail.Body = 埋める(設定.get("本文", ""))
    mail.Attachments.Add(os.path.abspath(添付))
    件名, 本文 = mail.Subject, mail.Body
    添付名 = [mail.Attachments.Item(i + 1).FileName for i in range(mail.Attachments.Count)]
    if 実際に送る:
        mail.Send()
    else:
        mail.Delete()
    return {"To": 設定["宛先"].strip(), "件名": 件名, "本文": 本文, "添付": 添付名}


if __name__ == "__main__":
    print("=" * 46)
    print("  共有用シート 送信")
    print("=" * 46)
    print("")

    設定 = 設定読込()
    ym, 添付 = 対象月(sys.argv[1] if len(sys.argv) > 1 else None)

    残 = 警告確認(ym)
    if 残:
        print("[中止] この月には未解決の確認事項が残っています。")
        for r in 残:
            print(f"  {r}")
        print("")
        print("  内容をご確認のうえ、必要なら 実行.bat をやり直してから送信してください。")
        print("  確認済みで問題ないと判断された場合は、")
        print(f"  出力\\{ym}_確認事項.txt の「■ 確認が必要です」の行を削除すると送信できます。")
        raise SystemExit(1)

    確認のみ = "確認" in sys.argv or "--dry-run" in sys.argv
    m = 送信(ym, 添付, 設定, 実際に送る=not 確認のみ)

    print(f"  支給日 : {ym}")
    print(f"  宛先   : {m['To']}")
    print(f"  件名   : {m['件名']}")
    print(f"  添付   : {'、'.join(m['添付'])}")
    print("  本文   :")
    for line in m["本文"].splitlines():
        print(f"    {line}")
    print("")
    if 確認のみ:
        print("■ 確認のみで、送信はしていません。")
        print("  実際に送るには、確認 を付けずに実行してください。")
    else:
        print("■ 送信しました。")
        print("  Outlookの「送信済みアイテム」に残っています。")
