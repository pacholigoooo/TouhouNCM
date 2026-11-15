[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$installDir = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Pachi\NcmImmersive'))
$installedExe = Join-Path $installDir 'NcmImmersive.exe'
$installedUninstall = Join-Path $installDir 'Uninstall.ps1'
$sessionPath = Join-Path $installDir 'session.txt'
$desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)

function Assert-RegularPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        $item = Get-Item -LiteralPath $Path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "为避免改动其他位置，卸载已停止：$Path 是链接。"
        }
    }
}

function Test-SamePath([string]$Left, [string]$Right) {
    if ([string]::IsNullOrWhiteSpace($Left)) { return $false }
    return [string]::Equals([IO.Path]::GetFullPath($Left), [IO.Path]::GetFullPath($Right),
        [StringComparison]::OrdinalIgnoreCase)
}

$knownFiles = @($installedExe, $sessionPath, (Join-Path $installDir 'attach-error.txt'),
    (Join-Path $installDir 'client-path.txt'), (Join-Path $installDir 'caption-region.txt'),
    (Join-Path $installDir 'caption-region.txt.tmp'))
foreach ($path in @((Split-Path $installDir -Parent), $installDir, $installedUninstall) + $knownFiles) {
    Assert-RegularPath $path
}

if ((Test-Path -LiteralPath $sessionPath -PathType Leaf) -or
        (Test-Path -LiteralPath (Join-Path $installDir 'caption-region.txt') -PathType Leaf)) {
    if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
        throw '有已记录会话，但启动器已不存在。请关闭网易云后删除 session.txt，再重新卸载。'
    }
    $watchers = @(Get-Process -Name 'NcmImmersive' -ErrorAction SilentlyContinue |
        Where-Object { Test-SamePath $_.Path $installedExe })
    $detach = Start-Process -FilePath $installedExe -ArgumentList '--detach' -Wait -PassThru -WindowStyle Hidden
    try {
        if ($detach.ExitCode -ne 0) {
            throw '请求退出沉浸模式失败，安装文件已保留。请退出网易云后重试卸载。'
        }
    } finally {
        $detach.Dispose()
        try {
            foreach ($watcher in $watchers) {
                if (-not $watcher.WaitForExit(6500)) {
                    throw '沉浸听歌仍在释放浮窗，请稍后重新卸载。'
                }
            }
        } finally {
            foreach ($watcher in $watchers) { $watcher.Dispose() }
        }
    }
}

$shell = New-Object -ComObject WScript.Shell
try {
    if (Test-Path -LiteralPath $desktop -PathType Container) {
        foreach ($link in Get-ChildItem -LiteralPath $desktop -Filter '*.lnk' -File -Force) {
            if (($link.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            $shortcut = $null
            try {
                $shortcut = $shell.CreateShortcut($link.FullName)
                if (Test-SamePath $shortcut.TargetPath $installedExe) {
                    Remove-Item -LiteralPath $link.FullName -Force
                }
            } finally {
                if ($null -ne $shortcut) {
                    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut)
                }
            }
        }
    }
} finally {
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
}

foreach ($path in $knownFiles) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
    }
}

# PowerShell has already loaded this script; its installed copy can be removed last,
# including when that copy is the currently executing script. The workspace copy stays.
if (Test-Path -LiteralPath $installedUninstall -PathType Leaf) {
    Remove-Item -LiteralPath $installedUninstall -Force
}
if (Test-Path -LiteralPath $installDir -PathType Container) {
    if (@(Get-ChildItem -LiteralPath $installDir -Force).Count -eq 0) {
        Remove-Item -LiteralPath $installDir
    } else {
        Write-Host "目录内还有其他文件，已保留：$installDir"
    }
}

Write-Host '已卸载沉浸听歌入口。原版网易云客户端未作改动。'
