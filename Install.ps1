[CmdletBinding()]
param([string]$NcmExe = '', [switch]$NonInteractive, [switch]$DetectOnly)

$ErrorActionPreference = 'Stop'
$installDir = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Pachi\NcmImmersive'))
$installedExe = Join-Path $installDir 'NcmImmersive.exe'
$installedUninstall = Join-Path $installDir 'Uninstall.ps1'
$clientPathFile = Join-Path $installDir 'client-path.txt'
$sourceExe = Join-Path $PSScriptRoot 'dist\NcmImmersive.exe'
$sourceUninstall = Join-Path $PSScriptRoot 'Uninstall.ps1'
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$shortcutPath = Join-Path $desktop '网易云音乐 · 沉浸听歌.lnk'

function Assert-RegularPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "为避免改动其他位置，安装已停止：$Path 是链接。"
        }
    }
}

function Test-SamePath([string]$Left, [string]$Right) {
    if ([string]::IsNullOrWhiteSpace($Left)) { return $false }
    return [string]::Equals([IO.Path]::GetFullPath($Left), [IO.Path]::GetFullPath($Right),
        [StringComparison]::OrdinalIgnoreCase)
}

foreach ($source in @($sourceExe, $sourceUninstall)) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "缺少安装文件：$source。请先构建 dist\NcmImmersive.exe。"
    }
}

# The executable owns discovery so portable launch and installation agree.
$reportPath = Join-Path ([IO.Path]::GetTempPath()) ('touhou-ncm-detect-' + [Guid]::NewGuid().ToString('N') + '.json')
try {
    $detectArguments = @('--detect-client', ('"' + $reportPath + '"'))
    if ($NcmExe) { $detectArguments += '"' + $NcmExe.Trim('"') + '"' }
    $probe = Start-Process -FilePath $sourceExe -ArgumentList $detectArguments -WindowStyle Hidden -Wait -PassThru
    try { $probeExit = $probe.ExitCode } finally { $probe.Dispose() }
    if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) { throw '无法读取客户端检测结果，请确认已完整解压 ZIP，并允许启动 dist\NcmImmersive.exe。' }
    $detected = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $detected.Found -and -not $NcmExe -and -not $NonInteractive -and -not $DetectOnly) {
        Write-Host '未自动找到网易云。请在选择窗口中选择安装目录内的 cloudmusic.exe。'
        $probe = Start-Process -FilePath $sourceExe -ArgumentList @('--choose-client', ('"' + $reportPath + '"')) -WindowStyle Hidden -Wait -PassThru
        try { $probeExit = $probe.ExitCode } finally { $probe.Dispose() }
        $detected = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    if ($probeExit -ne 0 -or -not $detected.Found) { throw '未找到有效的网易云桌面客户端，安装尚未修改任何文件。可运行 SelectClient.cmd，或使用 Install.ps1 -NcmExe "完整路径\cloudmusic.exe"。' }
    $NcmExe = $detected.Path
    Write-Host "已检测到网易云 $($detected.Version)：$NcmExe"
    Write-Host "检测来源：$($detected.Source)"
} finally {
    if (Test-Path -LiteralPath $reportPath -PathType Leaf) { Remove-Item -LiteralPath $reportPath -Force }
}
if ($DetectOnly) { return }

foreach ($path in @((Split-Path $installDir -Parent), $installDir, $installedExe,
        $installedUninstall, $clientPathFile, $shortcutPath)) {
    Assert-RegularPath $path
}

$shell = New-Object -ComObject WScript.Shell
try {
    if (Test-Path -LiteralPath $shortcutPath) {
        $existing = $shell.CreateShortcut($shortcutPath)
        try {
            if (-not (Test-SamePath $existing.TargetPath $installedExe)) {
                throw "桌面同名快捷方式指向其他程序，已保留：$shortcutPath"
            }
        } finally {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($existing)
        }
    }

    [void][IO.Directory]::CreateDirectory($installDir)
    # The helper is normally idle behind the native mini window. Let it release
    # the previous executable before installing a later build.
    if (Test-Path -LiteralPath $installedExe -PathType Leaf) {
        $watchers = @(Get-Process -Name 'NcmImmersive' -ErrorAction SilentlyContinue |
            Where-Object { Test-SamePath $_.Path $installedExe })
        if ($watchers.Count) {
            try {
                $signal = [Threading.EventWaitHandle]::OpenExisting('Local\Pachi.NcmImmersive.Mini.Stop')
                try { [void]$signal.Set() } finally { $signal.Dispose() }
            } catch [Threading.WaitHandleCannotBeOpenedException] { }
            try {
                foreach ($watcher in $watchers) {
                    if (-not $watcher.WaitForExit(6500)) {
                        throw '沉浸听歌仍在释放浮窗，请稍后重新安装。'
                    }
                }
            } finally {
                foreach ($watcher in $watchers) { $watcher.Dispose() }
            }
        }
    }
    Copy-Item -LiteralPath $sourceExe -Destination $installedExe -Force
    Copy-Item -LiteralPath $sourceUninstall -Destination $installedUninstall -Force
    [IO.File]::WriteAllText($clientPathFile, $NcmExe, (New-Object Text.UTF8Encoding($false)))

    $shortcut = $shell.CreateShortcut($shortcutPath)
    try {
        $shortcut.TargetPath = $installedExe
        if (-not $shortcut.WorkingDirectory) { $shortcut.WorkingDirectory = Split-Path $NcmExe -Parent }
        $shortcut.Description = '打开网易云音乐，新版直接接管播放详情'
        $shortcut.IconLocation = "$NcmExe,0"
        $shortcut.Save()
    } finally {
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
    }
} finally {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
}

Write-Host '已更新网易云主界面、沉浸播放、桌面歌词和迷你播放器。'
Write-Host "继续使用现有入口：$shortcutPath"
Write-Host "卸载脚本：$installedUninstall"
Write-Host '已有定制会话可直接重新打开入口；原始入口启动的客户端需先从托盘退出。'
