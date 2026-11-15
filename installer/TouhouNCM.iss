#ifndef AppVersion
  #error AppVersion must be supplied by scripts/package.cjs
#endif

[Setup]
AppId={{A43B9781-56A8-4F5F-9277-B072764C99A8}
AppName=TouhouNCM
AppVersion={#AppVersion}
AppPublisher=pachi
AppPublisherURL=https://github.com/pacholigoooo/TouhouNCM
AppSupportURL=https://github.com/pacholigoooo/TouhouNCM/issues
AppUpdatesURL=https://github.com/pacholigoooo/TouhouNCM/releases/latest
DefaultDirName={localappdata}\Pachi\NcmImmersive
DefaultGroupName=TouhouNCM
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=yes
UsePreviousTasks=no
OutputDir=..\dist
OutputBaseFilename=TouhouNCM-{#AppVersion}-Setup-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayName=TouhouNCM
UninstallDisplayIcon={app}\NcmImmersive.exe
VersionInfoVersion={#AppVersion}
VersionInfoDescription=TouhouNCM 安装程序

[Languages]
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"

[Messages]
ReadyLabel1=为东方众设计的网易云音乐美化包。
ReadyLabel2b=点击“安装”即可完成安装。请先在电脑上安装网易云音乐 Windows 客户端。
FinishedLabel=安装完成。可通过桌面的“网易云音乐 · 沉浸听歌”启动 TouhouNCM。%n%n若网易云由原始入口启动，请先从系统托盘退出，再打开新的快捷方式。

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: checkedonce

[Files]
Source: "..\dist\NcmImmersive.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\THIRD_PARTY.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "InnoSetup-LICENSE.txt"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "..\assets\characters\manifest.json"; DestDir: "{app}\assets\characters"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\网易云音乐 · 沉浸听歌"; Filename: "{app}\NcmImmersive.exe"; Tasks: desktopicon
Name: "{group}\TouhouNCM"; Filename: "{app}\NcmImmersive.exe"
Name: "{group}\重新选择网易云路径"; Filename: "{app}\NcmImmersive.exe"; Parameters: "--select-client"
Name: "{group}\卸载 TouhouNCM"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\NcmImmersive.exe"; Description: "启动 TouhouNCM"; Flags: postinstall nowait skipifsilent unchecked

[InstallDelete]
; The ZIP installer used this script before Windows uninstall registration existed.
Type: files; Name: "{app}\Uninstall.ps1"

[UninstallDelete]
Type: files; Name: "{app}\session.txt"
Type: files; Name: "{app}\attach-error.txt"
Type: files; Name: "{app}\caption-region.txt"
Type: files; Name: "{app}\caption-region.txt.tmp"

[Code]
function StopSession: Boolean;
var
  Launcher: String;
  ExitCode: Integer;
begin
  Result := True;
  Launcher := ExpandConstant('{app}\NcmImmersive.exe');
  if FileExists(Launcher) and
    (FileExists(ExpandConstant('{app}\session.txt')) or
     FileExists(ExpandConstant('{app}\caption-region.txt'))) then
    Result := Exec(Launcher, '--detach', '', SW_HIDE, ewWaitUntilTerminated, ExitCode)
      and (ExitCode = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not StopSession then
    Result := '请先从系统托盘退出网易云音乐，再点击“安装”。';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usUninstall) and not StopSession then
    RaiseException('请先从系统托盘退出网易云音乐，再重新卸载。');
end;
