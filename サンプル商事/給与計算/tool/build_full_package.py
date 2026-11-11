# -*- coding: utf-8 -*-
"""新規PCと既存PCの両方に使える給与計算一式のZIPを作る。"""
from pathlib import Path
import shutil
import zipfile

import make_package

root = Path(__file__).resolve().parent.parent
stage = root / "_配布準備"
if stage.exists():
    raise SystemExit("[中止] _配布準備 が既にあります。内容を確認してください。")
stage.mkdir()
payload = stage / "給与計算"
make_package.main(str(payload))
for built_name, installed_name in (("給与計算.exe", "payroll.exe"),
                                   ("環境チェック.exe", "check_env.exe"),
                                   ("控えを作る.exe", "backup.exe")):
    executable = root / "_build_dist" / built_name
    if not executable.is_file():
        raise SystemExit(f"[中止] 実行ファイルがありません: {executable}")
    shutil.copy2(executable, payload / installed_name)
for name in ("このパソコンに入れる.bat", "install_full.ps1"):
    shutil.copy2(root / name, stage / name)
(stage / "最初にお読みください.txt").write_text(
    "給与計算 一式の設置\n\n"
    "1. ZIPを右クリックして『すべて展開』します。\n"
    "2. 展開したフォルダの『このパソコンに入れる.bat』をダブルクリックします。\n"
    "3. 『設置しました』または『更新しました』を確認します。\n"
    "4. 『環境チェック.bat』で確認してから、使い方を開きます。\n\n"
    "新しいWindowsパソコンには給与計算一式を設置します。\n"
    "C:\\給与計算 に既存の給与計算があるパソコンでは更新し、\n"
    "登録内容・履歴・入力・出力は保持します。名簿の『中村真一郎』は『中村信一郎』に訂正します。\n\n"
    "Pythonのインストールは不要です。Windowsパソコン向けです。\n"
    "作成した表を開くためにExcelが必要です。Macには対応していません。\n"
    "メールがZIPの添付を拒否する場合は、ファイル共有リンクで渡してください。\n",
    encoding="utf-8",
)
output = root / "給与計算_全体配布.zip"
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for directory, _, filenames in __import__("os").walk(stage):
        relative_dir = Path(directory).relative_to(stage)
        if relative_dir != Path("."):
            archive.writestr(relative_dir.as_posix() + "/", "")
        for name in filenames:
            path = Path(directory) / name
            archive.write(path, path.relative_to(stage).as_posix())
print(output)
