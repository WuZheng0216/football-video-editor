; Football Video Editor Windows Installer Script
; Inno Setup Script for creating Windows installer

#define MyAppName "Football Video Editor"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Football Editor Team"
#define MyAppURL "https://github.com/yourusername/football-editor"
#define MyAppExeName "Football Video Editor.exe"
#define MyAppAssocName MyAppName + " Project"
#define MyAppAssocExt ".fvep"
#define MyAppAssocKey StringChange(MyAppAssocName, " ", "") + MyAppAssocExt

[Setup]
; NOTE: The value of AppId uniquely identifies this application. Do not use the same AppId value in installers for other applications.
; (To generate a new GUID, click Tools | Generate GUID inside the IDE.)
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
;AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
ChangesAssociations=yes
DisableProgramGroupPage=yes
LicenseFile=LICENSE.txt
; Uncomment the following line to run in non administrative install mode (install for current user only.)
;PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=dist
OutputBaseFilename=FootballVideoEditor_Setup
SetupIconFile=electron-app\assets\icon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinese"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 6.1; Check: not IsAdminInstallMode

[Files]
Source: "electron-app\dist\win-unpacked\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "electron-app\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "ai-engine\*"; DestDir: "{app}\ai-engine"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "video-core\*"; DestDir: "{app}\video-core"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "models\*"; DestDir: "{app}\models"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "docs\*"; DestDir: "{app}\docs"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion
; NOTE: Don't use "Flags: ignoreversion" on any shared system files

[Registry]
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocExt}"; ValueType: string; ValueName: ""; ValueData: "{#MyAppAssocName}"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocName}"; ValueType: string; ValueName: ""; ValueData: "{#MyAppAssocName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocName}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#MyAppExeName},0"
Root: HKA; Subkey: "Software\Classes\{#MyAppAssocName}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".mp4"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".avi"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".mov"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\{#MyAppExeName}\SupportedTypes"; ValueType: string; ValueName: ".mkv"; ValueData: ""

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: quicklaunchicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[InstallDelete]
Type: files; Name: "{app}\*.log"
Type: files; Name: "{app}\*.tmp"

[UninstallDelete]
Type: files; Name: "{app}\*.log"
Type: files; Name: "{app}\*.tmp"
Type: dirifempty; Name: "{app}"

[Code]
// Custom code to check for dependencies
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
  PythonPath: string;
begin
  // Check for FFmpeg
  if not Exec('ffmpeg', '-version', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    if MsgBox('FFmpeg is not detected on your system. Football Video Editor requires FFmpeg for video processing. ' +
      'Do you want to download and install FFmpeg now?', mbConfirmation, MB_YESNO) = IDYES then
    begin
      ShellExec('open', 'https://ffmpeg.org/download.html', '', '', SW_SHOW, ewNoWait, ResultCode);
    end;
  end;

  // Check for Python (for AI features)
  PythonPath := ExpandConstant('{sys}\python.exe');
  if not FileExists(PythonPath) then
  begin
    PythonPath := ExpandConstant('{sd}\Python\python.exe');
    if not FileExists(PythonPath) then
    begin
      if MsgBox('Python is not detected. AI features require Python 3.8+. ' +
        'Do you want to download Python?', mbConfirmation, MB_YESNO) = IDYES then
      begin
        ShellExec('open', 'https://www.python.org/downloads/', '', '', SW_SHOW, ewNoWait, ResultCode);
      end;
    end;
  end;

  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    // Create start menu folder
    CreateShellLink(
      ExpandConstant('{userprograms}\Football Video Editor\Documentation.lnk'),
      'Football Video Editor Documentation',
      ExpandConstant('{app}\README.md'),
      '',
      '',
      '',
      0,
      SW_SHOWNORMAL
    );

    // Create desktop shortcut if requested
    if IsTaskSelected('desktopicon') then
    begin
      CreateShellLink(
        ExpandConstant('{userdesktop}\Football Video Editor.lnk'),
        'Football Video Editor',
        ExpandConstant('{app}\{#MyAppExeName}'),
        '',
        '',
        '',
        0,
        SW_SHOWNORMAL
      );
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    // Remove user data
    DelTree(ExpandConstant('{userappdata}\Football Video Editor'), True, True, True);
    DelTree(ExpandConstant('{localappdata}\Football Video Editor'), True, True, True);
  end;
end;

function GetUninstallString(): string;
var
  sUnInstPath: string;
  sUnInstallString: string;
begin
  sUnInstPath := ExpandConstant('Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1');
  sUnInstallString := '';
  if not RegQueryStringValue(HKLM, sUnInstPath, 'UninstallString', sUnInstallString) then
    RegQueryStringValue(HKCU, sUnInstPath, 'UninstallString', sUnInstallString);
  Result := sUnInstallString;
end;

function IsUpgrade(): Boolean;
begin
  Result := (GetUninstallString() <> '');
end;

function InitializeUninstall(): Boolean;
var
  V: Integer;
  iResultCode: Integer;
  sUnInstallString: string;
begin
  Result := True;
  
  // Check for running instance
  if CheckForMutexes('FootballVideoEditor') then
  begin
    if MsgBox('Football Video Editor is currently running. Please close it before uninstalling.',
      mbError, MB_OKCANCEL) = IDCANCEL then
    begin
      Result := False;
      Exit;
    end;
  end;

  // Uninstall previous version if exists
  sUnInstallString := GetUninstallString();
  if sUnInstallString <> '' then
  begin
    sUnInstallString := RemoveQuotes(sUnInstallString);
    if Exec(sUnInstallString, '/SILENT', '', SW_HIDE, ewWaitUntilTerminated, iResultCode) then
    begin
      // Wait for uninstall to complete
      Sleep(3000);
    end;
  end;
end;