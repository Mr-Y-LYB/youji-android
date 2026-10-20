param([switch]$Offline)

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolchain = Join-Path $projectRoot '.toolchain'
$jdkRoot = Join-Path $toolchain 'jdk'
$sdkRoot = Join-Path $toolchain 'sdk'
$gradleRoot = Join-Path $toolchain 'gradle'

if (Test-Path $jdkRoot) {
    $jdk = Get-ChildItem -LiteralPath $jdkRoot -Directory | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
if (Test-Path $sdkRoot) {
    $env:ANDROID_SDK_ROOT = $sdkRoot
    Set-Content -LiteralPath (Join-Path $projectRoot 'local.properties') -Value ('sdk.dir=' + $sdkRoot.Replace('\','/')) -Encoding ascii
}
if (Test-Path $toolchain) {
    $env:GRADLE_USER_HOME = Join-Path $toolchain 'gradle-home'
}

$gradle = $null
if (Test-Path $gradleRoot) {
    $candidate = Get-ChildItem -LiteralPath $gradleRoot -Filter 'gradle.bat' -Recurse -File | Select-Object -First 1
    if ($candidate) { $gradle = $candidate.FullName }
}
if (-not $gradle) { $gradle = Join-Path $projectRoot 'gradlew.bat' }

$arguments = @('assembleDebug','--no-daemon','--console=plain')
if ($Offline) { $arguments += '--offline' }
Push-Location $projectRoot
try { & $gradle @arguments; if ($LASTEXITCODE -ne 0) { throw 'APK 构建失败' } }
finally { Pop-Location }

$outDir = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$apk = Join-Path $projectRoot 'app/build/outputs/apk/debug/app-debug.apk'
$buildConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'app/build.gradle') -Raw
if ($buildConfig -notmatch "versionName\s+'([^']+)'") { throw '无法读取应用版本号' }
$target = Join-Path $outDir ("游迹-v$($Matches[1]).apk")
Copy-Item -LiteralPath $apk -Destination $target -Force
Write-Output "APK: $target"
