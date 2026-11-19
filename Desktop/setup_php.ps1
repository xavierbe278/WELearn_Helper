#requires -Version 5.1
<#
下载 Windows 便携版 PHP 到 Desktop/php。
不修改系统 PATH，不写注册表。
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $root 'php'
$zip = Join-Path $env:TEMP 'wlearn-helper-php.zip'
New-Item -ItemType Directory -Path $dest -Force | Out-Null

$versions = @('8.3.14', '8.3.13', '8.3.12', '8.3.11', '8.2.27', '8.2.26', '8.2.25')
$urls = @()
foreach ($v in $versions) {
    $urls += "https://windows.php.net/downloads/releases/php-$v-Win32-vs16-x64.zip"
    $urls += "https://windows.php.net/downloads/releases/archives/php-$v-Win32-vs16-x64.zip"
}

$downloaded = $false
foreach ($url in $urls) {
    try {
        Write-Host "下载 PHP：$url"
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 120
        $downloaded = $true
        break
    } catch {
        Write-Host "  失败，尝试下一个版本…"
    }
}
if (-not $downloaded) {
    Write-Host "PHP 下载失败。请手动下载 PHP 7.4+ 并解压到：$dest"
    exit 1
}

Write-Host "解压到：$dest"
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip -Force -ErrorAction SilentlyContinue

$ini = Join-Path $dest 'php.ini'
$sample = Join-Path $dest 'php.ini-development'
if (-not (Test-Path $ini) -and (Test-Path $sample)) {
    Copy-Item $sample $ini -Force
    Add-Content -Path $ini -Value @(
        '',
        '[WELearn Helper]',
        'date.timezone = Asia/Shanghai',
        'extension_dir = "ext"',
        'extension=curl',
        'extension=openssl',
        'extension=mbstring',
        'extension=fileinfo'
    )
}

$php = Join-Path $dest 'php.exe'
if (-not (Test-Path $php)) {
    Write-Host "解压后没有找到 php.exe：$php"
    exit 1
}

& $php -v
Write-Host "完成：$php"
