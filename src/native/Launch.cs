using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// User-launched only. The UI is inserted into the local player's main renderer.
internal static class Launch
{
    const string MainPage = "orpheus://orpheus/pub/app.html";
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    // The embedded UI includes character thumbnails for offline PNG exports.
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
    static readonly string StatePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Pachi", "NcmImmersive", "session.txt");
    static readonly string ClientPathFile = Path.Combine(Path.GetDirectoryName(StatePath), "client-path.txt");

    [STAThread]
    static void Main(string[] args)
    {
        bool remove = args.Length == 1 && args[0] == "--detach";
        try
        {
            // Shared, non-launching discovery for the installer and diagnostics.
            if (args.Length >= 2 && (args[0] == "--detect-client" || args[0] == "--choose-client"))
            {
                ClientInstallation detected = args[0] == "--choose-client" ? ChooseClient() :
                    args.Length == 3 ? ClientDiscovery.FromPath(args[2], "手动指定") : ClientDiscovery.Discover(ClientPathFile);
                File.WriteAllText(args[1], Json.Serialize(new {
                    Found = detected != null,
                    Path = detected == null ? "" : detected.Path,
                    Version = detected == null ? "" : detected.Version,
                    Source = detected == null ? "" : detected.Source,
                    Message = detected == null ? "没有找到有效的 cloudmusic.exe。请运行 SelectClient.cmd 手动选择网易云桌面客户端。" : "检测成功；此结果不代表沉浸界面已连接。"
                }), new UTF8Encoding(false));
                Environment.ExitCode = detected == null ? 2 : 0;
                return;
            }
            if (args.Length == 1 && args[0] == "--select-client")
            {
                var selected = ChooseClient();
                if (selected == null) return;
                SaveClientPath(selected.Path);
                args = new string[0];
            }
            if (args.Length == 2 && args[0] == "--mini-host")
            {
                int port, pid;
                using (var player = RecordedPlayer(FindClientPath(false), out port))
                    if (player != null && int.TryParse(args[1], out pid) && player.Id == pid)
                        MiniSession.Run(player, port);
                return;
            }
            using (var gate = new Mutex(false, @"Local\Pachi.NcmImmersive.Launch"))
            {
                try { if (!gate.WaitOne(TimeSpan.FromSeconds(45))) return; }
                catch (AbandonedMutexException) { }
                try { Run(args, remove).GetAwaiter().GetResult(); }
                finally { gate.ReleaseMutex(); }
            }
        }
        catch (Exception ex)
        {
            Environment.ExitCode = 1;
            if (ex is OperationCanceledException || (args.Length > 0 &&
                (args[0] == "--detect-client" || args[0] == "--choose-client"))) return;
            if (args.Length > 0 && args[0] == "--attach")
            {
                Directory.CreateDirectory(Path.GetDirectoryName(StatePath));
                File.WriteAllText(Path.Combine(Path.GetDirectoryName(StatePath), "attach-error.txt"), ex.ToString());
            }
            else if (!remove && (args.Length == 0 || args[0] != "--mini-host")) MessageBox.Show(ex.Message, "网易云音乐", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    static async Task Run(string[] args, bool remove)
    {
        if (remove) await MiniSession.Stop();
        bool attach = args.Length == 3 && args[0] == "--attach";
        string clientPath = FindClientPath(!remove && !attach);
        int port = 0;
        Process player = null;
        try
        {
            if (attach)
            {
                int pid;
                if (!int.TryParse(args[1], out port) || !int.TryParse(args[2], out pid))
                    throw new InvalidOperationException("当前端口与网易云进程不匹配。请从快捷方式重新打开。");
                int actualPort;
                player = ReadPlayer(pid, clientPath, out actualPort);
                if (player == null || port < 1024 || port != actualPort)
                    throw new InvalidOperationException("当前端口与网易云进程不匹配。请从快捷方式重新打开。");
            }
            else
            {
                player = RecordedPlayer(clientPath, out port);
                // Recover an already debug-enabled session after an upgrade or a lost state file.
                // Only the current user's main process at the original executable path is eligible.
                if (player == null)
                {
                    var candidates = Process.GetProcessesByName("cloudmusic");
                    try
                    {
                        foreach (var candidate in candidates)
                        {
                            int actualPort;
                            Process found = ReadPlayer(candidate.Id, clientPath, out actualPort);
                            if (found == null) continue;
                            if (actualPort != 0) { player = found; port = actualPort; break; }
                            found.Dispose();
                            if (!remove)
                                throw new InvalidOperationException("网易云当前由原始入口启动。请从托盘菜单退出，再使用现有的沉浸听歌入口，新版会直接接管播放详情。");
                        }
                    }
                    finally { foreach (var candidate in candidates) candidate.Dispose(); }
                }
            }
            if (player == null)
            {
                if (remove) { ClearSession(); return; }
                var listener = new TcpListener(IPAddress.Loopback, 0);
                listener.Start();
                try { port = ((IPEndPoint)listener.LocalEndpoint).Port; }
                finally { listener.Stop(); }
                string forwarded = ForwardedArguments(args);
                player = StartClient(clientPath, "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" +
                    port + (forwarded.Length == 0 ? "" : " " + forwarded));
            }
            else if (!remove && !attach)
            {
                string forwarded = ForwardedArguments(args);
                // Preserve native shortcut arguments/deep links on a repeated launch as well.
                if (forwarded.Length != 0) using (var activation = StartClient(clientPath, forwarded)) { }
            }
            if (remove) DesktopCaptionForm.RecoverNativeSurface(player);

            if (!remove)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(StatePath));
                File.WriteAllLines(StatePath, new[] {player.Id.ToString(), port.ToString(), player.StartTime.ToUniversalTime().Ticks.ToString()});
            }
            var deadline = DateTime.UtcNow.AddSeconds(remove ? 4 : 45);
            var source = remove
                ? "(()=>{const s=window.__pachiImmersive;if(s)s.destroy();return 'removed';})()"
                : EmbeddedScript();
            while (DateTime.UtcNow < deadline)
            {
                if (player.HasExited) break;
                try
                {
                    Uri endpoint = await MainSocket(port);
                    if (endpoint != null)
                    {
                        string status = await Evaluate(endpoint, source);
                        if (status == "ready" || status == "removed")
                        {
                            if (remove) ClearSession();
                            else await MiniSession.Start(player.Id);
                            if (!remove && !attach)
                            {
                                player.Refresh();
                                IntPtr window = player.MainWindowHandle;
                                if (window != IntPtr.Zero)
                                {
                                    ShowWindowAsync(window, IsIconic(window) ? 9 : 5);
                                    SetForegroundWindow(window);
                                }
                            }
                            return;
                        }
                    }
                }
                catch (WebException) { }
                catch (WebSocketException) { }
                catch (OperationCanceledException) { }
                await Task.Delay(500);
            }
            if (!remove) throw new InvalidOperationException("已找到网易云，但未能连接沉浸界面。\n客户端：" + clientPath +
                "\n版本：" + FileVersionInfo.GetVersionInfo(clientPath).FileVersion +
                "\n请等待主页加载完成后重试。若仍失败，此客户端的调试接口或页面结构可能不受当前沉浸版本支持；自动检测成功不代表所有版本都兼容。");
            if (!player.HasExited) throw new InvalidOperationException("请从网易云托盘菜单退出，再重新运行卸载脚本。");
            ClearSession();
        }
        finally { if (player != null) player.Dispose(); }
    }

    static string FindClientPath(bool interactive)
    {
        var client = ClientDiscovery.Discover(ClientPathFile);
        if (client == null && interactive)
        {
            MessageBox.Show(ClientDiscovery.MissingMessage, "TouhouNCM · 自动检测", MessageBoxButtons.OK, MessageBoxIcon.Information);
            client = ChooseClient();
            if (client == null) throw new OperationCanceledException();
        }
        if (client == null) throw new FileNotFoundException("未找到有效的网易云桌面客户端。请运行 SelectClient.cmd，选择安装目录中的 cloudmusic.exe。");
        if (interactive) SaveClientPath(client.Path);
        return client.Path;
    }

    static ClientInstallation ChooseClient()
    {
        using (var dialog = new OpenFileDialog())
        {
            dialog.Title = "选择网易云桌面客户端 cloudmusic.exe";
            dialog.Filter = "网易云音乐 (cloudmusic.exe)|cloudmusic.exe";
            dialog.CheckFileExists = true;
            dialog.Multiselect = false;
            var current = ClientDiscovery.Discover(ClientPathFile);
            if (current != null) dialog.InitialDirectory = Path.GetDirectoryName(current.Path);
            while (dialog.ShowDialog() == DialogResult.OK)
            {
                var client = ClientDiscovery.FromPath(dialog.FileName, "手动选择");
                if (client != null) return client;
                MessageBox.Show("请选择网易云安装目录中有效的 cloudmusic.exe，不能选择安装包、卸载程序或本程序。", "TouhouNCM", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
        }
        return null;
    }

    static void SaveClientPath(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(ClientPathFile));
        File.WriteAllText(ClientPathFile, path, new UTF8Encoding(false));
    }

    static Process RecordedPlayer(string clientPath, out int port)
    {
        port = 0;
        if (!File.Exists(StatePath)) return null;
        Process candidate = null;
        try
        {
            string[] values = File.ReadAllLines(StatePath);
            int pid, savedPort, actualPort;
            long start;
            if (values.Length != 3 || !int.TryParse(values[0], out pid) || !int.TryParse(values[1], out savedPort) ||
                savedPort < 1024 || savedPort > 65535 || !long.TryParse(values[2], out start)) return null;
            candidate = ReadPlayer(pid, clientPath, out actualPort);
            if (candidate == null) return null;
            if (actualPort == savedPort && candidate.StartTime.ToUniversalTime().Ticks == start)
            { port = savedPort; var result = candidate; candidate = null; return result; }
        }
        catch (IOException) { }
        catch (ArgumentException) { }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
        finally { if (candidate != null) candidate.Dispose(); }
        return null;
    }

    static Process ReadPlayer(int pid, string clientPath, out int port)
    {
        port = 0;
        if (pid < 1) return null;
        // A projected WQL result has no instance path, so invoking GetOwnerSid on it fails.
        // Bind the keyed process instance before invoking its method instead.
        using (var entry = new ManagementObject("root\\cimv2", "Win32_Process.Handle=\"" + pid + "\"", null))
        {
            try { entry.Get(); }
            catch (ManagementException ex) { if (ex.ErrorCode == ManagementStatus.NotFound) return null; throw; }
            string command = entry["CommandLine"] as string ?? "";
            int sessionId;
            using (var current = Process.GetCurrentProcess()) sessionId = current.SessionId;
            if (!string.Equals(entry["ExecutablePath"] as string, clientPath, StringComparison.OrdinalIgnoreCase) ||
                Convert.ToInt32(entry["SessionId"]) != sessionId ||
                Regex.IsMatch(command, @"(?:^|\s)--type(?:=|\s)")) return null;
            using (var owner = entry.InvokeMethod("GetOwnerSid", null, null))
            using (var identity = WindowsIdentity.GetCurrent())
                if (owner == null || Convert.ToUInt32(owner["ReturnValue"]) != 0 ||
                    !string.Equals(owner["Sid"] as string, identity.User.Value, StringComparison.OrdinalIgnoreCase))
                    return null;
            var match = Regex.Match(command, @"(?:^|\s)--remote-debugging-port=(\d+)(?:\s|$)");
            int parsed;
            if (match.Success && int.TryParse(match.Groups[1].Value, out parsed) && parsed >= 1024 && parsed <= 65535) port = parsed;
            try { return Process.GetProcessById(pid); }
            catch (ArgumentException) { return null; }
        }
    }

    static Process StartClient(string clientPath, string arguments)
    {
        return Process.Start(new ProcessStartInfo(clientPath, arguments) {
            UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(clientPath)
        });
    }

    static string ForwardedArguments(string[] args)
    {
        var forwarded = new List<string>();
        for (int i = 0; i < args.Length; i++)
        {
            // The launcher owns its loopback debug endpoint; native arguments stay intact.
            if (args[i] == "--remote-debugging-port" || args[i] == "--remote-debugging-address") { i++; continue; }
            if (args[i].StartsWith("--remote-debugging-port=", StringComparison.Ordinal) ||
                args[i].StartsWith("--remote-debugging-address=", StringComparison.Ordinal)) continue;
            forwarded.Add(QuoteArgument(args[i]));
        }
        return string.Join(" ", forwarded);
    }

    static string QuoteArgument(string argument)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in argument)
        {
            if (ch == '\\') { slashes++; continue; }
            result.Append('\\', ch == '"' ? slashes * 2 + 1 : slashes);
            result.Append(ch);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        return result.Append('"').ToString();
    }

    static void ClearSession()
    {
        if (File.Exists(StatePath)) File.Delete(StatePath);
    }

    internal static async Task<Uri> MainSocket(int port)
    {
        var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/json/list");
        req.Proxy = null;
        req.AllowAutoRedirect = false;
        req.Timeout = 1800;
        using (var timeout = new CancellationTokenSource(1800))
        using (timeout.Token.Register(req.Abort))
        using (var response = await req.GetResponseAsync())
        using (var reader = new StreamReader(response.GetResponseStream()))
        {
            var pages = Json.Deserialize<List<Dictionary<string, object>>>(await reader.ReadToEndAsync());
            foreach (var page in pages)
            {
                if (!page.ContainsKey("webSocketDebuggerUrl") || !page.ContainsKey("url") || !page.ContainsKey("type") ||
                    (string)page["type"] != "page" || ((string)page["url"]).Split('#', '?')[0] != MainPage) continue;
                Uri ws;
                if (Uri.TryCreate((string)page["webSocketDebuggerUrl"], UriKind.Absolute, out ws) &&
                    ws.Scheme == "ws" && ws.Host == "127.0.0.1" && ws.Port == port &&
                    ws.AbsolutePath.StartsWith("/devtools/page/", StringComparison.Ordinal)) return ws;
            }
        }
        return null;
    }

    static async Task<string> Evaluate(Uri endpoint, string script)
    {
        using (var timeout = new CancellationTokenSource(6000))
        using (var socket = new ClientWebSocket())
        {
            socket.Options.Proxy = null;
            await socket.ConnectAsync(endpoint, timeout.Token);
            return await Evaluate(socket, script, 1, timeout.Token);
        }
    }

    internal static async Task<string> Evaluate(ClientWebSocket socket, string script, int id, CancellationToken token)
    {
            var request = new {id, method = "Runtime.evaluate", @params = new {expression = script, returnByValue = true, awaitPromise = true}};
            await socket.SendAsync(new ArraySegment<byte>(Encoding.UTF8.GetBytes(Json.Serialize(request))), WebSocketMessageType.Text, true, token);
            var buffer = new byte[8192];
            while (socket.State == WebSocketState.Open)
            {
                using (var output = new MemoryStream())
                {
                    WebSocketReceiveResult part;
                    do {
                        part = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                        if (part.MessageType == WebSocketMessageType.Close) return null;
                        output.Write(buffer, 0, part.Count);
                    } while (!part.EndOfMessage);
                    dynamic msg = Json.DeserializeObject(Encoding.UTF8.GetString(output.ToArray()));
                    if (!msg.ContainsKey("id") || msg["id"] != id) continue;
                    if (msg.ContainsKey("error") || msg["result"].ContainsKey("exceptionDetails"))
                        throw new InvalidOperationException("沉浸听歌界面加载失败。请用原入口继续听歌。");
                    return msg["result"]["result"].ContainsKey("value") ? msg["result"]["result"]["value"] as string : null;
                }
            }
            return null;
    }

    static string EmbeddedScript()
    {
        using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("client.js"), Encoding.UTF8))
            return reader.ReadToEnd();
    }
}
