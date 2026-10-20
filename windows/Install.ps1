$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'YouJi.exe'
if (-not (Test-Path -LiteralPath $source)) { throw '安装包内缺少 YouJi.exe' }
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\YouJi'
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$target = Join-Path $installDir 'YouJi-v1.3.3.exe'
Copy-Item -LiteralPath $source -Destination $target -Force
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
$shortcutPath = Join-Path $startMenu '游迹.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = '游迹 · 本地游戏档案'
$shortcut.Save()
Write-Host '游迹已安装。可从开始菜单打开。'
