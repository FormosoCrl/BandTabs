# Instala el motor de transcripción de BandTabs en la carpeta indicada. Lo lanza la app la primera
# vez que alguien usa "Desde enlace"; no hace falta ejecutarlo a mano.
#
# Escribe una línea JSON por paso para que la app muestre el progreso.
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$EngineSource
)

$ErrorActionPreference = 'Stop'
# Las rutas largas de Windows (\\?\C:\...) rompen Join-Path en Windows PowerShell.
$Dir = $Dir -replace '^\\\\\?\\', ''
$EngineSource = $EngineSource -replace '^\\\\\?\\', ''
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$PythonVersion = '3.12.10'
$PythonZip = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$GetPip = 'https://bootstrap.pypa.io/get-pip.py'

function Send-Progress([double]$Value, [string]$Message) {
  $json = @{ type = 'progress'; step = 'install'; progress = $Value; message = $Message } | ConvertTo-Json -Compress
  Write-Output $json
}

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments 2>&1 | ForEach-Object { [Console]::Error.WriteLine($_) }
  if ($LASTEXITCODE -ne 0) { throw "Falló: $Exe $($Arguments -join ' ')" }
}

try {
  $python = Join-Path $Dir 'python\python.exe'
  New-Item -ItemType Directory -Force -Path $Dir | Out-Null

  if (-not (Test-Path $python)) {
    Send-Progress 0.02 'Descargando Python…'
    $zip = Join-Path $Dir 'python.zip'
    Invoke-WebRequest -Uri $PythonZip -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath (Join-Path $Dir 'python') -Force
    Remove-Item $zip
    # El Python "embeddable" no carga site-packages hasta activar "import site".
    $pth = Get-ChildItem (Join-Path $Dir 'python') -Filter 'python*._pth' | Select-Object -First 1
    (Get-Content $pth.FullName) -replace '^#\s*import site', 'import site' | Set-Content $pth.FullName -Encoding ASCII
  }

  if (-not (Test-Path (Join-Path $Dir 'python\Scripts\pip.exe'))) {
    Send-Progress 0.06 'Instalando pip…'
    $getPipPath = Join-Path $Dir 'get-pip.py'
    Invoke-WebRequest -Uri $GetPip -OutFile $getPipPath -UseBasicParsing
    Invoke-Checked $python @($getPipPath, '--no-warn-script-location', '--disable-pip-version-check')
    Remove-Item $getPipPath
  }

  Send-Progress 0.10 'Descargando los componentes de análisis (unos 700 MB, solo la primera vez)…'
  $pipArgs = @('-m', 'pip', 'install', '--no-warn-script-location', '--disable-pip-version-check',
    '--progress-bar', 'off', '--only-binary', ':all:')
  Invoke-Checked $python ($pipArgs + @('--no-deps', '-r', (Join-Path $EngineSource 'requirements.lock')))
  Send-Progress 0.90 'Instalando el transcriptor de notas…'
  # basic-pitch pide TensorFlow en Python 3.12; usamos su modelo ONNX, así que basta sin dependencias.
  Invoke-Checked $python ($pipArgs + @('--no-deps', 'basic-pitch==0.4.0'))

  Send-Progress 0.97 'Comprobando la instalación…'
  Copy-Item (Join-Path $EngineSource 'bandtabs_engine.py') (Join-Path $Dir 'bandtabs_engine.py') -Force
  $check = & $python (Join-Path $Dir 'bandtabs_engine.py') 'check' 2>$null | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0) { throw 'El motor no arranca después de instalarlo.' }

  Copy-Item (Join-Path $EngineSource 'requirements.lock') (Join-Path $Dir 'installed.lock') -Force
  Write-Output (@{ type = 'done'; check = ($check | ConvertFrom-Json) } | ConvertTo-Json -Compress -Depth 4)
} catch {
  Write-Output (@{ type = 'error'; message = $_.Exception.Message } | ConvertTo-Json -Compress)
  exit 1
}
