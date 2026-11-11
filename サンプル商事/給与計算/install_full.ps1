param([string]$Target = "", [switch]$SkipShortcuts)
$ErrorActionPreference = "Stop"
$source = Join-Path $PSScriptRoot "給与計算"
if (-not (Test-Path -LiteralPath (Join-Path $source "tool\従業員マスタ.csv"))) {
    throw "配布用の給与計算フォルダが見つかりません。ZIPをすべて展開してください。"
}
if (-not $Target) {
    if (Test-Path -LiteralPath "C:\給与計算\tool\従業員マスタ.csv") {
        $Target = "C:\給与計算"
    } else {
        $Target = Join-Path $env:LOCALAPPDATA "給与計算"
    }
}
$master = Join-Path $Target "tool\従業員マスタ.csv"
if (Test-Path -LiteralPath $Target) {
    if (-not (Test-Path -LiteralPath $master)) {
        throw "同名フォルダがありますが、給与計算の名簿がありません。上書きせずに中止します: $Target"
    }
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backup = Join-Path $Target "更新前の控え_$stamp"
    $masterText = [System.IO.File]::ReadAllText($master, [System.Text.Encoding]::UTF8)
    if ($masterText.Contains("中村真一郎")) {
        $savedMaster = Join-Path $backup "tool\従業員マスタ.csv"
        New-Item -ItemType Directory -Force -Path (Split-Path $savedMaster) | Out-Null
        Copy-Item -LiteralPath $master -Destination $savedMaster -Force
        $corrected = $masterText.Replace("中村真一郎", "中村信一郎")
        [System.IO.File]::WriteAllText($master, $corrected, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "従業員名簿の氏名を『中村信一郎』に訂正しました。"
    }
    $files = @("実行.bat", "セットアップ.bat", "環境チェック.bat", "控えを作る.bat",
               "payroll.exe", "check_env.exe", "backup.exe",
               "操作マニュアル.html", "tool\payroll.py", "tool\backup.py", "tool\check_env.py")
    foreach ($relative in $files) {
        $old = Join-Path $Target $relative
        if (Test-Path -LiteralPath $old) {
            $saved = Join-Path $backup $relative
            New-Item -ItemType Directory -Force -Path (Split-Path $saved) | Out-Null
            Copy-Item -LiteralPath $old -Destination $saved -Force
        }
    }
    foreach ($relative in $files) {
        $from = Join-Path $source $relative
        $to = Join-Path $Target $relative
        Copy-Item -LiteralPath $from -Destination $to -Force
    }
    $register = Join-Path $Target "従業員登録.xlsx"
    if (-not (Test-Path -LiteralPath $register)) {
        Copy-Item -LiteralPath (Join-Path $source "従業員登録.xlsx") -Destination $register
    }
    Write-Host "既存の給与計算を更新しました。登録内容・履歴・入力・出力は保持しました。"
} else {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
    Copy-Item -Path (Join-Path $source "*") -Destination $Target -Recurse -Force
    Write-Host "給与計算一式を設置しました: $Target"
}

if (-not $SkipShortcuts) { try {
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("Desktop")
    foreach ($entry in @(@("給与計算_フォルダ.lnk", ""),
                         @("給与計算_使い方.lnk", "操作マニュアル.html"),
                         @("給与計算_実行.lnk", "実行.bat"))) {
        $shortcut = $shell.CreateShortcut((Join-Path $desktop $entry[0]))
        $shortcut.TargetPath = if ($entry[1]) { Join-Path $Target $entry[1] } else { $Target }
        $shortcut.WorkingDirectory = $Target
        $shortcut.Save()
    }
    Write-Host "デスクトップに使い方と実行のショートカットを作りました。"
} catch {
    Write-Host "ショートカットは作れませんでした。設置先フォルダから操作してください。"
} }

Write-Host "Pythonの導入は不要です。『環境チェック.bat』を開いて確認してください。"
