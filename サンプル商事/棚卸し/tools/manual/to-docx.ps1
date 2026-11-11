# Convert a composed manual HTML into a real .docx using the installed Microsoft Word.
# Called by build-docx.mjs. Kept ASCII-only so Windows PowerShell reads it correctly
# regardless of the file's encoding.
param(
  [Parameter(Mandatory = $true)][string]$Html,
  [Parameter(Mandatory = $true)][string]$Docx
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Html)) { throw "source HTML not found: $Html" }
$Html = (Resolve-Path $Html).Path
$outDir = Split-Path $Docx -Parent
if ($outDir -and -not (Test-Path $outDir)) { New-Item -ItemType Directory -Force $outDir | Out-Null }
if (Test-Path $Docx) { Remove-Item $Docx -Force }

$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0

  # ConfirmConversions=false so Word imports the HTML without prompting.
  $doc = $word.Documents.Open($Html, $false, $false)

  # The screenshots are 2560px wide (captured at 2x for print), and Word sizes pictures
  # from their pixel size instead of honouring the stylesheet's max-width. Left alone,
  # every screenshot lands several pages wide. Scale each one to the text column here.
  $ps = $doc.PageSetup
  $maxW = $ps.PageWidth - $ps.LeftMargin - $ps.RightMargin
  # Keep a screenshot inside one page so text and picture stay together.
  $maxH = ($ps.PageHeight - $ps.TopMargin - $ps.BottomMargin) * 0.78

  # Word imports <img> as *linked* pictures, so the .docx would only reference the
  # PNGs on this machine and show empty frames anywhere else. Break every link so the
  # pictures are stored inside the file.
  # Match on "has a link source" rather than on a shape Type number: an imported
  # picture is wdInlineShapeLinkedPicture (4), not 3, and <hr> comes in as type 6.
  # Walk backwards because BreakLink renumbers the collection as it goes.
  $embedded = 0
  for ($i = $doc.InlineShapes.Count; $i -ge 1; $i--) {
    $shape = $doc.InlineShapes.Item($i)
    $src = ''
    try { $src = $shape.LinkFormat.SourceFullName } catch { continue }
    if ([string]::IsNullOrEmpty($src)) { continue }
    $shape.LinkFormat.SavePictureWithDocument = $true
    $shape.LinkFormat.BreakLink()

    # Resize after breaking the link, so the size is stored with the embedded picture.
    # Width/Height are Single in the Word object model; assigning a Double throws
    # "Specified cast is not valid", so cast explicitly. Both are set by hand rather
    # than relying on LockAspectRatio, which does not accept a plain int here.
    if ($shape.Width -gt 0) {
      $ratio = $shape.Height / $shape.Width
      $w = [Math]::Min([double]$shape.Width, [double]$maxW)
      $h = $w * $ratio
      if ($h -gt $maxH) { $h = $maxH; $w = $h / $ratio }
      $shape.Width = [single]$w
      $shape.Height = [single]$h
    }
    $embedded++
  }

  # 16 = wdFormatDocumentDefault (.docx)
  $doc.SaveAs2($Docx, 16)
  $doc.Close(0)
  $doc = $null
}
finally {
  if ($doc) { try { $doc.Close(0) } catch {} }
  if ($word) {
    try { $word.Quit() } catch {}
    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  }
}

if (-not (Test-Path $Docx)) { throw "Word did not produce: $Docx" }
Write-Output ("OK embedded=" + $embedded + " bytes=" + (Get-Item $Docx).Length)
