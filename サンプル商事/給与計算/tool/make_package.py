# -*- coding: utf-8 -*-
"""
納品用のフォルダを作る。開発用のデータは含めない。

    python make_package.py             … デスクトップに「給与売上シート」を作る
    python make_package.py <出力先>    … 場所を指定
    python make_package.py --zip       … 受け渡し用のZIPも作る
"""

import os
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))

# 納品するもの
ファイル = [
    "実行.bat",
    "セットアップ.bat",
    "環境チェック.bat",
    "控えを作る.bat",
    "入力シート_原本.xlsx",
    "従業員登録.xlsx",
    "操作マニュアル.html",
]
TOOL = [
    "payroll.py",
    "check_env.py",
    "backup.py",
    "従業員マスタ.csv",
    "履歴.json",              # 前月比較の記録。持っていくと初月から比較が効く
]

# 納品しないもの（開発用・確認用）
# 参考データ … 入っていると「入力」が空でも動いてしまい、入れ忘れに気づけない
# 正解データ … 照合用
# 出力       … 過去の生成物
# __pycache__

案内 = """キングオブタイムからダウンロードしたCSVを、このフォルダに入れてください。

毎月4本セットです（賞与のない月は3本）。
  ・10日〆勤怠支給控除一覧表
  ・固定残業10日〆勤怠支給控除一覧表
  ・ココロハズム勤怠支給控除一覧表
  ・賞与支給控除一覧表（賞与のある月のみ）

ファイル名は変更しないでください。先頭の8桁（支給日）で月を判別しています。
処理が終わったら、中身は消していただいて構いません。
"""

はじめに = """給与売上シート

設置後は、デスクトップの「給与計算_フォルダ」を開いてください。
このフォルダをOneDriveなどへ移動しないでください。


【 使い方 】

  「操作マニュアル.html」をダブルクリックすると、
  ブラウザで手順書が開きます。まずこちらをご覧ください。


【 最初の1回だけ必要な準備 】

  ZIPを展開し、上の階層にある「このパソコンに入れる.bat」を
  ダブルクリックしてください。Pythonの導入は不要です。

  その後「環境チェック.bat」をダブルクリック
     すべて [ OK ] になれば準備完了です。

  うまくいかないときは、環境チェックの画面を撮ってご連絡ください。


【 毎月の作業 】

  1. キングオブタイムのCSVを「入力」フォルダへ
  2. 「実行.bat」をダブルクリック
  3. 開いたフォルダから「共有用.xlsx」をメールに添付

  詳しくは「操作マニュアル.html」をご覧ください。


【 取り扱いについて 】

  このフォルダには職員の方の氏名・所属、
  および出力される給与額が含まれます。
  保管にご注意ください。
"""


def main(dest):
    if os.path.exists(dest):
        raise SystemExit(f"[中止] すでにあります: {dest}\n  別の場所を指定するか、先に削除してください。")
    os.makedirs(os.path.join(dest, "tool"))
    os.makedirs(os.path.join(dest, "入力"))
    os.makedirs(os.path.join(dest, "出力"))

    欠け = []
    for f in ファイル:
        src = os.path.join(ROOT, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, f))
        else:
            欠け.append(f)
    for f in TOOL:
        src = os.path.join(HERE, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest, "tool", f))
        elif f != "履歴.json":
            欠け.append("tool\\" + f)

    with open(os.path.join(dest, "入力", "ここにCSVを入れてください.txt"),
              "w", encoding="utf-8") as fp:
        fp.write(案内)

    with open(os.path.join(dest, "はじめにお読みください.txt"),
              "w", encoding="utf-8") as fp:
        fp.write(はじめに)

    print("納品フォルダを作りました:")
    print(f"  {dest}")
    print("")
    print("含めたもの:")
    for f in ファイル:
        print(f"  {f}")
    for f in TOOL:
        if os.path.exists(os.path.join(dest, "tool", f)):
            print(f"  tool\\{f}")
    print("")
    print("含めていないもの: 参考データ／正解データ／出力（開発・確認用のため）")
    if 欠け:
        print("")
        print("※ 見つからなかったファイル:")
        for f in 欠け:
            print(f"  {f}")


def ZIPにする(dest):
    """受け渡し用にZIPへまとめる。

    中身は dest の直下からの相対パスで入れる（先頭にフォルダを作らない）。
    Windowsの「すべて展開」はZIP名のフォルダを自動で作るため、
    ZIP側にも同名フォルダを入れると二重（給与売上シート\\給与売上シート\\）になる。
    """
    zip先 = dest.rstrip("\\/") + ".zip"
    if os.path.exists(zip先):
        os.remove(zip先)
    with zipfile.ZipFile(zip先, "w", zipfile.ZIP_DEFLATED) as z:
        for 根, _, ファイル名一覧 in os.walk(dest):
            for n in ファイル名一覧:
                p = os.path.join(根, n)
                z.write(p, os.path.relpath(p, dest))
    return zip先


if __name__ == "__main__":
    引数 = [a for a in sys.argv[1:] if a != "--zip"]
    ZIPも作る = "--zip" in sys.argv
    if 引数:
        dest = os.path.abspath(引数[0])
    else:
        dest = os.path.join(os.path.expanduser("~"), "Desktop", "給与売上シート")
    main(dest)
    if ZIPも作る:
        z = ZIPにする(dest)
        MB = os.path.getsize(z) / 1024 / 1024
        print("")
        print("ZIPにまとめました:")
        print(f"  {z}  （{MB:.1f} MB）")
        print("")
        print("※ メールに直接添付すると、.bat ファイルが含まれているため")
        print("  Gmailなどに拒否されることがあります。")
        print("  ギガファイル便などのファイル転送サービスか、")
        print("  クラウドの共有リンクでお渡しください。")
