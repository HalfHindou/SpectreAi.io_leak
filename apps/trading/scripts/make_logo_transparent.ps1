$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$inPath = Join-Path $PSScriptRoot '..\public\spectre-logo.png'
$outPath = Join-Path $PSScriptRoot '..\public\spectre-logo-transparent.png'

$src = [System.Drawing.Image]::FromFile($inPath)

try {
  $bmpNew = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmpNew)
  try {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $ia = New-Object System.Drawing.Imaging.ImageAttributes
    # Key out near-white background while keeping the light-gray wordmark.
    $min = [System.Drawing.Color]::FromArgb(255, 240, 240, 240)
    $max = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)
    $ia.SetColorKey($min, $max, [System.Drawing.Imaging.ColorAdjustType]::Default)

    $rect = New-Object System.Drawing.Rectangle(0, 0, $src.Width, $src.Height)
    $g.DrawImage($src, $rect, 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
  } finally {
    $g.Dispose()
  }

  if (Test-Path $outPath) { Remove-Item -Force $outPath }
  $bmpNew.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $bmpNew.Dispose()
  $src.Dispose()
}

Write-Host "Wrote: $outPath"
