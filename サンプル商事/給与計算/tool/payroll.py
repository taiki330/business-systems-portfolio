# -*- coding: utf-8 -*-
"""
キングオブタイムの勤怠支給控除一覧表CSVを読み、
「給与売上（入力シート）」への書き込みと、医院共有用シートを作成する。

    実行.bat            … 「入力」フォルダの最新の支給日を処理
    実行.bat 20260829   … 支給日を指定

CSVは支給日ごとに4本セット（10日〆／固定残業10日〆／ココロハズム／賞与）。
列の位置は月ごとに変わるため、必ず項目名で引く。

按分の粒度は現行シートの数式に合わせている（詳細は下の「按分の仕様」を参照）。
"""

import csv
import glob
import io
import json
import os
import sys
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

import openpyxl

HERE = (os.path.join(os.path.dirname(sys.executable), "tool")
        if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__)))
IN_DIR = os.path.join(HERE, "..", "入力")
SAMPLE_DIR = os.path.join(HERE, "..", "参考データ")
OUT_DIR = os.path.join(HERE, "..", "出力")


MASTER = os.path.join(HERE, "従業員マスタ.csv")
REGISTER = os.path.join(HERE, "..", "従業員登録.xlsx")
TEMPLATE = os.path.join(HERE, "..", "入力シート_原本.xlsx")


def データ場所():
    """「入力」フォルダにCSVがあればそれを使い、無ければ参考データを見る。"""
    if glob.glob(os.path.join(IN_DIR, "*.csv")):
        return IN_DIR
    if glob.glob(os.path.join(SAMPLE_DIR, "*.csv")):
        print("※「入力」フォルダが空です。動作確認用の参考データを処理します。")
        print("　 実際の月次作業では、キングオブタイムのCSVを「入力」フォルダに入れてください。\n")
        return SAMPLE_DIR
    raise SystemExit(f"[中止] CSVがありません。「入力」フォルダに入れてください: {os.path.abspath(IN_DIR)}")

支給列 = "支給合計"
振込列 = "差引支給合計"

医院順 = ["サンプル歯科B", "サンプル歯科A", "サンプル歯科C", "サンプル商事", "訪問"]
按分先4医院 = ["サンプル歯科C", "サンプル歯科B", "サンプル歯科A", "サンプル商事"]

# ---------------------------------------------------------------------------
# 按分の仕様（現行シートの数式をそのまま再現している）
#
#   支給合計（院内売上人件費）側は、給与と賞与を合算してから割る。
#     事務+技工士  R6 = R4+R5+S4+S5+R10   →  V11 = ROUND(R6/4,0)
#     従業員A様       S12 = R12+R13          →  V13 = ROUND(S12*4/5,0)  訪問
#                                            W13 = ROUND(S12*1/5,0)  歯科A院
#
#   差引支給合計（りそなに振込）側は、給与と賞与を別々に割る。
#     歯科A院 給与  SUM(I9:I22)+ROUND(I24*1/5,0)
#     訪問 給与  SUM(I52+I53)+ROUND(I24*4/5,0)
#     歯科A院 賞与  SUM(L9:L22)+ROUND(L24*1/5,0)
#     訪問 賞与  SUM(L52+L53)+ROUND(L24*4/5,0)
#
#   事務（従業員B様）は差引支給合計のみ所属医院（サンプル商事）の行に入り、
#   支給合計は行に入れず右側の事務欄から4医院へ配分する。
# ---------------------------------------------------------------------------

# 右側の按分ブロックの書き込み先。(給与のセル, 賞与のセル)
右ブロック = {
    "435": ("R4", "R5"),    # 事務   佐々木 四郎
    "084": ("R8", "R9"),    # 技工士 佐藤 次郎
    "425": ("S8", "S9"),    # 技工士 高橋 三郎
    "019": ("R12", "R13"),  # 訪問   鈴木 一郎
}
# 支給合計を名簿の行（H列・K列）に書かない方。上の右ブロックで扱う。
行に支給を書かない = set(右ブロック)


