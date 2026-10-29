# Instala lo necesario para desarrollar BandTabs en Windows y arranca la app.
# Uso: doble clic en iniciar.cmd, o: powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Update-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User') + ';' +
              "$env:USERPROFILE\.cargo\bin"
}

function Install-WithWinget($id, $name, $extra = @()) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "No encuentro winget. Instala 'Instalador de aplicación' desde Microsoft Store y vuelve a intentarlo."
  }
  Write-Host "Instalando $name..." -ForegroundColor Cyan
  winget install --id $id -e --silent --accept-source-agreements --accept-package-agreements @extra
  Update-Path
}

function Test-CppTools {
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $vswhere)) { return $false }
  $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  return [bool]$found
}

Update-Path

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Install-WithWinget 'OpenJS.NodeJS.LTS' 'Node.js'
}
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Install-WithWinget 'Rustlang.Rustup' 'Rust'
  rustup default stable
}
if (-not (Test-CppTools)) {
  Install-WithWinget 'Microsoft.VisualStudio.2022.BuildTools' 'herramientas de C++ de Microsoft (tarda unos minutos)' @(
    '--override', '--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  )
}

if (-not (Test-Path node_modules)) {
  Write-Host 'Descargando dependencias del proyecto...' -ForegroundColor Cyan
  npm install
}

Write-Host 'Arrancando BandTabs (la primera vez compila durante unos minutos)...' -ForegroundColor Green
npm run app
