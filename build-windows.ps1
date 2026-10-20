$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
    python -c 'import importlib.util,sys; sys.exit(0 if importlib.util.find_spec("PyInstaller") and importlib.util.find_spec("PIL") else 1)'
    if ($LASTEXITCODE -ne 0) { throw '请先安装构建依赖：python -m pip install pyinstaller pillow' }
    $assets = Join-Path $root 'app\src\main\assets'
    $output = Join-Path $root 'dist\windows-build'
    python -m PyInstaller --noconfirm --onefile --windowed --name YouJi `
        --add-data ($assets + ':assets') --distpath $output `
        --workpath (Join-Path $root 'build\pyinstaller') `
        --specpath (Join-Path $root 'windows') `
        (Join-Path $root 'windows\youji_windows.py')
    if ($LASTEXITCODE -ne 0) { throw 'Windows 程序构建失败' }
    Copy-Item -LiteralPath (Join-Path $output 'YouJi.exe') `
        -Destination (Join-Path $root 'dist\YouJi-Windows-v1.3.3.exe') -Force
    $stage = Join-Path $root 'dist\windows-package-v1.3.3'
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    Copy-Item -LiteralPath (Join-Path $output 'YouJi.exe') -Destination $stage -Force
    foreach ($name in @('Install.cmd','Install.ps1','README-Windows.txt')) {
        Copy-Item -LiteralPath (Join-Path $root ('windows\' + $name)) -Destination $stage -Force
    }
    Compress-Archive -Path (Join-Path $stage '*') `
        -DestinationPath (Join-Path $root 'dist\YouJi-Windows-v1.3.3.zip') -Force
    Write-Host 'Windows 安装包：dist\YouJi-Windows-v1.3.3.zip'
    Write-Host 'Windows 便携版：dist\YouJi-Windows-v1.3.3.exe'
} finally {
    Pop-Location
}
