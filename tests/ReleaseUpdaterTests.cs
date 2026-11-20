using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

[assembly: AssemblyProduct("TouhouNCM")]
[assembly: AssemblyFileVersion("2.0.1.0")]

static class ReleaseUpdaterTests
{
    sealed class GitHub : HttpMessageHandler
    {
        internal byte[] installer = File.ReadAllBytes(Assembly.GetExecutingAssembly().Location);
        internal string tag = "v2.0.1", location = "https://release-assets.githubusercontent.com/test";
        internal int lengthAdjustment, downloads;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            string name = "TouhouNCM-" + tag.Substring(1) + "-Setup-x64.exe";
            string root = "https://github.com/pacholigoooo/TouhouNCM/releases/";
            string download = root + "download/" + tag + "/" + name;
            var response = new HttpResponseMessage(HttpStatusCode.OK);
            if (request.RequestUri.AbsoluteUri == ReleaseUpdater.Latest)
                response.Content = new StringContent(new JavaScriptSerializer().Serialize(new { tag_name = tag, html_url = root + "tag/" + tag,
                    assets = new[] { new { name, state = "uploaded", size = installer.Length + lengthAdjustment, browser_download_url = download } } }));
            else if (request.RequestUri.AbsoluteUri == download)
            {
                downloads++;
                response.StatusCode = HttpStatusCode.Redirect;
                response.Headers.Location = new Uri(location);
            }
            else if (request.RequestUri.Host == "release-assets.githubusercontent.com")
                response.Content = new ByteArrayContent(installer);
            else throw new Exception("Unexpected network address " + request.RequestUri);
            return Task.FromResult(response);
        }
    }

    static void Require(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    static async Task Run(string dir)
    {
        string cache = Path.Combine(dir, "updates");
        var github = new GitHub();
        using (var http = new HttpClient(github))
        {
            var old = new Version(2, 0, 0);
            Require(await ReleaseUpdater.Stage(http, new Version(2, 0, 1), cache, CancellationToken.None) == null && github.downloads == 0,
                "Same version should skip the asset.");
            using (var ready = await ReleaseUpdater.Stage(http, old, cache, CancellationToken.None))
            {
                string file = Directory.GetFiles(cache).Single();
                try { using (File.OpenWrite(file)) { } throw new Exception("Staged installer was writable."); }
                catch (IOException) { }
            }
            Require(Directory.GetFiles(cache).Length == 0, "A cancelled install should release the file.");
            foreach (string failure in new[] { "wrong host", "wrong size", "wrong product version" })
            {
                github.location = failure == "wrong host" ? "https://example.test/installer" : "https://release-assets.githubusercontent.com/test";
                github.lengthAdjustment = failure == "wrong size" ? 1 : 0;
                github.tag = failure == "wrong product version" ? "v2.0.2" : "v2.0.1";
                try { using (await ReleaseUpdater.Stage(http, old, cache, CancellationToken.None)) { } throw new Exception("Accepted " + failure); }
                catch (InvalidDataException) { }
                Require(Directory.GetFiles(cache).Length == 0, "Incomplete installer was left in the cache.");
            }
            github.tag = "v2.0.1";
            using (var ready = await ReleaseUpdater.Stage(http, old, cache, CancellationToken.None))
                ready.Install(dir);
            string marker = Path.Combine(dir, "installed.txt");
            Require(SpinWait.SpinUntil(() => File.Exists(marker), 8000), "Setup did not start.");
            string[] args = File.ReadAllLines(marker);
            Require(args.Contains("/VERYSILENT") && args.Contains("/NORESTART") && args.Contains("/NOCLOSEAPPLICATIONS") &&
                args.Contains("/TOUHOUNCMAUTO=1"), "Unexpected setup arguments.");
        }
        Console.WriteLine("PASS official release selection, protected download, cancellation and silent installer handoff");
    }

    static void Main(string[] args)
    {
        if (args.Contains("/VERYSILENT"))
        {
            string dir = args.Single(arg => arg.StartsWith("/DIR=")).Substring(5);
            string temp = Path.Combine(dir, "marker.tmp");
            File.WriteAllLines(temp, args);
            File.Move(temp, Path.Combine(dir, "installed.txt"));
        }
        else
        {
            try { Run(args[0]).GetAwaiter().GetResult(); }
            catch (Exception error)
            {
                for (var cause = error; cause != null; cause = cause.InnerException)
                    Console.Error.WriteLine(cause.GetType().Name + ": " + cause.Message);
                Environment.ExitCode = 1;
            }
        }
    }
}
