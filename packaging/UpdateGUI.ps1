# ============================================================
# AI Pharmacy OS — Apple-Design Native WPF Update Installer
# Replaces raw cmd.exe console with a frameless macOS-styled UI.
# ============================================================

param(
    [string]$ZipPath,
    [string]$InstallDir,
    [string]$TargetVersion = "Latest",
    [string]$ExpectedSha256 = "",
    [string]$LogPath = ""
)

if (-not $ZipPath -or -not $InstallDir) {
    Write-Error "Usage: UpdateGUI.ps1 -ZipPath <path> -InstallDir <dir> [-TargetVersion <ver>] [-ExpectedSha256 <hash>] [-LogPath <path>]"
    exit 1
}

if (-not $LogPath) {
    $LogPath = Join-Path $InstallDir "logs\updater.log"
}

$logDir = [System.IO.Path]::GetDirectoryName($LogPath)
if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $ts = Get-Date -Format "dd-MM-yyyy HH:mm:ss.ff"
    $line = "[$ts] $Message"
    try {
        Add-Content -Path $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch {}
}

Write-Log "=============================="
Write-Log "AI Pharmacy OS Native GUI Updater Started"
Write-Log "Target version : $TargetVersion"
Write-Log "ZIP path       : $ZipPath"
Write-Log "Install dir    : $InstallDir"
Write-Log "=============================="

