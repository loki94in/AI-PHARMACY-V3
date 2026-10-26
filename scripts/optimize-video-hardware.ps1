# Video Hardware Optimization Script for NVIDIA GeForce GT 730 (Fermi) & i7-4770TE
# Applies DXVA2 Hardware Acceleration, Direct3D9 rendering, and LAV Filter optimizations.

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Video Playback & Hardware Acceleration Optimizer" -ForegroundColor Cyan
Write-Host "  Target Hardware: NVIDIA GeForce GT 730 (Fermi) + i7-4770TE" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 1. VLC Media Player Configuration (%APPDATA%\vlc\vlcrc)
# -----------------------------------------------------------------------------
$vlcDir = "$env:APPDATA\vlc"
$vlcConfig = "$vlcDir\vlcrc"

Write-Host "`n[1/3] Configuring VLC Media Player for GT 730 DXVA2 + D3D9..." -ForegroundColor Yellow

if (-not (Test-Path $vlcDir)) {
    New-Item -ItemType Directory -Path $vlcDir -Force | Out-Null
}

$vlcSettingsToAdd = @(
    "avcodec-hw=dxva2",
    "vout=direct3d9",
    "ffmpeg-threads=4",
    "deinterlace=-1"
)

if (Test-Path $vlcConfig) {
    $content = Get-Content $vlcConfig -Raw
    foreach ($setting in $vlcSettingsToAdd) {
        $key = $setting.Split('=')[0]
        if ($content -match "(?m)^#?\s*$key=.*$") {
            $content = $content -replace "(?m)^#?\s*$key=.*$", $setting
        } else {
            $content += "`r`n$setting"
        }
    }
    Set-Content -Path $vlcConfig -Value $content -Encoding UTF8
    Write-Host "  -> Updated existing VLC config at: $vlcConfig" -ForegroundColor Green
} else {
    $header = "# VLC media player configuration for NVIDIA GT 730 DXVA2`r`n[main]`r`n"
    $fullContent = $header + ($vlcSettingsToAdd -join "`r`n") + "`r`n"
    Set-Content -Path $vlcConfig -Value $fullContent -Encoding UTF8
    Write-Host "  -> Created new VLC configuration at: $vlcConfig" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 2. LAV Filters Video Decoder Configuration (Registry: HKCU\Software\LAV\Video)
# -----------------------------------------------------------------------------
Write-Host "`n[2/3] Configuring LAV Video Filters (DXVA2 Native)..." -ForegroundColor Yellow
$lavRegPath = "HKCU:\Software\LAV\Video"

if (-not (Test-Path $lavRegPath)) {
    New-Item -Path $lavRegPath -Force | Out-Null
}

# HWAccel = 4 is DXVA2 (native) - fastest hardware decode on Fermi GT 730
Set-ItemProperty -Path $lavRegPath -Name "HWAccel" -Value 4 -Type DWord
Set-ItemProperty -Path $lavRegPath -Name "HWFormats" -Value 1 -Type DWord
Write-Host "  -> LAV Video Decoder configured to DXVA2 Native (HWAccel=4)" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 3. Summary & Chrome Recommendation
# -----------------------------------------------------------------------------
Write-Host "`n[3/3] Video Optimizations Successfully Applied!" -ForegroundColor Green
Write-Host "----------------------------------------------------------"
Write-Host "Summary of Changes:"
Write-Host "  * VLC: Hardware Acceleration set to DXVA2.0 (GT 730 GPU decode)"
Write-Host "  * VLC: Video Output module set to Direct3D9 (avoids 391.35 driver stalls)"
Write-Host "  * LAV Video Decoder: Hardware Acceleration set to DXVA2 Native"
Write-Host "----------------------------------------------------------"
Write-Host "To fix YouTube in Chrome/Edge, install the 'enhanced-h264ify' extension:"
Write-Host "URL: https://chromewebstore.google.com/detail/enhanced-h264ify/omkfmpbbdfncffbeibaigohnkpeglolj"
Write-Host "Check: [X] Block VP8  [X] Block VP9  [X] Block AV1"
Write-Host "==========================================================" -ForegroundColor Cyan
