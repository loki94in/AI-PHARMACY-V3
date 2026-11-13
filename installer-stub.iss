; ============================================================
;  AI Pharmacy OS — Lightweight Web / Stub Installer (~2.5 MB)
;  Compiler: Inno Setup 6.x  (https://jrsoftware.org/isinfo.php)
;
;  Architecture:
;    - Size: ~2.5 MB (bundles ONLY Inno Setup engine & branding)
;    - Zero bandwidth wasted on unauthorized users
;    - Prompts for License ID & Key on fresh PC (skips on existing)
;    - Validates license online with cloud server
;    - Downloads core application payload via native DownloadTemporaryFile
;    - Extracts payload to %LOCALAPPDATA%\AI Pharmacy OS
;    - Automatically creates desktop shortcuts and launches app
; ============================================================

#define MyAppName      "AI Pharmacy OS"
#ifndef MyAppVersion
  #define MyAppVersion "0.1.230"
#endif
#ifndef PayloadUrl
  #define PayloadUrl "https://github.com/loki94in/AI-PHARMACY-V3/releases/download/v" + MyAppVersion + "/AI-Pharmacy-OS-Update-v" + MyAppVersion + ".zip"
#endif
#define MyAppPublisher "AI Pharmacy Team"
#define MyAppExeName   "PharmacyOS.exe"
#define MyAppIcon      "packaging\app.ico"
#define LicenseServer  "https://website-woad-seven-26.vercel.app"

[Setup]
AppId={{E3A1F2B4-7C8D-4E5F-9A0B-1C2D3E4F5A6B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion} (Web Setup)
AppPublisher={#MyAppPublisher}
SetupIconFile={#MyAppIcon}

DefaultDirName={localappdata}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
DisableDirPage=no

OutputDir=dist\installer
OutputBaseFilename=AI-Pharmacy-OS-WebSetup-v{#MyAppVersion}

Compression=lzma2/max
SolidCompression=yes

WizardStyle=modern
DisableWelcomePage=no
DisableProgramGroupPage=yes

PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UsedUserAreasWarning=no

LicenseFile=license.txt
UninstallDisplayIcon={app}\app.ico
UninstallDisplayName={#MyAppName} (Web Setup)
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Web Stub Installer
MinVersion=10.0
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "{#MyAppIcon}"; DestDir: "{app}"; Flags: ignoreversion
Source: "packaging\RUN-PharmacyOS.bat"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "packaging\STOP-PharmacyOS.bat"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\app.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

[Code]
var
  DownloadPage: TDownloadWizardPage;
  LicensePage: TInputQueryWizardPage;
  IsExistingInstall: Boolean;
  VerifiedPharmacyName: String;
  VerifiedLicenseId: String;
  VerifiedLicenseKey: String;

function CheckIfExistingInstall(): Boolean;
var
  AppDir: String;
begin
  AppDir := '';
  if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{E3A1F2B4-7C8D-4E5F-9A0B-1C2D3E4F5A6B}_is1', 'InstallLocation', AppDir) then
  begin
    if (AppDir <> '') and (FileExists(AppDir + '\data\app.db') or FileExists(AppDir + '\PharmacyOS.exe')) then
    begin
      Result := True;
      Exit;
    end;
  end;

  AppDir := ExpandConstant('{localappdata}\{#MyAppName}');
  Result := FileExists(AppDir + '\data\app.db') or FileExists(AppDir + '\PharmacyOS.exe');
end;

function GetMachineGuid(): String;
var
  Guid: String;
begin
  Guid := '';
  if RegQueryStringValue(HKEY_LOCAL_MACHINE, 'SOFTWARE\Microsoft\Cryptography', 'MachineGuid', Guid) then
    Result := Lowercase(Trim(Guid))
  else
    Result := Lowercase(Trim(GetComputerNameString()));
end;

function ExtractJsonString(const JsonText, Key: String): String;
var
  SearchKey: String;
  P, StartPos, EndPos: Integer;
begin
  Result := '';
  SearchKey := '"' + Key + '":';
  P := Pos(SearchKey, JsonText);
  if P > 0 then
  begin
    StartPos := P + Length(SearchKey);
    while (StartPos <= Length(JsonText)) and ((JsonText[StartPos] = ' ') or (JsonText[StartPos] = '"')) do
      Inc(StartPos);
    EndPos := StartPos;
    while (EndPos <= Length(JsonText)) and (JsonText[EndPos] <> '"') and (JsonText[EndPos] <> ',') and (JsonText[EndPos] <> '}') do
      Inc(EndPos);
    Result := Copy(JsonText, StartPos, EndPos - StartPos);
  end;
end;

function VerifyAndActivateLicense(const LicId, LicKey: String; var ErrorMsg: String): Boolean;
var
  WinHttp: Variant;
  PostData: String;
  ResponseText: String;
  HttpStatus: Integer;
  MachineId: String;
  MachineName: String;
begin
  Result := False;
  ErrorMsg := '';
  MachineId := GetMachineGuid();
  MachineName := GetComputerNameString();

  try
    WinHttp := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    WinHttp.Open('POST', '{#LicenseServer}/api/license/activate', False);
    WinHttp.SetRequestHeader('Content-Type', 'application/json');
    WinHttp.SetTimeouts(5000, 10000, 10000, 15000);

    PostData := '{"licenseId":"' + LicId + '","licenseKey":"' + LicKey + '","machineId":"' + MachineId + '","machineName":"' + MachineName + '"}';
    WinHttp.Send(PostData);

    HttpStatus := WinHttp.Status;
    ResponseText := WinHttp.ResponseText;

    if (HttpStatus = 200) and (Pos('"success":true', Lowercase(ResponseText)) > 0) then
    begin
      VerifiedLicenseId := LicId;
      VerifiedLicenseKey := LicKey;
      VerifiedPharmacyName := ExtractJsonString(ResponseText, 'pharmacyName');
      Result := True;
    end
    else
    begin
      ErrorMsg := ExtractJsonString(ResponseText, 'error');
      if ErrorMsg = '' then
        ErrorMsg := 'Server returned HTTP ' + IntToStr(HttpStatus) + ': ' + ResponseText;
    end;
  except
    ErrorMsg := 'Could not connect to license activation server (' + '{#LicenseServer}' + ').' + #13#10 +
                'Please check your internet connection and verify that this PC can reach ' + '{#LicenseServer}' + #13#10 +
                'Details: ' + GetExceptionMessage;
  end;
end;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  Result := True;
end;

procedure InitializeWizard();
begin
  IsExistingInstall := CheckIfExistingInstall();

  // License activation wizard page (only for fresh installations)
  if not IsExistingInstall then
  begin
    LicensePage := CreateInputQueryPage(
      wpLicense,
      'License Activation',
      'Please enter your License ID and License Key',
      'An authorized license is required to download and install AI Pharmacy OS.' + #13#10 +
      'If you do not have a license, visit our portal or contact support.'
    );
    LicensePage.Add('License ID (e.g. PHARM-XXXX):', False);
    LicensePage.Add('License Key (XXXX-XXXX-XXXX-XXXX):', False);
  end;

  // Native Inno Setup Download Page
  DownloadPage := CreateDownloadPage(
    'Downloading Application Components',
    'Please wait while the setup downloads the latest AI Pharmacy OS package...',
    @OnDownloadProgress
  );
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  LicIdInput, LicKeyInput, ServerError: String;
begin
  Result := True;

  // Validate and activate license on fresh install
  if (not IsExistingInstall) and Assigned(LicensePage) and (CurPageID = LicensePage.ID) then
  begin
    LicIdInput := Trim(LicensePage.Values[0]);
    LicKeyInput := Trim(LicensePage.Values[1]);

    if (LicIdInput = '') or (LicKeyInput = '') then
    begin
      MsgBox('Please enter both your License ID and License Key to proceed.' + #13#10 +
             'Contact AI Pharmacy support if you need to purchase or activate a license.', mbError, MB_OK);
      Result := False;
      Exit;
    end;

    // Check online with license server
    if not VerifyAndActivateLicense(LicIdInput, LicKeyInput, ServerError) then
    begin
      MsgBox('License Activation Failed:' + #13#10#13#10 +
             ServerError + #13#10#13#10 +
             'Installation cannot proceed without an authorized license.', mbCriticalError, MB_OK);
      Result := False;
      Exit;
    end;

    // Success confirmation
    MsgBox('License Verified Successfully!' + #13#10#13#10 +
           'Pharmacy: ' + VerifiedPharmacyName + #13#10 +
           'License ID: ' + VerifiedLicenseId + #13#10 +
           'Hardware Bound: ' + GetComputerNameString() + #13#10#13#10 +
           'Click OK to download and install AI Pharmacy OS.', mbInformation, MB_OK);
  end;

  // Trigger download on the page just before installation begins
  if CurPageID = wpReady then
  begin
    DownloadPage.Clear;
    DownloadPage.Add('{#PayloadUrl}', 'AI-Pharmacy-OS-Payload.zip', '');
    DownloadPage.Show;
    try
      try
        DownloadPage.Download;
        Result := True;
      except
        if DownloadPage.AbortedByUser then
          Log('Download aborted by user.')
        else
          MsgBox('Download failed: ' + GetExceptionMessage + #13#10 +
                 'Please check your internet connection and retry.', mbError, MB_OK);
        Result := False;
      end;
    finally
      DownloadPage.Hide;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ZipPath: String;
  DestPath: String;
  DataDir: String;
  PreActivationFile: String;
  PreActivationJson: String;
  ExtractCmd: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ZipPath := ExpandConstant('{tmp}\AI-Pharmacy-OS-Payload.zip');
    DestPath := ExpandConstant('{app}');

    if FileExists(ZipPath) then
    begin
      WizardForm.StatusLabel.Caption := 'Extracting application files...';
      
      // Native Windows PowerShell archive expansion
      ExtractCmd := '/C powershell -NoProfile -ExecutionPolicy Bypass -Command ' +
                    '"Expand-Archive -LiteralPath ''' + ZipPath + ''' -DestinationPath ''' + DestPath + ''' -Force"';
      
      Exec(ExpandConstant('{cmd}'), ExtractCmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      DeleteFile(ZipPath);
    end;

    // Save pre_activation.json for fresh verified installations
    if (not IsExistingInstall) and (VerifiedLicenseId <> '') then
    begin
      DataDir := DestPath + '\data';
      if not DirExists(DataDir) then
        CreateDir(DataDir);

      PreActivationFile := DataDir + '\pre_activation.json';
      PreActivationJson := '{"licenseId":"' + VerifiedLicenseId + '","pharmacyName":"' + VerifiedPharmacyName + '","licenseKey":"' + VerifiedLicenseKey + '","machineId":"' + GetMachineGuid() + '"}';
      SaveStringToFile(PreActivationFile, PreActivationJson, False);
    end;
  end;
end;