def ROUND(x):
    """ExcelのROUND(x,0)と同じ丸め（0.5は絶対値の大きい方へ）。"""
    return int(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def 金額(s):
    s = (s or "").strip().replace(",", "")
    return 0 if s in ("", "-") else int(round(float(s)))


def マスタ読込():
    with io.open(MASTER, encoding="utf-8-sig", newline="") as f:
        master = {r["社員番号"].strip(): r for r in csv.DictReader(f) if r["社員番号"].strip()}
    if not os.path.exists(REGISTER):
        return master
    try:
        wb = openpyxl.load_workbook(REGISTER, read_only=True, data_only=True)
        ws = wb.active
        seen = set()
        for rowno, row in enumerate(ws.iter_rows(min_row=5, max_col=4, values_only=True), 5):
            if not any(v is not None and str(v).strip() for v in row):
                continue
            if any(v is None or not str(v).strip() for v in row):
                raise ValueError(f"{rowno}行目: 4項目をすべて入力してください")
            raw = str(row[0]).strip()
            if isinstance(row[0], float) and row[0].is_integer():
                raw = str(int(row[0]))
            if not raw.isdigit() or len(raw) > 3:
                raise ValueError(f"{rowno}行目: 社員番号は3桁以内の数字にしてください")
            code = raw.zfill(3)
            name, hospital, role = (str(v).strip() for v in row[1:])
            if code in seen or code in master:
                raise ValueError(f"{rowno}行目: 社員番号 {code} が重複しています")
            if hospital not in 医院順:
                raise ValueError(f"{rowno}行目: 所属医院を選択肢から選んでください")
            if role not in ("Dr", "DH", "DA", "事務", "技工士", "受付", "その他"):
                raise ValueError(f"{rowno}行目: 職種を選択肢から選んでください")
            if role in ("事務", "技工士"):
                raise ValueError(f"{rowno}行目: {role}の医院への配分は担当者へ確認してください")
            master[code] = {"社員番号": code, "氏名": name, "所属医院": hospital,
                            "区分": role, "入力シート行": "", "按分ルール": "",
                            "状態": "対象", "備考": "登録用Excelから追加"}
            seen.add(code)
        wb.close()
    except Exception as e:
        raise SystemExit(f"[中止] 従業員登録.xlsx を確認してください: {e}")
    return master


def 種別(basename):
    if "賞与" in basename:
        return "賞与"
    if "ココロハズム" in basename:
        return "ココロハズム"
    if "固定残業" in basename:
        return "固定残業"
    return "10日〆"


def CSV読込(path):
    with io.open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    try:
        hi = next(i for i, r in enumerate(rows) if r and r[0].strip() == "従業員コード")
    except StopIteration:
        raise SystemExit(f"[中止] ヘッダー行が見つかりません: {os.path.basename(path)}")
    head = [c.strip() for c in rows[hi]]
    for col in (支給列, 振込列):
        if col not in head:
            raise SystemExit(f"[中止] 「{col}」列がありません: {os.path.basename(path)}")
    i支給, i振込 = head.index(支給列), head.index(振込列)
    out = []
    for r in rows[hi + 1:]:
        if not r or not r[0].strip() or r[0].strip() == "全社合計":
            continue
        out.append((r[0].strip(), r[1].strip(), 金額(r[i支給]), 金額(r[i振込])))
    return out


def 集計(支給日):
    master = マスタ読込()
    data_dir = データ場所()
    files = sorted(glob.glob(os.path.join(data_dir, f"{支給日}_*.csv")))
    if not files:
        raise SystemExit(f"[中止] {支給日} のCSVが見つかりません: {data_dir}")

    警告 = []
    種別一覧 = {種別(os.path.basename(p)) for p in files}
    for need in ("10日〆", "固定残業", "ココロハズム"):
        if need not in 種別一覧:
            警告.append(f"CSVが不足しています —「{need}」のファイルがありません")

    値 = {"給与": {}, "賞与": {}}
    出所 = defaultdict(list)
    for p in files:
        b = os.path.basename(p)
        区分 = "賞与" if 種別(b) == "賞与" else "給与"
        for code, name, 支給, 振込 in CSV読込(p):
            if code in 値[区分]:
                警告.append(
                    f"重複 — {name}（{code}）が{区分}で複数のファイルにあります: "
                    f"{'／'.join(出所[(区分, code)])} と {種別(b)}"
                )
            else:
                値[区分][code] = (name, 支給, 振込)
            出所[(区分, code)].append(種別(b))

    # 知らない社員番号は警告ではなく中止にする。
    # 警告のままだとその方が黙って集計から抜け落ちるため。
    未登録 = {}
    for 区分 in ("給与", "賞与"):
        for code, (name, _, _) in 値[区分].items():
            if name == "人数計" and code in ("にしさんそう", "歯科B院", "歯科A院", "サンプル商事", "技工", "役員", "訪問"):
                continue
            if code not in master:
                未登録[code] = name
    if 未登録:
        行 = "\n".join(f"    {n}（{c}）" for c, n in sorted(未登録.items(), key=lambda x: x[1]))
        raise SystemExit(
            "[中止] マスタにない社員番号があります。\n"
            f"{行}\n\n"
            "  入職された方であれば、tool\\従業員マスタ.csv に次の形で1行足してください。\n"
            "    社員番号,氏名,所属医院,区分,入力シート行,按分ルール,状態,備考\n"
            "    123,山田花子,サンプル歯科A,DH,,,対象,\n\n"
            "  所属医院は サンプル歯科B／サンプル歯科A／サンプル歯科C／サンプル商事／訪問 のいずれか。\n"
            "  計上しない方であれば、状態の欄を 除外:理由 にしてください。\n"
            "  この方の所属が分からないと、どの医院の人件費に入れるか決められません。")

    # --- 医院別の素の合計（名簿の行に入る分だけ） ---
    素 = {k: defaultdict(int) for k in ("給与支給", "給与振込", "賞与支給", "賞与振込")}
    事務技工pot = 0            # 支給合計・給与賞与を合算
    従業員A支給pot = 0            # 同上
    従業員A振込 = {"給与": 0, "賞与": 0}
    人数 = {"給与": 0, "賞与": 0}
    セル値 = defaultdict(dict)  # code -> {"給与支給":.., ...}
    総支給 = 0            # 対象者の支給合計の総和（突合用）
    総振込 = 0            # 同・差引支給合計
    技工士振込 = 0        # ココロハズム所属のため医院に計上しない分
    名簿 = {}             # code -> [氏名, 所属医院]（前月との比較用）
    未知医院 = {}         # 医院順にない所属名 -> その方々

    for 区分 in ("給与", "賞与"):
        for code, (name, 支給, 振込) in 値[区分].items():
            if name == "人数計" and code in ("にしさんそう", "歯科B院", "歯科A院", "サンプル商事", "技工", "役員", "訪問"):
                continue
            m = master.get(code)
            if not m or not m["状態"].startswith("対象"):
                continue
            def 医院を確かめる():
                # 金額をその医院の集計に入れる方だけ確認する。
                # 技工士はココロハズム所属で、医院には按分でしか入らないので対象外。
                名 = m["所属医院"].strip()
                if 名 not in 医院順:
                    未知医院.setdefault(名 or "（空欄）", []).append(f"{name}（{code}）")
            人数[区分] += 1
            医院 = m["所属医院"]
            rule = m["按分ルール"].strip()
            セル値[code][f"{区分}支給"] = 支給
            セル値[code][f"{区分}振込"] = 振込
            総支給 += 支給
            総振込 += 振込
            名簿[code] = [name, 医院 or "（未設定）"]

            if rule == "4医院1/4" and m["区分"] != "事務":
                技工士振込 += 振込

            if rule == "訪問4/5歯科A院1/5":
                従業員A支給pot += 支給
                従業員A振込[区分] += 振込
            elif rule == "4医院1/4":
                事務技工pot += 支給
                # 事務は所属医院の行に振込のみ入る。技工士は行そのものがない。
                if m["区分"] == "事務":
                    医院を確かめる()
                    素[f"{区分}振込"][医院] += 振込
            else:
                医院を確かめる()
                素[f"{区分}支給"][医院] += 支給
                素[f"{区分}振込"][医院] += 振込

    if 未知医院:
        行 = []
        for 医院, 人 in 未知医院.items():
            行.append(f"    {医院} … {'、'.join(人)}")
        raise SystemExit(
            "[中止] マスタの「所属医院」に、扱いの決まっていない名前があります。\n"
            + "\n".join(行) + "\n\n"
            "  使える所属医院は次の5つだけです。\n"
            f"    {'／'.join(医院順)}\n\n"
            "  書き間違いであれば、tool\\従業員マスタ.csv を直してください。\n"
            "  医院そのものが増えた場合は、集計の作り替えが必要です。ベクサムにご連絡ください。")

    # 按分は「院内売上表」の合計には含めず、別枠で示す（現行シートと同じ形）。
    一口 = ROUND(事務技工pot / 4)
    従業員A支給_訪問 = ROUND(従業員A支給pot * 4 / 5)
    従業員A支給_歯科A院 = ROUND(従業員A支給pot * 1 / 5)

    院内売上 = {区分: {c: 素[f"{区分}支給"][c] for c in 医院順} for 区分 in ("給与", "賞与")}

    # りそな振込には従業員A様の按分を含める（現行シートの数式どおり）。
    振込 = {"給与": {}, "賞与": {}}
    for 区分 in ("給与", "賞与"):
        for c in 医院順:
            v = 素[f"{区分}振込"][c]
            if c == "訪問":
                v += ROUND(従業員A振込[区分] * 4 / 5)
            if c == "サンプル歯科A":
                v += ROUND(従業員A振込[区分] * 1 / 5)
            振込[区分][c] = v

    # --- 突合 ---------------------------------------------------------
    # 対象者の総額と、医院に配った総額が1円でも合わなければ処理を止める。
    # 誰かが医院に割り当てられずに消える、という事故を構造的に防ぐ。
    配布支給 = (sum(院内売上["給与"].values()) + sum(院内売上["賞与"].values())
                + 事務技工pot + 従業員A支給pot)
    if 配布支給 != 総支給:
        raise SystemExit(
            "[中止] 金額が合いません（支給合計）。\n"
            f"  CSVの対象者合計 : {総支給:,} 円\n"
            f"  医院に配った合計 : {配布支給:,} 円\n"
            f"  差              : {配布支給 - 総支給:+,} 円\n"
            "  マスタの所属医院や按分ルールをご確認ください。")

    配布振込 = sum(振込["給与"].values()) + sum(振込["賞与"].values())
    if 配布振込 != 総振込 - 技工士振込:
        raise SystemExit(
            "[中止] 金額が合いません（差引支給合計）。\n"
            f"  CSVの対象者合計 : {総振込 - 技工士振込:,} 円（技工士{技工士振込:,}円を除く）\n"
            f"  医院に配った合計 : {配布振込:,} 円\n"
            f"  差              : {配布振込 - (総振込 - 技工士振込):+,} 円")

    return {
        "支給日": 支給日,
        "files": [os.path.basename(p) for p in files],
        "警告": 警告,
        "人数": 人数,
        "名簿": 名簿,
        "院内売上": 院内売上,
        "振込": 振込,
        "一口": 一口,
        "従業員A支給_訪問": 従業員A支給_訪問,
        "従業員A支給_歯科A院": 従業員A支給_歯科A院,
        "事務技工pot": 事務技工pot,
        "従業員A支給pot": 従業員A支給pot,
        "従業員A振込": 従業員A振込,
        "セル値": セル値,
        "master": master,
    }


def 保存(wb, path):
    """Excelで開いたままだと上書きできないので、分かる言葉で知らせる。"""
    try:
        wb.save(path)
    except PermissionError:
        raise SystemExit(
            "[中止] ファイルを上書きできませんでした:\n"
            f"    {os.path.basename(path)}\n\n"
            "  同じ名前のファイルをExcelで開いたままにしていませんか。\n"
            "  閉じてから、もう一度 実行.bat を動かしてください。")


def シート書き込み(R):
    os.makedirs(OUT_DIR, exist_ok=True)
    ym = R["支給日"]

    # --- 入力シート ---
    wb = openpyxl.load_workbook(TEMPLATE)
    ws = wb.worksheets[0]
    ws["R3"] = "従業員B"   # 事務欄が旧姓のままなので現姓に直す
    for code, vals in R["セル値"].items():
        m = R["master"][code]
        行 = m["入力シート行"].strip()
        if 行:
            r = int(行)
            if code not in 行に支給を書かない:
                if "給与支給" in vals: ws[f"H{r}"] = vals["給与支給"]
                if "賞与支給" in vals: ws[f"K{r}"] = vals["賞与支給"]
            if "給与振込" in vals: ws[f"I{r}"] = vals["給与振込"]
            if "賞与振込" in vals: ws[f"L{r}"] = vals["賞与振込"]
        if code in 右ブロック:
            給与セル, 賞与セル = 右ブロック[code]
            if "給与支給" in vals: ws[給与セル] = vals["給与支給"]
            if "賞与支給" in vals: ws[賞与セル] = vals["賞与支給"]
    p1 = os.path.join(OUT_DIR, f"{ym}_給与売上（入力シート）.xlsx")
    新規 = [(code, R["master"][code], vals) for code, vals in R["セル値"].items()
            if R["master"][code]["備考"] == "登録用Excelから追加"]
    if 新規:
        extra = wb.create_sheet("新入職者")
        extra.sheet_properties.pageSetUpPr.fitToPage = True
        extra.append(["社員番号", "氏名", "所属医院", "職種", "給与支給", "給与振込", "賞与支給", "賞与振込"])
        for code, m, vals in 新規:
            extra.append([code, m["氏名"], m["所属医院"], m["区分"],
                          vals.get("給与支給", 0), vals.get("給与振込", 0),
                          vals.get("賞与支給", 0), vals.get("賞与振込", 0)])
        for col, width in {"A": 12, "B": 20, "C": 22, "D": 12, "E": 16, "F": 16, "G": 16, "H": 16}.items():
            extra.column_dimensions[col].width = width
    保存(wb, p1)

    # --- 共有用（医院に提示する分だけ） ---
    wb2 = openpyxl.Workbook()
    ws2 = wb2.active
    ws2.title = "共有用"
    ws2["A1"] = f"{ym[:4]}年{int(ym[4:6])}月{int(ym[6:])}日 支給分"
    ws2["A1"].font = openpyxl.styles.Font(bold=True, size=13)
    ws2.append([])
    太字 = openpyxl.styles.Font(bold=True)
    ws2.append(["", "給与", "", "賞与", ""])
    ws2.append(["医院", "院内売上表（total)", "りそなに振込（total)",
                "院内売上表（total)", "りそなに振込（total)"])
    for r in (3, 4):
        for c in ws2[r]:
            c.font = 太字
    for c in 医院順:
        ws2.append([c,
                    R["院内売上"]["給与"][c], R["振込"]["給与"][c],
                    R["院内売上"]["賞与"][c], R["振込"]["賞与"][c]])
    数値開始 = 5
    ws2.append(["合計",
                sum(R["院内売上"]["給与"].values()), sum(R["振込"]["給与"].values()),
                sum(R["院内売上"]["賞与"].values()), sum(R["振込"]["賞与"].values())])
    ws2[f"A{ws2.max_row}"].font = 太字

    # 按分は各医院が自分の分に足す。合計には含めない。
    ws2.append([])
    ws2.append(["院内売上人件費に足す分"])
    ws2[f"A{ws2.max_row}"].font = 太字
    ws2.append(["にし・歯科B院・歯科A院・プリベンにそれぞれ足す", R["一口"]])
    ws2.append(["訪問に足す", R["従業員A支給_訪問"]])
    ws2.append(["歯科A院に足す", R["従業員A支給_歯科A院"]])

    for row in ws2.iter_rows(min_row=数値開始, min_col=2):
        for c in row:
            if isinstance(c.value, int):
                c.number_format = "#,##0"
    ws2.column_dimensions["A"].width = 34
    for col in "BCDE":
        ws2.column_dimensions[col].width = 20
    p2 = os.path.join(OUT_DIR, f"{ym}_共有用.xlsx")
    保存(wb2, p2)
    return p1, p2


# 履歴は tool 側に置く。「出力」フォルダを掃除しても前月比較が失われないようにするため。
HISTORY = os.path.join(HERE, "履歴.json")


def 前月比較(R):
    """前回処理した支給日と名簿を突き合わせ、増えた方・減った方を洗い出す。"""
    hist = {}
    if os.path.exists(HISTORY):
        with io.open(HISTORY, encoding="utf-8") as f:
            hist = json.load(f)
    前回 = sorted([k for k in hist if k < R["支給日"]])
    行 = []
    if 前回:
        p = 前回[-1]
        旧 = hist[p]["名簿"]
        新 = R["名簿"]
        増 = [(c, 新[c]) for c in 新 if c not in 旧]
        減 = [(c, 旧[c]) for c in 旧 if c not in 新]
        異動 = [(c, 旧[c][1], 新[c][1]) for c in 新 if c in 旧 and 旧[c][1] != 新[c][1]]
        行.append(f"■ 前回（{p}）との比較　{len(旧)}名 → {len(新)}名")
        if not (増 or 減 or 異動):
            行.append("  変動はありません")
        for c, (n, k) in 増:
            行.append(f"  ＋ {n}（{c}）{k}　… 入職・復帰の方です。所属が正しいかご確認ください")
        for c, (n, k) in 減:
            行.append(f"  − {n}（{c}）{k}　… 退職・育休などで今月は計上されません")
        for c, o, n in 異動:
            行.append(f"  ⇄ {R['名簿'][c][0]}（{c}）{o} → {n}　… マスタで所属を変更されています")

        # 医院間の異動はCSVから判別できない（所属情報が無いため）。
        # 異動があると2つの医院が逆向きに同額ずつ動くので、その形を目で見つけられるよう
        # 医院別の増減を並べる。
        旧金額 = hist[p].get("医院別")
        if 旧金額:
            行.append("")
            行.append("■ 医院別の前月比（院内売上表・給与）")
            行.append(f"  {'医院':<18}{'前回':>13}{'今回':>13}{'増減':>13}")
            for c in 医院順:
                旧v = 旧金額.get(c, 0)
                新v = R["院内売上"]["給与"][c]
                行.append(f"  {c:<18}{旧v:>13,}{新v:>13,}{新v - 旧v:>+13,}")
            行.append("  ※ 2つの医院が逆向きに同じくらい動いていたら、")
            行.append("  　 医院間の異動かもしれません。マスタの所属をご確認ください。")
    else:
        行.append("■ 前回の記録がないため、増減の比較は次回から行います")
    hist[R["支給日"]] = {
        "名簿": R["名簿"],
        "医院別": {c: R["院内売上"]["給与"][c] for c in 医院順},
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with io.open(HISTORY, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, indent=1)
    return 行


def レポート(R):
    L = [f"支給日 {R['支給日']}", "読み込んだファイル:"]
    L += [f"  - {f}" for f in R["files"]]
    L.append("")
    if R["警告"]:
        L.append("■ 確認が必要です")
        L += [f"  {w}" for w in R["警告"]]
    else:
        L.append("■ 確認が必要な事項はありません")
    L.append("")
    L += 前月比較(R)
    L.append("")
    L.append("■ 金額の突合: CSVの対象者合計と、医院に配った合計が一致しました")
    L.append("")
    L.append(f"■ 集計（給与 {R['人数']['給与']}名 ／ 賞与 {R['人数']['賞与']}名）")
    L.append(f"  {'':<18}{'--- 給与 ---':>30}{'--- 賞与 ---':>30}")
    L.append(f"  {'医院':<18}{'院内売上表':>15}{'りそなに振込':>15}{'院内売上表':>15}{'りそなに振込':>15}")
    for c in 医院順:
        L.append(f"  {c:<18}{R['院内売上']['給与'][c]:>15,}{R['振込']['給与'][c]:>15,}"
                 f"{R['院内売上']['賞与'][c]:>15,}{R['振込']['賞与'][c]:>15,}")
    L.append(f"  {'合計':<18}{sum(R['院内売上']['給与'].values()):>15,}{sum(R['振込']['給与'].values()):>15,}"
             f"{sum(R['院内売上']['賞与'].values()):>15,}{sum(R['振込']['賞与'].values()):>15,}")
    L.append("")
    L.append("■ 院内売上人件費に足す分（上の表には含まれていません）")
    L.append(f"  にし・歯科B院・歯科A院・プリベンにそれぞれ足す : {R['一口']:>11,}  "
             f"（事務+技工士 {R['事務技工pot']:,} 円 ÷4）")
    L.append(f"  訪問に足す                             : {R['従業員A支給_訪問']:>11,}  "
             f"（従業員A様 {R['従業員A支給pot']:,} 円 の4/5）")
    L.append(f"  歯科A院に足す                             : {R['従業員A支給_歯科A院']:>11,}  "
             f"（同 1/5）")
    return "\n".join(L)


if __name__ == "__main__":
    print("=" * 46)
    print("  給与売上シート 作成")
    print("=" * 46)
    print("")
    ym = sys.argv[1] if len(sys.argv) > 1 else None
    if not ym:
        csvs = glob.glob(os.path.join(データ場所(), "*.csv"))
        if not csvs:
            raise SystemExit(f"[中止] 「入力」フォルダにCSVがありません: {os.path.abspath(IN_DIR)}")
        支給日一覧 = sorted({os.path.basename(p)[:8] for p in csvs})
        if len(支給日一覧) > 1:
            print(f"※ 複数の支給日があります: {'、'.join(支給日一覧)}")
            print(f"  最新の {支給日一覧[-1]} を処理します。"
                  "他を処理するには 実行.bat のあとに支給日を指定してください。\n")
        ym = 支給日一覧[-1]
    R = 集計(ym)
    本文 = レポート(R)
    print(本文)
    p1, p2 = シート書き込み(R)
    os.makedirs(OUT_DIR, exist_ok=True)
    with io.open(os.path.join(OUT_DIR, f"{ym}_確認事項.txt"), "w", encoding="utf-8") as f:
        f.write(本文)
    print("")
    print("■ 出力しました（「出力」フォルダ）")
    開く = True
    print(f"  {os.path.basename(p1)}   ← 担当者様がお使いになる分（全員の給与が入っています）")
    print(f"  {os.path.basename(p2)}   ← メールに添付してお送りする分")
    print(f"  {ym}_確認事項.txt")

    # メールに添付しやすいよう、出力フォルダをエクスプローラーで開く。
    if 開く and os.name == "nt":
        try:
            os.startfile(os.path.abspath(OUT_DIR))
        except Exception:
            pass
