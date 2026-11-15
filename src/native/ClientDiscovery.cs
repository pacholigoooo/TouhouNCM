using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Security;
using System.Security.Principal;
using System.Text.RegularExpressions;
using Microsoft.Win32;

internal sealed class ClientInstallation
{
    public string Path { get; set; }
    public string Version { get; set; }
    public string Source { get; set; }
}

internal sealed class ClientHint
{
    internal string Value, Source;
    internal ClientHint(string value, string source) { Value = value; Source = source; }
}

// Discovery only reads installation information. It never starts a candidate,
// edits the registry, or scans a whole disk.
internal static class ClientDiscovery
{
    internal const string MissingMessage = "没有找到网易云音乐桌面客户端。已检查已保存路径、当前用户的运行进程、注册表和常见安装目录。\n请点击“确定”后选择网易云安装目录中的 cloudmusic.exe；也可先安装 Windows 桌面版，再重新打开本程序。";

    internal static ClientInstallation Discover(string savedPathFile)
    {
        var hints = new List<ClientHint>();
        try
        {
            if (File.Exists(savedPathFile)) hints.Add(new ClientHint(File.ReadAllText(savedPathFile), "已保存路径"));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        var saved = FirstValid(hints);
        if (saved != null) return saved;
        hints.Clear();
        AddRunningClients(hints);
        AddRegistryClients(hints);
        AddCommonLocations(hints);
        return FirstValid(hints);
    }

    internal static ClientInstallation FirstValid(IEnumerable<ClientHint> hints)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var hint in hints)
        {
            string path = PathFromCommand(hint.Value);
            if (!seen.Add(path)) continue;
            var client = FromPath(path, hint.Source);
            if (client != null) return client;
        }
        return null;
    }

    internal static string PathFromCommand(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "";
        value = Environment.ExpandEnvironmentVariables(value.Trim().Trim('\uFEFF'));
        if (value.StartsWith("\"", StringComparison.Ordinal))
        {
            int end = value.IndexOf('"', 1);
            return end > 1 ? value.Substring(1, end - 1) : "";
        }
        var exe = Regex.Match(value, @"^(.+?\.exe)(?:\s|,|$)", RegexOptions.IgnoreCase);
        return exe.Success ? exe.Groups[1].Value : value;
    }

    internal static ClientInstallation FromPath(string path, string source)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(path) || !System.IO.Path.IsPathRooted(path)) return null;
            if (Directory.Exists(path)) path = System.IO.Path.Combine(path, "cloudmusic.exe");
            path = System.IO.Path.GetFullPath(path);
            if (!string.Equals(System.IO.Path.GetFileName(path), "cloudmusic.exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return null;
            // Reject text files and invalid selections without executing them.
            using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var reader = new BinaryReader(stream))
            {
                if (stream.Length < 64 || reader.ReadUInt16() != 0x5A4D) return null;
                stream.Position = 0x3C;
                int header = reader.ReadInt32();
                if (header < 64 || header > stream.Length - 4) return null;
                stream.Position = header;
                if (reader.ReadUInt32() != 0x00004550) return null;
            }
            var version = FileVersionInfo.GetVersionInfo(path);
            return new ClientInstallation { Path = path, Version = string.IsNullOrWhiteSpace(version.FileVersion) ? "未知" : version.FileVersion.Trim(), Source = source };
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        catch (ArgumentException) { }
        catch (NotSupportedException) { }
        catch (SecurityException) { }
        catch (System.ComponentModel.Win32Exception) { }
        return null;
    }

    static void AddRunningClients(List<ClientHint> hints)
    {
        int session;
        using (var current = Process.GetCurrentProcess()) session = current.SessionId;
        foreach (var process in Process.GetProcessesByName("cloudmusic"))
        using (process)
        {
            try
            {
                if (process.SessionId != session) continue;
                using (var entry = new ManagementObject("root\\cimv2", "Win32_Process.Handle=\"" + process.Id + "\"", null))
                {
                    entry.Get();
                    if (Regex.IsMatch(entry["CommandLine"] as string ?? "", @"(?:^|\s)--type(?:=|\s)")) continue;
                    using (var owner = entry.InvokeMethod("GetOwnerSid", null, null))
                    using (var identity = WindowsIdentity.GetCurrent())
                        if (owner != null && Convert.ToUInt32(owner["ReturnValue"]) == 0 &&
                            string.Equals(owner["Sid"] as string, identity.User.Value, StringComparison.OrdinalIgnoreCase))
                            hints.Add(new ClientHint(entry["ExecutablePath"] as string, "正在运行的网易云"));
                }
            }
            catch (ManagementException) { }
            catch (UnauthorizedAccessException) { }
            catch (InvalidOperationException) { }
            catch (System.ComponentModel.Win32Exception) { }
            catch (System.Runtime.InteropServices.COMException) { }
        }
    }

    static void AddRegistryClients(List<ClientHint> hints)
    {
        foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using (var root = RegistryKey.OpenBaseKey(hive, view))
                {
                    string source = "注册表 " + hive + " / " + view;
                    ReadValues(root, @"Software\Microsoft\Windows\CurrentVersion\App Paths\cloudmusic.exe", new[] { "", "Path" }, source, hints);
                    ReadValues(root, @"Software\NetEase\CloudMusic", new[] { "install_dir", "InstallPath", "InstallLocation", "Path", "ExePath", "" }, source, hints);
                    ReadValues(root, @"Software\Classes\orpheus\shell\open\command", new[] { "" }, source, hints);
                    using (var uninstall = root.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
                    {
                        if (uninstall == null) continue;
                        foreach (string name in uninstall.GetSubKeyNames())
                        {
                            try
                            {
                                using (var key = uninstall.OpenSubKey(name))
                                {
                                    if (key == null) continue;
                                    string display = key.GetValue("DisplayName") as string ?? "";
                                    if (!Regex.IsMatch(name + " " + display, @"cloud\s?music|网易云音乐", RegexOptions.IgnoreCase)) continue;
                                    foreach (string field in new[] { "InstallLocation", "DisplayIcon" })
                                        hints.Add(new ClientHint(key.GetValue(field) as string, source + " / 卸载信息"));
                                    string command = PathFromCommand(key.GetValue("UninstallString") as string);
                                    if (System.IO.Path.IsPathRooted(command))
                                        hints.Add(new ClientHint(System.IO.Path.GetDirectoryName(command), source + " / 卸载信息"));
                                }
                            }
                            catch (SecurityException) { }
                            catch (UnauthorizedAccessException) { }
                            catch (IOException) { }
                            catch (ArgumentException) { }
                        }
                    }
                }
            }
            catch (SecurityException) { }
            catch (UnauthorizedAccessException) { }
            catch (IOException) { }
        }
    }

    static void ReadValues(RegistryKey root, string keyPath, string[] names, string source, List<ClientHint> hints)
    {
        try
        {
            using (var key = root.OpenSubKey(keyPath))
            {
                if (key == null) return;
                foreach (string name in names) hints.Add(new ClientHint(key.GetValue(name) as string, source));
            }
        }
        catch (SecurityException) { }
        catch (UnauthorizedAccessException) { }
        catch (IOException) { }
    }

    static void AddCommonLocations(List<ClientHint> hints)
    {
        foreach (string root in new[] {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs") })
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            foreach (string relative in new[] { @"NetEase\CloudMusic", "CloudMusic" })
                hints.Add(new ClientHint(System.IO.Path.Combine(root, relative), "常见安装目录"));
        }
        foreach (var drive in DriveInfo.GetDrives())
        {
            if (drive.DriveType != DriveType.Fixed) continue;
            foreach (string relative in new[] { @"Program Files\NetEase\CloudMusic", @"Program Files (x86)\NetEase\CloudMusic", @"NetEase\CloudMusic", "CloudMusic" })
                hints.Add(new ClientHint(System.IO.Path.Combine(drive.Name, relative), "本地磁盘常见安装目录"));
        }
    }
}