# Load WPF Assemblies
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Drawing, System.IO.Compression.FileSystem

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="AI Pharmacy OS Update"
        Width="520" Height="330"
        WindowStartupLocation="CenterScreen"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        ResizeMode="NoResize"
        ShowInTaskbar="True"
        Topmost="True">
    <Window.Resources>
        <Style x:Key="ProgressBarStyle" TargetType="ProgressBar">
            <Setter Property="Template">
                <Setter.Value>
                    <ControlTemplate TargetType="ProgressBar">
                        <Grid>
                            <Border Name="Track" CornerRadius="6" Background="#141E33" BorderBrush="#1E293B" BorderThickness="1"/>
                            <Border Name="Indicator" CornerRadius="6" HorizontalAlignment="Left">
                                <Border.Background>
                                    <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                                        <GradientStop Color="#06B6D4" Offset="0.0"/>
                                        <GradientStop Color="#10B981" Offset="1.0"/>
                                    </LinearGradientBrush>
                                </Border.Background>
                            </Border>
                        </Grid>
                        <ControlTemplate.Triggers>
                            <Trigger Property="IsIndeterminate" Value="False">
                                <Setter TargetName="Indicator" Property="Width"
                                        Value="{Binding RelativeSource={RelativeSource TemplatedParent}, Path=Value, Converter={x:Null}}"/>
                            </Trigger>
                        </ControlTemplate.Triggers>
                    </ControlTemplate>
                </Setter.Value>
            </Setter>
        </Style>
    </Window.Resources>

    <Border CornerRadius="16" Background="#0A0F1D" BorderBrush="#1E293B" BorderThickness="1.5" Margin="10">
        <Border.Effect>
            <DropShadowEffect BlurRadius="28" ShadowDepth="4" Direction="270" Opacity="0.55" Color="#000000"/>
        </Border.Effect>
        <Grid>
            <Grid.RowDefinitions>
                <RowDefinition Height="36"/>
                <RowDefinition Height="*"/>
                <RowDefinition Height="40"/>
            </Grid.RowDefinitions>

            <!-- Header: macOS Traffic Light Dots -->
            <Grid Grid.Row="0" Margin="14,10,14,0">
                <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                    <Ellipse Width="12" Height="12" Fill="#EF4444" Margin="0,0,8,0"/>
                    <Ellipse Width="12" Height="12" Fill="#F59E0B" Margin="0,0,8,0"/>
                    <Ellipse Width="12" Height="12" Fill="#10B981" Margin="0,0,12,0"/>
                    <TextBlock Text="AI Pharmacy OS" Foreground="#64748B" FontSize="11" FontWeight="SemiBold" VerticalAlignment="Center"/>
                </StackPanel>
                <Border HorizontalAlignment="Right" Background="#0E2F38" BorderBrush="#0891B2" BorderThickness="1" CornerRadius="10" Padding="8,2">
                    <TextBlock Name="VersionText" Text="v0.0.0" Foreground="#38BDF8" FontSize="11" FontWeight="SemiBold"/>
                </Border>
            </Grid>

            <!-- Center Content -->
            <StackPanel Grid.Row="1" VerticalAlignment="Center" Margin="28,4,28,0">
                <!-- App Title -->
                <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,0,0,6">
                    <TextBlock Text="💊" FontSize="20" VerticalAlignment="Center" Margin="0,0,8,0"/>
                    <TextBlock Text="AI Pharmacy OS" Foreground="#F8FAFC" FontSize="20" FontWeight="Bold" VerticalAlignment="Center"/>
                </StackPanel>

                <!-- Current Step Header -->
                <TextBlock Name="StepHeader" Text="Preparing update..." Foreground="#E2E8F0" FontSize="14" FontWeight="SemiBold"
                           HorizontalAlignment="Center" Margin="0,4,0,12"/>

                <!-- Apple Liquid Progress Bar -->
                <Grid Height="12" Margin="0,0,0,8">
                    <Border CornerRadius="6" Background="#141E33" BorderBrush="#1E293B" BorderThickness="1"/>
                    <Border Name="ProgressFill" CornerRadius="6" HorizontalAlignment="Left" Width="0">
                        <Border.Background>
                            <LinearGradientBrush StartPoint="0,0" EndPoint="1,0">
                                <GradientStop Color="#06B6D4" Offset="0.0"/>
                                <GradientStop Color="#10B981" Offset="1.0"/>
                            </LinearGradientBrush>
                        </Border.Background>
                    </Border>
                </Grid>

                <!-- Progress Details & Percentage -->
                <Grid Margin="2,0,2,0">
                    <TextBlock Name="DetailText" Text="Validating installation packages..." Foreground="#94A3B8" FontSize="12" HorizontalAlignment="Left"/>
                    <TextBlock Name="PercentText" Text="0%" Foreground="#38BDF8" FontSize="12" FontWeight="SemiBold" HorizontalAlignment="Right"/>
                </Grid>
            </StackPanel>

            <!-- Footer: Security & Safety Guarantee -->
            <Border Grid.Row="2" BorderBrush="#141E33" BorderThickness="0,1,0,0" Padding="16,0" Background="#070B16" CornerRadius="0,0,14,14">
                <Grid VerticalAlignment="Center">
                    <StackPanel Orientation="Horizontal" HorizontalAlignment="Left">
                        <TextBlock Text="🔒" FontSize="11" Margin="0,0,6,0" VerticalAlignment="Center"/>
                        <TextBlock Name="FooterText" Text="Automated safety backup active • Keep your PC on"
                                   Foreground="#475569" FontSize="11" VerticalAlignment="Center"/>
                    </StackPanel>
                    <TextBlock Text="Seamless Rollback Protection" Foreground="#334155" FontSize="10" HorizontalAlignment="Right" VerticalAlignment="Center"/>
                </Grid>
            </Border>
        </Grid>
    </Border>
</Window>
"@

$reader = [System.Xml.XmlNodeReader]::new($xaml)
$window = [System.Windows.Markup.XamlReader]::Load($reader)

# Retrieve Elements
$versionText  = $window.FindName("VersionText")
$stepHeader   = $window.FindName("StepHeader")
$progressFill = $window.FindName("ProgressFill")
$detailText   = $window.FindName("DetailText")
$percentText  = $window.FindName("PercentText")
$footerText   = $window.FindName("FooterText")

$versionText.Text = "v$TargetVersion"

function Update-UI {
    param(
        [string]$Step,
        [string]$Detail,
        [double]$Percent
    )
    if ($Step) { $stepHeader.Text = $Step }
    if ($Detail) { $detailText.Text = $Detail }
    if ($Percent -ge 0) {
        $pct = [Math]::Min(100, [Math]::Max(0, [Math]::Round($Percent)))
        $percentText.Text = "$pct%"
        # Total progress track width is approx 444px (520 - 20 margin - 56 stackpanel padding)
        $progressFill.Width = [Math]::Max(0, ($pct / 100.0) * 444.0)
    }
    # Pump WPF Dispatcher to paint immediately
    [System.Windows.Threading.Dispatcher]::CurrentDispatcher.Invoke(
        [System.Windows.Threading.DispatcherPriority]::Render,
        [Action]{}
    )
}

