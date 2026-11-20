# Makes this folder a portable Funscript Session: everything in one folder that can be copied to
# another PC or a USB stick without installing anything.
#
#   python\   Python (the official "embeddable" build) + librosa for beat scripts
#   bin\      ffmpeg.exe and ffprobe.exe
#   data\     the cache (thumbnails, remux, voice lines) - moved here from %LOCALAPPDATA%
#
# Your database, sessions\ and "Genererede scripts\" are already in this folder and stay as they are.
#
# Usage (PowerShell in this folder):
#   .\make-portable.ps1               python + librosa + ffmpeg, copy the old cache into data\
#   .\make-portable.ps1 -NoLibrosa    without librosa (about 250 MB smaller, no new beat scripts)
#   .\make-portable.ps1 -Zip          also make dist\FunscriptSession-portable-<version>.zip
#                                     (the program only - never your database, sessions or scripts)
param([switch]$NoLibrosa, [switch]$Zip)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # makes Invoke-WebRequest much faster in Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = $PSScriptRoot
$PyVersion = '3.12.10'
$PyUrl = "https://www.python.org/ftp/python/$PyVersion/python-$PyVersion-embed-amd64.zip"
$GetPipUrl = 'https://bootstrap.pypa.io/get-pip.py'
$FfmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

$Temp = Join-Path ([IO.Path]::GetTempPath()) ("funscript-portable-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $Temp | Out-Null

function Get-File($Url, $Name) {
    $target = Join-Path $Temp $Name
    Write-Host "  henter $Url"
    Invoke-WebRequest -Uri $Url -OutFile $target -UseBasicParsing
    return $target
}

try {
    # --- Python ---------------------------------------------------------------------------------
    $PyDir = Join-Path $Root 'python'
    $Py = Join-Path $PyDir 'python.exe'
    if (-not (Test-Path $Py)) {
        Write-Host "==> Python $PyVersion (embeddable)"
        $archive = Get-File $PyUrl 'python-embed.zip'
        Expand-Archive -Path $archive -DestinationPath $PyDir -Force
        # The embeddable build ignores site-packages until "import site" is switched on
        $pth = Get-ChildItem $PyDir -Filter 'python*._pth' | Select-Object -First 1
        # ... and it only looks for modules in python\, so add the app folder ("..") for server.py's imports
        $lines = (Get-Content $pth.FullName) -replace '^#\s*import site', 'import site'
        if ($lines -notcontains '..') { $lines = @($lines[0], '.', '..') + ($lines | Select-Object -Skip 2) }
        $lines | Set-Content $pth.FullName -Encoding ascii
        $getpip = Get-File $GetPipUrl 'get-pip.py'
        & $Py $getpip --no-warn-script-location
        if ($LASTEXITCODE -ne 0) { throw 'pip kunne ikke installeres' }
    } else {
        Write-Host "==> Python findes allerede i python\"
    }

    if (-not $NoLibrosa) {
        Write-Host '==> librosa (beat-scripts)'
        # Without this the portable Python also sees packages installed for this PC's own Python 3.12
        # (user site-packages), says "already installed" and nothing lands in python\.
        $env:PYTHONNOUSERSITE = '1'
        & $Py -m pip install --no-warn-script-location --disable-pip-version-check librosa
        if ($LASTEXITCODE -ne 0) { throw 'librosa kunne ikke installeres' }
    }

    # --- ffmpeg ---------------------------------------------------------------------------------
    $BinDir = Join-Path $Root 'bin'
    $local = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $BinDir 'ffmpeg.exe')) {
        Write-Host '==> ffmpeg findes allerede i bin\'
    } elseif ($local) {
        # Already on this PC (e.g. winget): copy it instead of downloading. Links point to the real file.
        $src = Get-Item $local.Source
        if ($src.Target) { $src = Get-Item ($src.Target | Select-Object -First 1) }
        $probe = Join-Path $src.DirectoryName 'ffprobe.exe'
        if (Test-Path $probe) {
            Write-Host "==> ffmpeg kopieres fra $($src.DirectoryName)"
            New-Item -ItemType Directory -Force $BinDir | Out-Null
            Copy-Item $src.FullName (Join-Path $BinDir 'ffmpeg.exe') -Force
            Copy-Item $probe (Join-Path $BinDir 'ffprobe.exe') -Force
        }
    }
    if (-not (Test-Path (Join-Path $BinDir 'ffmpeg.exe'))) {
        Write-Host '==> ffmpeg'
        $archive = Get-File $FfmpegUrl 'ffmpeg.zip'
        $unz = Join-Path $Temp 'ffmpeg'
        Expand-Archive -Path $archive -DestinationPath $unz -Force
        New-Item -ItemType Directory -Force $BinDir | Out-Null
        foreach ($exe in 'ffmpeg.exe', 'ffprobe.exe') {
            $found = Get-ChildItem $unz -Recurse -Filter $exe | Select-Object -First 1
            if (-not $found) { throw "$exe blev ikke fundet i ffmpeg-pakken" }
            Copy-Item $found.FullName (Join-Path $BinDir $exe) -Force
        }
    }

    # --- the cache: from %LOCALAPPDATA% into data\ ---------------------------------------------
    $DataDir = Join-Path $Root 'data'
    $OldCache = Join-Path $env:LOCALAPPDATA 'FunscriptSession'
    New-Item -ItemType Directory -Force $DataDir | Out-Null
    if ((Test-Path $OldCache) -and -not (Get-ChildItem $DataDir -Force | Select-Object -First 1)) {
        Write-Host "==> kopierer cachen fra $OldCache (originalen bliver liggende)"
        foreach ($sub in 'cache', 'thumbs', 'voice') {
            $src = Join-Path $OldCache $sub
            if (Test-Path $src) { Copy-Item $src (Join-Path $DataDir $sub) -Recurse -Force }
        }
    }

    # --- check -----------------------------------------------------------------------------------
    Write-Host '==> tjek'
    $env:PYTHONNOUSERSITE = '1'   # only what is in this folder, like on another PC
    & $Py -c "import funlib, beatgen; print('  portabel:', funlib.PORTABLE); print('  ffmpeg:', funlib._FFMPEG); print('  cache:', funlib.REMUX_DIR); print('  librosa:', beatgen.available())"
    if ($LASTEXITCODE -ne 0) { throw 'tjekket fejlede' }

    # --- zip for sharing (program only, no personal data) ---------------------------------------
    if ($Zip) {
        $version = (& $Py -c "import sys; sys.path.insert(0, r'$Root'); import funlib; print(funlib.VERSION)").Trim()
        $Dist = Join-Path $Root 'dist'
        New-Item -ItemType Directory -Force $Dist | Out-Null
        $Stage = Join-Path $Temp 'FunscriptSession'
        New-Item -ItemType Directory -Force $Stage | Out-Null
        $skip = @('.git', '.github', '.claude', '__pycache__', 'sessions', 'videos', 'data', 'dist', 'Genererede scripts')
        Get-ChildItem $Root -Force | Where-Object {
            $skip -notcontains $_.Name -and $_.Name -notlike 'funscript.db*' -and $_.Name -notlike '*.db-journal'
        } | ForEach-Object { Copy-Item $_.FullName (Join-Path $Stage $_.Name) -Recurse -Force }
        Get-ChildItem $Stage -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
        $out = Join-Path $Dist "FunscriptSession-portable-$version.zip"
        if (Test-Path $out) { Remove-Item $out -Force }
        Write-Host "==> pakker $out"
        Compress-Archive -Path $Stage -DestinationPath $out
    }

    Write-Host ''
    Write-Host 'Faerdig. Start appen med "Start Funscript.bat" - den bruger nu python\ i denne mappe.'
}
finally {
    Remove-Item $Temp -Recurse -Force -ErrorAction SilentlyContinue
}
