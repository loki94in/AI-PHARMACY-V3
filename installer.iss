; ============================================================
;  AI Pharmacy OS — Portable Inno Setup Installer
;  Compiler: Inno Setup 6.x  (https://jrsoftware.org/isinfo.php)
;
;  VERSION IS INJECTED AUTOMATICALLY — do not hand-edit MyAppVersion here.
;  The build script (scripts/buildSea.cjs) passes:
;    /DMyAppVersion=X.Y.Z
;  which overrides the fallback below. package.json is the single version source.
;
;  Portable install: no admin rights, installs to a writable folder
;  (default %LOCALAPPDATA%\AI Pharmacy OS). Data, uploads, and the
;  database live beside PharmacyOS.exe — not under Program Files.
;
;  BUILD STEPS (run from project root):
;    npm run build:exe
;    (frontend + backend + dist-pkg bundle + dist\PharmacyOS.exe via Node SEA
;     + Inno Setup installer compiled with injected version)
;
;  PharmacyOS.exe is a Node SEA build — it embeds only app code, not
;  node_modules. The full node_modules tree must ship beside the exe.
;  sea-entry.cjs is required for external require() resolution.
;
;  OUTPUT: dist\installer\AI-Pharmacy-OS-Portable-Setup-v{MyAppVersion}.exe
; ============================================================

#define MyAppName      "AI Pharmacy OS"
; MyAppVersion is injected via /DMyAppVersion=X.Y.Z from scripts/buildSea.cjs
; Fallback guard — allows ISCC to be run standalone without crashing.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppPublisher "AI Pharmacy Team"
#define MyAppURL       ""
#define MyAppExeName   "PharmacyOS.exe"
#define MyAppPort      "5175"
#define MyAppIcon      "packaging\app.ico"

[Setup]
AppId={{E3A1F2B4-7C8D-4E5F-9A0B-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion} (Portable)
AppPublisher={#MyAppPublisher}
SetupIconFile={#MyAppIcon}

; Always install to the user's LocalAppData — standardized single location, no drive conflicts
DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
DisableDirPage=no

OutputDir=dist\installer
OutputBaseFilename=AI-Pharmacy-OS-Portable-Setup-v{#MyAppVersion}

Compression=lzma2/max
SolidCompression=yes

WizardStyle=modern
DisableWelcomePage=no
DisableProgramGroupPage=yes

; No admin elevation — portable / per-user install
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UsedUserAreasWarning=no

LicenseFile=license.txt
UninstallDisplayIcon={app}\app.ico
UninstallDisplayName={#MyAppName} (Portable)
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Portable Installer
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon";  Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
; Main executable (Electron native desktop window)
Source: "dist\PharmacyOS.exe"; DestDir: "{app}"; Flags: ignoreversion

; Backend executable (Node SEA background service)
Source: "dist\PharmacyBackend.exe"; DestDir: "{app}"; Flags: ignoreversion nocompression

; Electron runtime files & application resources
Source: "dist\resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\electron\dist\locales\*"; DestDir: "{app}\locales"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "node_modules\electron\dist\*.pak"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\electron\dist\*.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\electron\dist\*.dat"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\electron\dist\*.bin"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\electron\dist\version"; DestDir: "{app}"; Flags: ignoreversion
Source: "node_modules\electron\dist\vk_swiftshader_icd.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; Dist package for backend
Source: "dist-pkg\*"; DestDir: "{app}\dist-pkg"; Flags: ignoreversion recursesubdirs createallsubdirs

; Required anchor for createRequire() beside the exe
Source: "sea-entry.cjs"; DestDir: "{app}"; Flags: ignoreversion

; Built web frontend (local images excluded — images are dynamically fetched online via web)
Source: "frontend\dist\*"; DestDir: "{app}\frontend\dist"; Excludes: "products\*,products"; Flags: ignoreversion recursesubdirs createallsubdirs

; Full node_modules (SEA does not embed third-party packages)
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

; Portable production env (auto-opens browser on first launch)
Source: "packaging\portable.env"; DestDir: "{app}"; DestName: ".env"; Flags: onlyifdoesntexist

; Bundled reference medicine seed JSON
Source: "data\medicine_reference_seed.json"; DestDir: "{app}\data"; Flags: ignoreversion skipifsourcedoesntexist

; Master medicine catalog CSV (packaged into {app}\data\reference_medicines.csv)
Source: "medicines.csv"; DestDir: "{app}\data"; DestName: "reference_medicines.csv"; Flags: ignoreversion nocompression skipifsourcedoesntexist
Source: "data\reference_medicines.csv"; DestDir: "{app}\data"; Flags: ignoreversion nocompression skipifsourcedoesntexist

; Optional Tesseract OCR data
Source: "eng.traineddata"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; Application Blue Cross Icon
Source: "packaging\app.ico"; DestDir: "{app}"; Flags: ignoreversion

; Launcher helper + license
Source: "packaging\RUN-PharmacyOS.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "packaging\RUN-PharmacyOS-Silent.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "packaging\STOP-PharmacyOS.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "packaging\Updater.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "license.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

; Optional VC++ redistributable (native addons: better-sqlite3, canvas, onnxruntime-node)
Source: "vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\AIPharmacyOS"; Flags: uninsdeletekey
; Guarantee the application never auto-starts on Windows PC boot
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "AI Pharmacy OS"; Flags: deletevalue uninsdeletevalue
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "AI Pharmacy OS"; Flags: deletevalue uninsdeletevalue

[InstallDelete]
; Strip any stray auto-start shortcuts from Windows Startup folder
Type: files; Name: "{userstartup}\AI Pharmacy OS.lnk"
Type: files; Name: "{userstartup}\PharmacyOS.lnk"
Type: files; Name: "{commonstartup}\AI Pharmacy OS.lnk"
Type: files; Name: "{commonstartup}\PharmacyOS.lnk"
; Strip any confusing secondary shortcuts from Start Menu and Desktop
Type: files; Name: "{group}\AI Pharmacy OS (Backend Only).lnk"
Type: files; Name: "{group}\Open in Browser.url"
Type: files; Name: "{group}\Run (with browser).lnk"
Type: files; Name: "{group}\Stop AI Pharmacy OS.lnk"
Type: files; Name: "{autodesktop}\Stop {#MyAppName}.lnk"

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/quiet /norestart"; StatusMsg: "Installing Visual C++ Redistributable (if needed)..."; Check: VCRedistNeedsInstall and VCRedistFilePresent; Flags: waituntilterminated
Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/F /IM {#MyAppExeName}"; Flags: runhidden; RunOnceId: "StopPharmacyServer"
Filename: "taskkill"; Parameters: "/F /IM PharmacyBackend.exe"; Flags: runhidden; RunOnceId: "StopPharmacyBackend"
Filename: "taskkill"; Parameters: "/F /IM electron.exe"; Flags: runhidden; RunOnceId: "StopPharmacyElectron"

; Runtime-created temporary folders/files (customer database, uploads, and backups are strictly preserved!)
[UninstallDelete]
Type: filesandordirs; Name: "{app}\.wwebjs_cache"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\frontend"
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"
Type: files; Name: "{app}\*.log"
Type: files; Name: "{app}\self_healing.log"
Type: files; Name: "{app}\crash_log*"

[Dirs]
Name: "{app}\data"; Permissions: users-full
Name: "{app}\uploads"; Permissions: users-full
Name: "{app}\uploads\temp"; Permissions: users-full
Name: "{app}\backup"; Permissions: users-full
Name: "{app}\updates"; Permissions: users-full
Name: "{app}\updates\staging"; Permissions: users-full

[Code]

// Install path is always {localappdata}\AI Pharmacy OS — no GetDefaultInstallDir needed.

function VCRedistFilePresent: Boolean;
begin
  Result := FileExists(ExpandConstant('{tmp}\vc_redist.x64.exe'));
end;

function VCRedistNeedsInstall: Boolean;
var
  Installed: Cardinal;
begin
  Result := not (RegQueryDWordValue(HKLM64, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64', 'Installed', Installed) and (Installed = 1));
end;

function IsProcessRunning(ExeName: String): Boolean;
var
  ResultCode: Integer;
begin
  Exec('cmd.exe',
    '/C tasklist /FI "IMAGENAME eq ' + ExeName + '" | findstr /I "' + ExeName + '" > nul 2>&1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := (ResultCode = 0);
end;

function IsPortInUse(Port: Integer): Boolean;
var
  ResultCode: Integer;
begin
  Exec('cmd.exe',
    '/C netstat -ano | findstr :' + IntToStr(Port) + ' | findstr LISTENING > nul 2>&1',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := (ResultCode = 0);
end;

function StopPharmacyProcess(): Boolean;
var
  ResultCode: Integer;
  Attempts: Integer;
begin
  Result := True;
  if IsProcessRunning('PharmacyOS.exe') or IsProcessRunning('PharmacyBackend.exe') or IsProcessRunning('electron.exe') then
  begin
    Log('[Upgrade] Pharmacy processes are running. Stopping processes...');
    Exec('taskkill.exe', '/F /IM PharmacyOS.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('taskkill.exe', '/F /IM PharmacyBackend.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('taskkill.exe', '/F /IM electron.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    Attempts := 0;
    while (IsProcessRunning('PharmacyOS.exe') or IsProcessRunning('PharmacyBackend.exe')) and (Attempts < 20) do
    begin
      Sleep(500);
      Attempts := Attempts + 1;
    end;

    if IsProcessRunning('PharmacyOS.exe') or IsProcessRunning('PharmacyBackend.exe') then
    begin
      Log('[Upgrade] Error: Failed to stop processes within timeout.');
      Result := False;
    end
    else
    begin
      Log('[Upgrade] Pharmacy processes stopped successfully.');
      Sleep(1000);
      Result := True;
    end;
  end;
end;

function BackupExistingDatabase(AppDir: String; var ErrorMsg: String): Boolean;
var
  DbPath: String;
  BackupDir: String;
  BackupFile: String;
  TimeStr: String;
  BackupSize: Int64;
  ResultCode: Integer;
begin
  Result := True;
  ErrorMsg := '';
  DbPath := AppDir + '\data\app.db';

  if not FileExists(DbPath) then
  begin
    Log('[Upgrade] No existing data\app.db found at: ' + DbPath + '. Skipping pre-upgrade backup.');
    Exit;
  end;

  BackupDir := AppDir + '\backup';
  if not ForceDirectories(BackupDir) then
  begin
    ErrorMsg := 'Failed to create backup directory: ' + BackupDir;
    Result := False;
    Exit;
  end;

  TimeStr := GetDateTimeString('yyyy-mm-dd-hhnnss', '-', '-');
  BackupFile := BackupDir + '\app-preupgrade-' + TimeStr + '.db';

  Log('[Upgrade] Existing database found. Creating pre-upgrade backup at: ' + BackupFile);

  Exec('cmd.exe', '/C copy /Y "' + DbPath + '" "' + BackupFile + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  if (ResultCode <> 0) or (not FileExists(BackupFile)) then
  begin
    if not CopyFile(DbPath, BackupFile, False) then
    begin
      ErrorMsg := 'Failed to copy database to backup destination: ' + BackupFile;
      Result := False;
      Exit;
    end;
  end;

  if not FileExists(BackupFile) then
  begin
    ErrorMsg := 'Backup file was not created: ' + BackupFile;
    Result := False;
    Exit;
  end;

  if not FileSize64(BackupFile, BackupSize) or (BackupSize = 0) then
  begin
    ErrorMsg := 'Backup file is empty (0 bytes): ' + BackupFile;
    Result := False;
    Exit;
  end;

  Log('[Upgrade] Verified pre-upgrade backup created successfully (' + IntToStr(BackupSize) + ' bytes).');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if IsPortInUse(5175) and (not IsProcessRunning('PharmacyOS.exe')) then
  begin
    if MsgBox(
      'Port 5175 is currently in use by another application.' + #13#10 +
      'AI Pharmacy OS needs port 5175 to run.' + #13#10#13#10 +
      'Continue installing anyway?',
      mbConfirmation, MB_YESNO) = IDNO then
      Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  AppDir: String;
  BackupErr: String;
begin
  Result := '';
  AppDir := ExpandConstant('{app}');

  // 1. Stop currently running PharmacyOS.exe safely
  if not StopPharmacyProcess() then
  begin
    Result := 'Could not terminate the running AI Pharmacy OS process.' + #13#10 +
              'Please close AI Pharmacy OS manually and run the installer again.';
    Exit;
  end;

  // 2. If existing database is present, create a verified pre-upgrade backup
  if FileExists(AppDir + '\data\app.db') then
  begin
    if not BackupExistingDatabase(AppDir, BackupErr) then
    begin
      Result := 'Database backup failed before upgrade.' + #13#10#13#10 +
                'Error: ' + BackupErr + #13#10#13#10 +
                'The installation has been aborted to protect your existing pharmacy data.' + #13#10 +
                'No application files were modified.';
      Exit;
    end;
  end;
end;

// Data directory is always {app}\data — beside the exe, no separate drive wizard.
// This eliminates the root cause of dual-install conflicts (DATA_DIR pointing to G:\ etc.)
function GetDataDir(Param: String): String;
begin
  Result := ExpandConstant('{app}\data');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  AppDir: String;
  EnvFilePath: String;
  EnvLines: TArrayOfString;
  I: Integer;
  DataDirFound: Boolean;
begin
  if CurStep = ssPostInstall then
  begin
    AppDir := ExpandConstant('{app}');
    // Data always lives in {app}\data — already created by [Dirs] section
    // Remove any stale DATA_DIR line from .env so the app uses its built-in default
    EnvFilePath := AppDir + '\.env';
    if FileExists(EnvFilePath) then
    begin
      if LoadStringsFromFile(EnvFilePath, EnvLines) then
      begin
        DataDirFound := False;
        for I := GetArrayLength(EnvLines) - 1 downto 0 do
        begin
          // Strip any DATA_DIR= line — app resolves data dir automatically beside the exe
          if Copy(EnvLines[I], 1, 9) = 'DATA_DIR=' then
          begin
            // Remove this element by shifting down
            SetArrayLength(EnvLines, GetArrayLength(EnvLines) - 1);
            DataDirFound := True;
          end;
        end;
        if DataDirFound then
          SaveStringsToFile(EnvFilePath, EnvLines, False);
      end;
    end;
    Sleep(2000);
  end;
end;

procedure ForceDeleteDir(Path: String);
var
  ResultCode: Integer;
begin
  if DirExists(Path) then
    Exec('cmd.exe', '/C rmdir /S /Q "' + Path + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  AppDir: String;
begin
  AppDir := ExpandConstant('{app}');

  if CurUninstallStep = usUninstall then
  begin
    ForceDeleteDir(AppDir + '\node_modules');
    ForceDeleteDir(AppDir + '\.wwebjs_auth');
    ForceDeleteDir(AppDir + '\.wwebjs_cache');
  end;

  if CurUninstallStep = usPostUninstall then
  begin
    // Program files and UI bundles are removed
    ForceDeleteDir(AppDir + '\frontend');
    DeleteFile(AppDir + '\PharmacyOS.exe');
    DeleteFile(AppDir + '\sea-entry.cjs');
    DeleteFile(AppDir + '\RUN-PharmacyOS.bat');
    DeleteFile(AppDir + '\RUN-PharmacyOS-Silent.vbs');
    DeleteFile(AppDir + '\STOP-PharmacyOS.bat');
    DeleteFile(AppDir + '\Updater.bat');
    DeleteFile(AppDir + '\license.txt');
    DeleteFile(AppDir + '\README.md');
    DeleteFile(AppDir + '\eng.traineddata');
    // Note: data\, uploads\, and backup\ are strictly PRESERVED to prevent customer business data loss!
  end;
end;