function Rollback-Update {
    param([string]$BackupDir, [string]$Reason)
    Write-Log "Rolling back to previous version from: $BackupDir (reason: $Reason)"
    Update-UI -Step "Rolling back update..." -Detail "Restoring previous files safely..." -Percent 100

    if (Test-Path (Join-Path $BackupDir "PharmacyOS.exe")) {
        Copy-Item (Join-Path $BackupDir "PharmacyOS.exe") (Join-Path $InstallDir "PharmacyOS.exe") -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $BackupDir "PharmacyBackend.exe")) {
        Copy-Item (Join-Path $BackupDir "PharmacyBackend.exe") (Join-Path $InstallDir "PharmacyBackend.exe") -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $BackupDir "dist-pkg")) {
        Copy-Item (Join-Path $BackupDir "dist-pkg") (Join-Path $InstallDir "dist-pkg") -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $BackupDir "resources\app")) {
        Copy-Item (Join-Path $BackupDir "resources\app") (Join-Path $InstallDir "resources\app") -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $BackupDir "sea-entry.cjs")) {
        Copy-Item (Join-Path $BackupDir "sea-entry.cjs") (Join-Path $InstallDir "sea-entry.cjs") -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $BackupDir "Updater.bat")) {
        Copy-Item (Join-Path $BackupDir "Updater.bat") (Join-Path $InstallDir "Updater.bat") -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path (Join-Path $BackupDir "UpdateGUI.ps1")) {
        Copy-Item (Join-Path $BackupDir "UpdateGUI.ps1") (Join-Path $InstallDir "UpdateGUI.ps1") -Force -ErrorAction SilentlyContinue
    }

    $stagingDir = Join-Path $InstallDir "updates\staging"
    if (-not (Test-Path $stagingDir)) { New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null }
    $failJson = @{ version = $TargetVersion; error = $Reason; ts = (Get-Date).ToString("dd-MM-yyyy HH:mm:ss") } | ConvertTo-Json
    Set-Content (Join-Path $stagingDir "failure.json") $failJson -Encoding UTF8

    $lockPath = Join-Path $InstallDir "updates\update.lock"
    if (Test-Path $lockPath) { Remove-Item $lockPath -Force -ErrorAction SilentlyContinue }

    Start-Sleep -Seconds 1
    $silentVbs = Join-Path $InstallDir "RUN-PharmacyOS-Silent.vbs"
    $appExe = Join-Path $InstallDir "PharmacyOS.exe"
    if (Test-Path $silentVbs) {
        Start-Process "wscript.exe" -ArgumentList "`"$silentVbs`""
    } elseif (Test-Path $appExe) {
        Start-Process $appExe
    }
    Start-Sleep -Seconds 2
    $window.Close()
}

$window.Add_ContentRendered({
    try {
        # 1. Update Lock
        Update-UI -Step "Preparing installation..." -Detail "Securing update lock..." -Percent 5
        $updatesDir = Join-Path $InstallDir "updates"
        $stagingDir = Join-Path $updatesDir "staging"
        if (-not (Test-Path $updatesDir)) { New-Item -ItemType Directory -Path $updatesDir -Force | Out-Null }
        if (-not (Test-Path $stagingDir)) { New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null }

        $lockPath = Join-Path $updatesDir "update.lock"
        if (Test-Path $lockPath) {
            $lockAge = (Get-Date) - (Get-Item $lockPath).LastWriteTime
            if ($lockAge.TotalMinutes -lt 30) {
                Write-Log "Active update.lock found (< 30 min old). Aborting."
                Update-UI -Step "Update already in progress" -Detail "Another updater instance is running." -Percent 100
                Start-Sleep -Seconds 3
                $window.Close()
                return
            } else {
                Write-Log "Stale lock detected (> 30 min). Removing and continuing."
                Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
            }
        }
        $lockPayload = @{ ts = (Get-Date).ToString("dd-MM-yyyy HH:mm:ss"); targetVersion = $TargetVersion; operation = "update" } | ConvertTo-Json
        Set-Content -Path $lockPath -Value $lockPayload -Encoding UTF8
        Write-Log "update.lock written."

        # 2. Terminate Running Processes & Verify File Handles
        Update-UI -Step "Closing application..." -Detail "Terminating running background services..." -Percent 12
        Write-Log "Terminating PharmacyOS.exe and PharmacyBackend.exe..."
        Stop-Process -Name "PharmacyOS" -Force -ErrorAction SilentlyContinue
        Stop-Process -Name "PharmacyBackend" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600

        # Probe file handles for up to 10 seconds to ensure kernel release
        Update-UI -Step "Closing application..." -Detail "Waiting for file handles to release..." -Percent 18
        Write-Log "Waiting for executable file handles to release..."
        $handlesFree = $false
        $targetExes = @(Join-Path $InstallDir "PharmacyOS.exe", Join-Path $InstallDir "PharmacyBackend.exe")
        for ($i = 0; $i -lt 10; $i++) {
            $busy = $false
            foreach ($f in $targetExes) {
                if (Test-Path -LiteralPath $f) {
                    try {
                        $stream = [System.IO.File]::Open($f, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
                        $stream.Close()
                    } catch {
                        $busy = $true
                        break
                    }
                }
            }
            if (-not $busy) {
                $handlesFree = $true
                break
            }
            # Fallback: repeat taskkill if still locked
            Stop-Process -Name "PharmacyBackend" -Force -ErrorAction SilentlyContinue
            Stop-Process -Name "PharmacyOS" -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 800
        }
        Write-Log "Executable file handles free status: $handlesFree"

        # 3. Integrity Verification
        Update-UI -Step "Verifying package..." -Detail "Checking SHA-256 package signature..." -Percent 25
        if (-not (Test-Path -LiteralPath $ZipPath)) {
            Write-Log "ERROR: ZIP package not found at: $ZipPath"
            Rollback-Update -BackupDir "" -Reason "ZIP_PACKAGE_MISSING"
            return
        }

        if ($ExpectedSha256) {
            $computedHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
            if ($computedHash -ne $ExpectedSha256.ToLower()) {
                Write-Log "ERROR: SHA-256 mismatch! Expected: $ExpectedSha256, Actual: $computedHash"
                Rollback-Update -BackupDir "" -Reason "CHECKSUM_MISMATCH"
                return
            }
            Write-Log "SHA-256 integrity verified successfully."
        }

        # 4. Safety Backup
        $ts = Get-Date -Format "yyyyMMddHHmmss"
        $backupDir = Join-Path $InstallDir "backup\preupdate-$ts"
        Update-UI -Step "Creating safety backup..." -Detail "Backing up current installation files..." -Percent 32
        Write-Log "Creating pre-update backup at: $backupDir"
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

        $backupFiles = @("PharmacyOS.exe", "PharmacyBackend.exe", "sea-entry.cjs", "Updater.bat", "UpdateGUI.ps1")
        foreach ($f in $backupFiles) {
            $source = Join-Path $InstallDir $f
            if (Test-Path -LiteralPath $source) {
                Copy-Item -LiteralPath $source -Destination (Join-Path $backupDir $f) -Force -ErrorAction SilentlyContinue
            }
        }
        $backupDirs = @("dist-pkg", "resources\app")
        foreach ($d in $backupDirs) {
            $srcDir = Join-Path $InstallDir $d
            if (Test-Path -LiteralPath $srcDir) {
                Copy-Item -LiteralPath $srcDir -Destination (Join-Path $backupDir $d) -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        # Backup database
        $dbPath = Join-Path $InstallDir "data\app.db"
        if (Test-Path -LiteralPath $dbPath) {
            Update-UI -Step "Creating safety backup..." -Detail "Backing up pharmacy database..." -Percent 38
            Copy-Item -LiteralPath $dbPath -Destination (Join-Path $backupDir "app-preupdate-$ts.db") -Force -ErrorAction SilentlyContinue
            Write-Log "data/app.db backup created."
        }
        Write-Log "Safety backup completed successfully."

        # 5. Extract Update ZIP with Live Progress & Retries
        Update-UI -Step "Installing update..." -Detail "Opening package archive..." -Percent 42
        Write-Log "Extracting update package..."
        $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
        $totalEntries = $zip.Entries.Count
        $curr = 0

        foreach ($entry in $zip.Entries) {
            $curr++
            $dest = Join-Path $InstallDir $entry.FullName

            if ($entry.FullName.EndsWith("/") -or $entry.FullName.EndsWith("\")) {
                if (-not (Test-Path -LiteralPath $dest)) {
                    New-Item -ItemType Directory -Path $dest -Force | Out-Null
                }
            } else {
                $parent = [System.IO.Path]::GetDirectoryName($dest)
                if ($parent -and -not (Test-Path -LiteralPath $parent)) {
                    New-Item -ItemType Directory -Path $parent -Force | Out-Null
                }

                $extracted = $false
                for ($attempt = 1; $attempt -le 10; $attempt++) {
                    try {
                        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)
                        $extracted = $true
                        break
                    } catch {
                        Start-Sleep -Milliseconds (200 + ($attempt * 100))
                    }
                }

                if (-not $extracted) {
                    Write-Log "ERROR: Failed to extract $dest after 10 attempts."
                    $zip.Dispose()
                    Rollback-Update -BackupDir $backupDir -Reason "FILE_REPLACEMENT_FAILED"
                    return
                }
            }

            # Update progress bar every 2 files or on finish
            if ($curr % 2 -eq 0 -or $curr -eq $totalEntries) {
                $filePct = 42.0 + (($curr / [double]$totalEntries) * 50.0)
                $fileName = [System.IO.Path]::GetFileName($dest)
                if (-not $fileName) { $fileName = "files" }
                Update-UI -Step "Installing update files..." -Detail "Extracting $fileName ($curr/$totalEntries)" -Percent $filePct
            }
        }
        $zip.Dispose()
        Write-Log "Extraction of $totalEntries files completed cleanly."

        # 6. Verify PharmacyOS.exe Exists
        $installedApp = Join-Path $InstallDir "PharmacyOS.exe"
        if (-not (Test-Path -LiteralPath $installedApp)) {
            $bkpApp = Join-Path $backupDir "PharmacyOS.exe"
            if (Test-Path -LiteralPath $bkpApp) {
                Copy-Item -LiteralPath $bkpApp -Destination $installedApp -Force -ErrorAction SilentlyContinue
            }
        }
        if (-not (Test-Path -LiteralPath $installedApp)) {
            Write-Log "ERROR: PharmacyOS.exe missing after extraction!"
            Rollback-Update -BackupDir $backupDir -Reason "EXECUTABLE_MISSING_AFTER_EXTRACT"
            return
        }

        # 7. Write Success Record
        $successJson = @{
            version = $TargetVersion
            ts = (Get-Date).ToString("dd-MM-yyyy HH:mm:ss")
            result = "success"
        } | ConvertTo-Json
        Set-Content -Path (Join-Path $stagingDir "success.json") -Value $successJson -Encoding UTF8
        Write-Log "Update v$TargetVersion applied successfully."

        # 8. Clean Staging ZIP & Lock
        Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $lockPath) {
            Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
        }

        # 9. Prune Old Backups (keep latest 2)
        $backupRoot = Join-Path $InstallDir "backup"
        if (Test-Path -LiteralPath $backupRoot) {
            Get-ChildItem -Path $backupRoot -Directory -Filter "preupdate-*" |
                Sort-Object CreationTime -Descending |
                Select-Object -Skip 2 |
                ForEach-Object {
                    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
                    Write-Log "Pruned old rollback backup: $($_.Name)"
                }
        }

        # 10. Smooth Launch
        Update-UI -Step "Update Complete!" -Detail "Restarting AI Pharmacy OS v$TargetVersion..." -Percent 100
        $footerText.Text = "Update successfully installed • Starting now"
        Start-Sleep -Milliseconds 1200

        $silentVbs = Join-Path $InstallDir "RUN-PharmacyOS-Silent.vbs"
        if (Test-Path -LiteralPath $silentVbs) {
            Start-Process "wscript.exe" -ArgumentList "`"$silentVbs`""
        } else {
            Start-Process $installedApp
        }
        Write-Log "Application launched. Closing updater GUI."
        Start-Sleep -Milliseconds 800
        $window.Close()

    } catch {
        Write-Log "EXCEPTION in UpdateGUI: $_"
        Rollback-Update -BackupDir $backupDir -Reason "UNEXPECTED_ERROR: $_"
    }
})

# Show the WPF Window (blocking on single STA thread)
$window.ShowDialog() | Out-Null
exit 0

