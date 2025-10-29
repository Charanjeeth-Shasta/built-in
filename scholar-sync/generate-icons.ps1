$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path 'extension/icons' | Out-Null
Add-Type -AssemblyName System.Drawing
function New-SSIcon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $bg = [System.Drawing.Color]::FromArgb(40, 40, 48)
  $g.Clear($bg)
  $brush = [System.Drawing.Brushes]::White
  $fontSize = [Math]::Max([int]($size * 0.5), 8)
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $rect = New-Object System.Drawing.RectangleF(0,0,$size,$size)
  $g.DrawString('SS', $font, $brush, $rect, $format)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $font.Dispose()
}
New-SSIcon 16  'extension/icons/icon16.png'
New-SSIcon 48  'extension/icons/icon48.png'
New-SSIcon 128 'extension/icons/icon128.png'
Write-Host 'Icons generated in extension/icons.'


