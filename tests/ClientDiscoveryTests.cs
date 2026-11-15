using System;
using System.IO;

internal static class ClientDiscoveryTests
{
    static int assertions;
    static void Check(bool value, string message)
    {
        if (!value) throw new Exception(message);
        assertions++;
        Console.WriteLine("PASS " + message);
    }

    static void Main(string[] args)
    {
        // All fixtures are local to the supplied temporary directory; no registry
        // writes, installed-client launches, or changes to user settings.
        string root = Path.GetFullPath(args[0]);
        string validDir = Path.Combine(root, "网易云 custom path");
        Directory.CreateDirectory(validDir);
        string exe = Path.Combine(validDir, "cloudmusic.exe");
        File.Copy(typeof(ClientDiscoveryTests).Assembly.Location, exe);
        string missing = Path.Combine(root, "old location", "cloudmusic.exe");
        Check(ClientDiscovery.PathFromCommand("\"" + exe + "\" --single-instance") == exe, "quoted registry command with spaces");
        Check(ClientDiscovery.PathFromCommand(exe + ",0") == exe, "unquoted DisplayIcon suffix");
        Check(ClientDiscovery.PathFromCommand("\"" + exe + "\",-1") == exe, "quoted DisplayIcon suffix");
        Check(ClientDiscovery.PathFromCommand(exe + " --single-instance") == exe, "unquoted registry command with spaces");
        Environment.SetEnvironmentVariable("TOUHOU_NCM_TEST_ROOT", validDir);
        Check(ClientDiscovery.PathFromCommand(@"%TOUHOU_NCM_TEST_ROOT%\cloudmusic.exe") == exe, "environment-expanded registry path");
        Check(ClientDiscovery.FromPath(exe, "test").Path == exe, "custom Unicode executable path");
        Check(ClientDiscovery.FromPath(validDir, "test").Path == exe, "install directory resolves executable");
        Check(ClientDiscovery.FromPath(missing, "test") == null, "stale path rejected");
        Check(ClientDiscovery.FromPath("cloudmusic.exe", "test") == null, "relative path rejected");
        Check(ClientDiscovery.FromPath(Path.Combine(validDir, "other.exe"), "test") == null, "wrong executable rejected");
        Check(ClientDiscovery.FromPath("C:\\bad\0path\\cloudmusic.exe", "test") == null, "malformed hint ignored");
        string textDir = Path.Combine(root, "invalid");
        Directory.CreateDirectory(textDir);
        string invalid = Path.Combine(textDir, "cloudmusic.exe");
        File.WriteAllText(invalid, "not a Windows executable");
        Check(ClientDiscovery.FromPath(invalid, "test") == null, "renamed text file rejected");
        File.WriteAllBytes(invalid, new byte[64]);
        Check(ClientDiscovery.FromPath(invalid, "test") == null, "invalid PE header rejected");
        var recovered = ClientDiscovery.FirstValid(new[] {
            new ClientHint(missing, "stale cache"), new ClientHint(invalid, "bad hint"),
            new ClientHint("\"" + exe + "\",0", "registry fixture") });
        Check(recovered != null && recovered.Path == exe && recovered.Source == "registry fixture", "invalid candidates fall through to usable registry hint");
        Check(ClientDiscovery.FirstValid(new[] { new ClientHint(null, "empty"), new ClientHint(missing, "missing") }) == null, "no installed client returns no result");
        string cache = Path.Combine(root, "client-path.txt");
        File.WriteAllText(cache, exe);
        Check(ClientDiscovery.Discover(cache).Path == exe, "saved manual choice takes priority");
        Check(File.ReadAllText(cache) == exe, "discovery leaves saved choice unchanged");
        Console.WriteLine(assertions + " discovery checks passed.");
    }
}
