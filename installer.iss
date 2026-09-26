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

; Smart default directory: prefers D:\ or E:\ if present to protect C: drive space
DefaultDirName={code:GetDefaultInstallDir}
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
; Main executable (Node SEA — do not recompress the blob)
Source: "dist\PharmacyOS.exe"; DestDir: "{app}"; Flags: ignoreversion nocompression

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
Name: "{group}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\RUN-PharmacyOS-Silent.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{group}\AI Pharmacy OS (Debug Console)"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{group}\Open in Browser"; Filename: "http://localhost:{#MyAppPort}"; IconFilename: "{app}\app.ico"
Name: "{group}\Run (with browser)"; Filename: "{app}\RUN-PharmacyOS.bat"; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"
Name: "{group}\Stop AI Pharmacy OS"; Filename: "{app}\STOP-PharmacyOS.bat"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\RUN-PharmacyOS-Silent.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon
Name: "{autodesktop}\Stop {#MyAppName}"; Filename: "{app}\STOP-PharmacyOS.bat"; WorkingDir: "{app}"; Tasks: desktopicon

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

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/quiet /norestart"; StatusMsg: "Installing Visual C++ Redistributable (if needed)..."; Check: VCRedistNeedsInstall and VCRedistFilePresent; Flags: waituntilterminated
Filename: "{sys}\wscript.exe"; Parameters: """{app}\RUN-PharmacyOS-Silent.vbs"""; WorkingDir: "{app}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/F /IM {#MyAppExeName}"; Flags: runhidden; RunOnceId: "StopPharmacyServer"

; Runtime-created temporary folders/files (customer database, uploads, and backups are strictly preserved!)
[UninstallDelete]
Type: filesandordirs; Name: "{app}\.wwebjs_cache"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\frontend"
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

function GetDefaultInstallDir(Param: String): String;
begin
  // Prioritize secondary drives (D:\, E:\) to protect C: drive space and ensure long-term stability
  if DirExists('D:\') then
    Result := 'D:\AI Pharmacy OS'
  else if DirExists('E:\') then
    Result := 'E:\AI Pharmacy OS'
  else
    Result := ExpandConstant('{localappdata}\{#MyAppName}');
end;

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
  if IsProcessRunning('PharmacyOS.exe') then
  begin
    Log('[Upgrade] PharmacyOS.exe is currently running. Stopping process...');
    Exec('taskkill.exe', '/F /IM PharmacyOS.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

    Attempts := 0;
    while IsProcessRunning('PharmacyOS.exe') and (Attempts < 20) do
    begin
      Sleep(500);
      Attempts := Attempts + 1;
    end;

    if IsProcessRunning('PharmacyOS.exe') then
    begin
      Log('[Upgrade] Error: Failed to stop PharmacyOS.exe within timeout.');
      Result := False;
    end
    else
    begin
      Log('[Upgrade] PharmacyOS.exe stopped successfully.');
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

var
  DataDirPage: TInputDirWizardPage;

procedure InitializeWizard;
var
  DefaultDataPath: String;
begin
  if DirExists('D:\') then
    DefaultDataPath := 'D:\AI_Pharmacy_Data'
  else if DirExists('E:\') then
    DefaultDataPath := 'E:\AI_Pharmacy_Data'
  else
    DefaultDataPath := ExpandConstant('{app}\data');

  DataDirPage := CreateInputDirPage(
    wpSelectDir,
    'Select Database & Storage Location',
    'Where should AI Pharmacy OS store your database, patient history, and bill uploads?',
    'Select the folder or drive for your pharmacy data. We recommend selecting D:\ or E:\ so your C: drive never runs out of space over years of usage.' + #13#10#13#10 +
    'Click Next to use this folder, or click Browse to select a different folder or drive.',
    False,
    'New Folder'
  );
  DataDirPage.Add('Data directory:');
  DataDirPage.Values[0] := DefaultDataPath;
end;

function GetDataDir(Param: String): String;
begin
  if (DataDirPage <> nil) and (DataDirPage.Values[0] <> '') then
    Result := DataDirPage.Values[0]
  else if DirExists('D:\') then
    Result := 'D:\AI_Pharmacy_Data'
  else if DirExists('E:\') then
    Result := 'E:\AI_Pharmacy_Data'
  else
    Result := ExpandConstant('{app}\data');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  AppDir: String;
  TargetDataDir: String;
  EnvFilePath: String;
  EnvLines: TArrayOfString;
  I: Integer;
  DataDirFound: Boolean;
  NewEnvContent: String;
begin
  if CurStep = ssPostInstall then
  begin
    AppDir := ExpandConstant('{app}');
    TargetDataDir := GetDataDir('');

    // 1. Provision storage directory structure on chosen drive
    ForceDirectories(TargetDataDir);
    ForceDirectories(TargetDataDir + '\data');
    ForceDirectories(TargetDataDir + '\uploads');
    ForceDirectories(TargetDataDir + '\uploads\temp');
    ForceDirectories(TargetDataDir + '\backup');

    // 2. Copy seed catalog files into chosen data directory if not already present
    if FileExists(AppDir + '\data\reference_medicines.csv') and (not FileExists(TargetDataDir + '\data\reference_medicines.csv')) then
      FileCopy(AppDir + '\data\reference_medicines.csv', TargetDataDir + '\data\reference_medicines.csv', False);

    if FileExists(AppDir + '\data\medicine_reference_seed.json') and (not FileExists(TargetDataDir + '\data\medicine_reference_seed.json')) then
      FileCopy(AppDir + '\data\medicine_reference_seed.json', TargetDataDir + '\data\medicine_reference_seed.json', False);

    // 3. Inject or update DATA_DIR in {app}\.env
    EnvFilePath := AppDir + '\.env';
    DataDirFound := False;
    if FileExists(EnvFilePath) then
    begin
      if LoadStringsFromFile(EnvFilePath, EnvLines) then
      begin
        for I := 0 to GetArrayLength(EnvLines) - 1 do
        begin
          if Copy(EnvLines[I], 1, 9) = 'DATA_DIR=' then
          begin
            EnvLines[I] := 'DATA_DIR=' + TargetDataDir;
            DataDirFound := True;
          end;
        end;
        if not DataDirFound then
        begin
          SetArrayLength(EnvLines, GetArrayLength(EnvLines) + 1);
          EnvLines[GetArrayLength(EnvLines) - 1] := 'DATA_DIR=' + TargetDataDir;
        end;
        SaveStringsToFile(EnvFilePath, EnvLines, False);
      end;
    end
    else
    begin
      NewEnvContent := 'PORT=5175' + #13#10 +
                       'NODE_ENV=production' + #13#10 +
                       'AUTO_OPEN_BROWSER=true' + #13#10 +
                       'SINGLE_PROCESS_WORKERS=true' + #13#10 +
                       'DATA_DIR=' + TargetDataDir + #13#10;
      SaveStringToFile(EnvFilePath, NewEnvContent, False);
    end;

    Sleep(3000);
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
