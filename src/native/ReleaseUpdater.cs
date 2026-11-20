using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

// Only the native host chooses an installer. The renderer can request a download or cancel it.
internal sealed class ReleaseUpdater : IDisposable
{
    const string Repository = "pacholigoooo/TouhouNCM";
    internal const string Latest = "https://api.github.com/repos/" + Repository + "/releases/latest";
    const string Releases = "https://github.com/" + Repository + "/releases/";
    const long MaxInstallerBytes = 256 * 1024 * 1024;
    static readonly Regex Tag = new Regex(@"^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\z");

    readonly string installDir, cache;
    readonly Version installed;
    CancellationTokenSource active;
    Prepared ready;
    bool retry, disposed;
    string phase, latest = "";
    internal event Action Changed;

    internal ReleaseUpdater()
    {
        installDir = Path.GetDirectoryName(Application.ExecutablePath);
        cache = Path.Combine(installDir, "updates");
        Version version = Assembly.GetExecutingAssembly().GetName().Version;
        installed = new Version(version.Major, version.Minor, version.Build);
        phase = IsInstalled(installDir) ? "idle" : "portable";
    }

    static bool IsInstalled(string directory)
    {
        string standard = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pachi", "NcmImmersive");
        if (String.Equals(directory, standard, StringComparison.OrdinalIgnoreCase)) return true;
        try
        {
            using (var user = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64))
            using (var key = user.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\{A43B9781-56A8-4F5F-9277-B072764C99A8}_is1"))
            {
                string location = key == null ? null : key.GetValue("InstallLocation") as string;
                return !String.IsNullOrEmpty(location) && String.Equals(directory, location.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
            }
        }
        catch (System.Security.SecurityException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (IOException) { return false; }
    }

    internal object Snapshot { get { return new { phase, latest }; } }

    internal void Command(string command)
    {
        if (disposed || phase == "portable") return;
        if (command == "cancel")
        {
            retry = false;
            Discard();
            if (active != null) active.Cancel();
            SetState("idle", "");
        }
        else if (command == "download")
        {
            if (active == null) Prepare();
            else if (active.IsCancellationRequested) retry = true;
        }
    }

    async void Prepare()
    {
        var operation = new CancellationTokenSource();
        active = operation;
        Discard();
        SetState("downloading", "");
        try
        {
            var result = await Task.Run(async delegate {
                using (var http = OpenGitHub(installed))
                using (var limit = CancellationTokenSource.CreateLinkedTokenSource(operation.Token))
                {
                    limit.CancelAfter(TimeSpan.FromMinutes(6));
                    return await Stage(http, installed, cache, limit.Token).ConfigureAwait(false);
                }
            });
            if (!disposed && !operation.IsCancellationRequested)
            {
                ready = result;
                SetState(result == null ? "current" : "ready", result == null ? "" : result.Tag);
            }
            else if (result != null) result.Dispose();
        }
        catch (Exception error)
        {
            if (!disposed && !operation.IsCancellationRequested)
            {
                Debug.WriteLine(error);
                SetState("error", "");
            }
        }
        finally
        {
            active = null;
            operation.Dispose();
            if (retry && !disposed) { retry = false; Prepare(); }
        }
    }

    void SetState(string value, string tag)
    {
        phase = value;
        latest = tag;
        if (Changed != null) Changed();
    }

    internal static HttpClient OpenGitHub(Version version)
    {
        var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false,
            SslProtocols = System.Security.Authentication.SslProtocols.Tls12 };
        var http = new HttpClient(handler) { MaxResponseContentBufferSize = 512 * 1024 };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("TouhouNCM/" + version);
        return http;
    }

    internal sealed class Asset
    {
        public string name { get; set; }
        public string state { get; set; }
        public string browser_download_url { get; set; }
        public long size { get; set; }
    }

    sealed class Release
    {
        public string tag_name { get; set; }
        public string html_url { get; set; }
        public bool draft { get; set; }
        public bool prerelease { get; set; }
        public Asset[] assets { get; set; }
    }

    internal static async Task<Prepared> Stage(HttpClient http, Version current, string directory, CancellationToken token)
    {
        Release release;
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(token))
        {
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            using (var response = await http.GetAsync(Latest, timeout.Token).ConfigureAwait(false))
            {
                response.EnsureSuccessStatusCode();
                release = new JavaScriptSerializer().Deserialize<Release>(await response.Content.ReadAsStringAsync().ConfigureAwait(false));
            }
        }
        Version next;
        if (release == null || release.draft || release.prerelease || !Tag.IsMatch(release.tag_name ?? "") ||
            !Version.TryParse(release.tag_name.Substring(1), out next) || release.html_url != Releases + "tag/" + release.tag_name)
            throw new InvalidDataException("无效的正式版本信息。");
        if (next <= current) return null;
        string name = "TouhouNCM-" + next + "-Setup-x64.exe";
        var asset = Array.Find(release.assets ?? new Asset[0], item => item != null && item.name == name);
        if (asset == null || asset.state != "uploaded" || asset.size <= 0 || asset.size > MaxInstallerBytes ||
            asset.browser_download_url != Releases + "download/" + release.tag_name + "/" + name)
            throw new InvalidDataException("发布版本缺少 Windows 安装包。");
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, "setup-" + Guid.NewGuid().ToString("N") + ".exe");
        try
        {
            using (var response = await OpenAsset(http, new Uri(asset.browser_download_url), token).ConfigureAwait(false))
            using (token.Register(response.Dispose))
            using (var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
            using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                long? length = response.Content.Headers.ContentLength;
                if (length.HasValue && length != asset.size) throw new InvalidDataException("安装包长度不符。");
                var buffer = new byte[65536];
                int count;
                while ((count = await input.ReadAsync(buffer, 0, buffer.Length, token).ConfigureAwait(false)) > 0)
                {
                    if (output.Position + count > asset.size) throw new InvalidDataException("安装包超出发布大小。");
                    output.Write(buffer, 0, count);
                }
                if (output.Position != asset.size) throw new InvalidDataException("安装包下载不完整。");
            }
            token.ThrowIfCancellationRequested();
            return new Prepared(path, release.tag_name, next, asset.size);
        }
        catch { DeleteFile(path); throw; }
    }

    static async Task<HttpResponseMessage> OpenAsset(HttpClient http, Uri uri, CancellationToken token)
    {
        for (int hop = 0; hop < 5; hop++)
        {
            var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
            if (response.StatusCode == HttpStatusCode.OK) return response;
            using (response)
            {
                int code = (int)response.StatusCode;
                Uri location = response.Headers.Location;
                if (code < 300 || code > 399 || location == null) throw new HttpRequestException("GitHub 安装包下载失败。");
                uri = new Uri(uri, location);
                if (uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length != 0 ||
                    (uri.Host != "release-assets.githubusercontent.com" && uri.Host != "objects.githubusercontent.com" &&
                     uri.Host != "github-releases.githubusercontent.com"))
                    throw new InvalidDataException("安装包跳转到了未知来源。");
            }
        }
        throw new HttpRequestException("安装包重定向次数过多。");
    }

    internal sealed class Prepared : IDisposable
    {
        internal readonly string Tag;
        readonly FileStream held;
        bool started;

        internal Prepared(string path, string tag, Version expected, long size)
        {
            Tag = tag;
            held = File.OpenRead(path);
            try
            {
                var info = FileVersionInfo.GetVersionInfo(path);
                if (held.Length != size || (info.ProductName ?? "").Trim() != "TouhouNCM" ||
                    new Version(info.FileMajorPart, info.FileMinorPart, info.FileBuildPart) != expected)
                    throw new InvalidDataException("安装包的产品名或版本与发布信息不符。");
            }
            catch { held.Dispose(); throw; }
        }

        internal void Install(string directory)
        {
            string log = Path.Combine(Path.GetDirectoryName(held.Name), "last-install.log");
            string args = "/VERYSILENT /SUPPRESSMSGBOXES /SP- /NORESTART /NOCLOSEAPPLICATIONS /NORESTARTAPPLICATIONS /TOUHOUNCMAUTO=1 /LOG=\"" + log + "\" /DIR=\"" + directory + "\"";
            using (Process.Start(new ProcessStartInfo(held.Name, args) { UseShellExecute = false, CreateNoWindow = true }))
                started = true;
        }

        public void Dispose()
        {
            string path = held.Name;
            held.Dispose();
            if (!started) DeleteFile(path);
        }
    }

    internal void InstallOnExit()
    {
        if (ready == null) return;
        try { ready.Install(installDir); }
        catch (Exception error) { Debug.WriteLine(error); }
    }

    internal void CleanOldFiles()
    {
        if (phase == "portable" || !Directory.Exists(cache)) return;
        try
        {
            foreach (string file in Directory.EnumerateFiles(cache, "setup-*.exe")) DeleteFile(file);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    static void DeleteFile(string path)
    {
        try { File.Delete(path); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    void Discard()
    {
        if (ready != null) { ready.Dispose(); ready = null; }
    }

    public void Dispose()
    {
        disposed = true;
        if (active != null) active.Cancel();
        Discard();
    }
}
