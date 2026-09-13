# =====================================================================
# AI PHARMACY: 24/7 UNSTOPPABLE MASTER IMAGE HARVESTER DAEMON
# Runs continuously for days/weeks, auto-resumes on interruption,
# fast-skips completed items, and auto-commits milestones to Git.
# =====================================================================

$host.UI.RawUI.WindowTitle = "AI Pharmacy — 24/7 Master Harvester Daemon"
$ErrorActionPreference = "Continue"

Write-Host "`n===============================================================" -ForegroundColor Cyan
Write-Host " 🚀 AI PHARMACY: 24/7 MASTER IMAGE HARVESTER DAEMON" -ForegroundColor Green
Write-Host " Target Scope  : Top 500 Pharmaceutical Manufacturers" -ForegroundColor White
Write-Host " Auto-Resume   : Instant Fast-Skip of Completed Items" -ForegroundColor White
Write-Host " Git Auto-Save : Commits every 1,000 images automatically" -ForegroundColor White
Write-Host " Multi-Angle   : Captures Front, Back, Box, Combo & Side" -ForegroundColor White
Write-Host " AI Vision     : Gemini 3.6 Flash + Local AI OCR Verification" -ForegroundColor White
Write-Host "===============================================================`n" -ForegroundColor Cyan

$runCount = 1

while ($true) {
    $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$now] Starting Harvester Execution Cycle #$runCount..." -ForegroundColor Yellow

    try {
        # Runs the master harvester across Top 500 Pharma companies
        npx tsx scripts/harvest_top100_company_images.ts --top=500 --gemini --pool=1 --commit-every=1000
    }
    catch {
        Write-Host "⚠️ Execution encountered an exception: $_" -ForegroundColor Red
    }

    $runCount++
    $resumeTime = Get-Date -Format "HH:mm:ss"
    Write-Host "`n⏳ Cycle finished or network blip caught at $resumeTime." -ForegroundColor DarkYellow
    Write-Host "🔄 Auto-resuming in 15 seconds (Press Ctrl+C to stop daemon)...`n" -ForegroundColor Gray
    Start-Sleep -Seconds 15
}
