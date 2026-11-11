"""Windows用のPython不要な実行ファイルを作る。"""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root / "_build_tools"))
import PyInstaller.__main__

for name, script in (("給与計算", "payroll.py"),
                     ("環境チェック", "check_env.py"),
                     ("控えを作る", "backup.py")):
    PyInstaller.__main__.run([
        "--onefile", "--console", "--noconfirm", "--clean",
        "--name", name,
        "--distpath", str(root / "_build_dist"),
        "--workpath", str(root / "_build_work" / name),
        "--specpath", str(root / "_build_specs"),
        str(root / "tool" / script),
    ])
