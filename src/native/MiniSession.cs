using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Native HWNDs decide when each surface appears. Keep audio and playback
// controls in NetEase; both owned windows share one renderer connection.
internal sealed class MiniSession : ApplicationContext
{
    const string StopEvent = @"Local\Pachi.NcmImmersive.Mini.Stop";
    const string HostGate = @"Local\Pachi.NcmImmersive.Mini.Host";
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string type, string title);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    readonly Process player;
    readonly int port;
    readonly EventWaitHandle stop;
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly SemaphoreSlim exchange = new SemaphoreSlim(1, 1);
    readonly string exportSession = Guid.NewGuid().ToString("N");
    IntPtr parent;
    MiniPlayerForm form;
    DesktopCaptionForm captionForm;
    DesktopCaptionState captionState;
    ClientWebSocket socket;
    string artworkKey = "";
    Bitmap artwork;
    int sequence;
    bool ticking, ended, exporting;

    internal static async Task Start(int pid)
    {
        bool stopping = false;
        try
        {
            using (var signal = EventWaitHandle.OpenExisting(StopEvent))
            {
                stopping = signal.WaitOne(0);
                if (!stopping)
                {
                    try { using (EventWaitHandle.OpenExisting(HostGate + "." + pid)) return; }
                    catch (WaitHandleCannotBeOpenedException) { signal.Set(); stopping = true; }
                }
            }
        }
        catch (WaitHandleCannotBeOpenedException) { }
        if (stopping) await WaitForHostExit();
        using (var process = Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--mini-host " + pid) {
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
        }))
        {
            var deadline = DateTime.UtcNow.AddSeconds(6);
            while (DateTime.UtcNow < deadline)
            {
                if (process == null || process.HasExited)
                    throw new InvalidOperationException("桌面歌词与迷你播放器未能启动，请重新打开沉浸听歌入口。");
                try
                {
                    using (var signal = EventWaitHandle.OpenExisting(StopEvent))
                    using (EventWaitHandle.OpenExisting(HostGate + "." + pid))
                        if (!signal.WaitOne(0)) return;
                }
                catch (WaitHandleCannotBeOpenedException) { }
                await Task.Delay(50);
            }
            throw new InvalidOperationException("等待桌面歌词与迷你播放器启动超时，请重新打开沉浸听歌入口。");
        }
    }

    internal static async Task Stop()
    {
        var deadline = DateTime.UtcNow.AddSeconds(6);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                using (var signal = EventWaitHandle.OpenExisting(StopEvent)) signal.Set();
                await WaitForHostExit();
                return;
            }
            catch (WaitHandleCannotBeOpenedException)
            {
                using (var gate = new Mutex(false, HostGate))
                    if (TryAcquire(gate, TimeSpan.Zero)) { gate.ReleaseMutex(); return; }
            }
            await Task.Delay(50);
        }
        throw new InvalidOperationException("桌面歌词与迷你播放器尚未退出，请稍后重试。");
    }

    static bool TryAcquire(Mutex gate, TimeSpan timeout)
    {
        try { return gate.WaitOne(timeout); }
        catch (AbandonedMutexException) { return true; }
    }

    static Task WaitForHostExit()
    {
        return Task.Run(delegate {
            using (var gate = new Mutex(false, HostGate))
            {
                if (!TryAcquire(gate, TimeSpan.FromSeconds(6)))
                    throw new InvalidOperationException("桌面歌词与迷你播放器尚未退出，请稍后重试。");
                try
                {
                    // Older helpers did not own HostGate. Wait for their stop
                    // event to disappear as well before replacing the process.
                    var deadline = DateTime.UtcNow.AddSeconds(6);
                    while (DateTime.UtcNow < deadline)
                    {
                        try { using (EventWaitHandle.OpenExisting(StopEvent)) { } }
                        catch (WaitHandleCannotBeOpenedException) { return; }
                        Thread.Sleep(50);
                    }
                    throw new InvalidOperationException("桌面歌词与迷你播放器尚未退出，请稍后重试。");
                }
                finally { gate.ReleaseMutex(); }
            }
        });
    }

    internal static void Run(Process player, int port)
    {
        using (var gate = new Mutex(false, HostGate))
        {
            if (!TryAcquire(gate, TimeSpan.Zero)) return;
            try
            {
                try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
                catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
                Application.EnableVisualStyles();
                DesktopCaptionForm.RecoverNativeSurface(player);
                using (var signal = new EventWaitHandle(false, EventResetMode.ManualReset, StopEvent))
                using (var ready = new EventWaitHandle(false, EventResetMode.ManualReset, HostGate + "." + player.Id))
                {
                    signal.Reset();
                    using (var session = new MiniSession(player, port, signal)) Application.Run(session);
                }
            }
            finally { gate.ReleaseMutex(); }
        }
    }

    MiniSession(Process player, int port, EventWaitHandle stop)
    {
        this.player = player;
        this.port = port;
        this.stop = stop;
        timer.Interval = 350;
        timer.Tick += Tick;
        timer.Start();
    }

    IntPtr VisibleWindow(string windowClass)
    {
        IntPtr h = IntPtr.Zero;
        while ((h = FindWindowEx(IntPtr.Zero, h, windowClass, null)) != IntPtr.Zero)
        {
            int pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid == player.Id && IsWindowVisible(h)) return h;
        }
        return IntPtr.Zero;
    }

    async void Tick(object sender, EventArgs e)
    {
        if (ended) return;
        if (player.HasExited || stop.WaitOne(0))
        {
            ended = true;
            timer.Stop();
            ReleaseSurfaces();
            ExitThread();
            return;
        }
        if (ticking) return;
        ticking = true;
        try
        {
            IntPtr miniWindow = VisibleWindow("MiniPlayer");
            IntPtr lyricWindow = VisibleWindow("DesktopLyrics");
            if (miniWindow == IntPtr.Zero) ResetMini();
            if (lyricWindow == IntPtr.Zero) SuspendCaption();
            if (miniWindow == IntPtr.Zero && lyricWindow == IntPtr.Zero)
            {
                timer.Interval = 700;
            }
            // Read only the visible surfaces. Keep failures separate so a bad
            // artwork or caption does not take the other surface down.
            string expression = "(()=>{const a=window.__pachiImmersive;" +
                "a?.characterExportReady?.(" + json.Serialize(exportSession) + ");" +
                "const read=(name,key)=>{try{const value=a?.[name]?.(key);return {value,sampledAt:Date.now()}}catch(e){return {error:String(e)}}};" +
                "return JSON.stringify({mini:" + (miniWindow == IntPtr.Zero ? "null" :
                    "read('miniSnapshot'," + json.Serialize(artworkKey) + ")") +
                ",caption:" + (lyricWindow == IntPtr.Zero ? "null" :
                "read('desktopCaption'," + json.Serialize(captionState == null ? "" : captionState.key) + ")") +
                ",pngExport:" + (exporting ? "null" : "a?.characterExportTake?.()||null") + "});})()";
            string snapshot = await Query(expression);
            if (ended) return;
            if (snapshot == null)
            {
                ResetMini();
                WaitForCaption(VisibleWindow("DesktopLyrics"));
                timer.Interval = 1000;
                return;
            }

            var data = json.Deserialize<SurfaceSnapshots>(snapshot);
            if (data.pngExport != null && !exporting) HandleCharacterRequest(data.pngExport);
            bool miniPlaying = false, captionPlaying = false;
            if (miniWindow != IntPtr.Zero)
            {
                try
                {
                    if (miniWindow != VisibleWindow("MiniPlayer")) ResetMini();
                    else miniPlaying = PresentMini(miniWindow, data.mini);
                }
                catch (Exception ex) { Debug.WriteLine(ex); ResetMini(); }
            }
            if (lyricWindow != IntPtr.Zero)
            {
                try
                {
                    if (lyricWindow != VisibleWindow("DesktopLyrics")) SuspendCaption();
                    else captionPlaying = PresentCaption(lyricWindow, data.caption);
                }
                catch (Exception ex) { Debug.WriteLine(ex); WaitForCaption(lyricWindow); }
            }
            // A paused caption still needs to notice resume and track changes
            // promptly; the slow idle poll is only for inactive surfaces.
            timer.Interval = captionPlaying ? 90 : miniPlaying || captionState != null ? 300 : 700;
        }
        catch (Exception ex)
        {
            if (ended) return;
            Debug.WriteLine(ex);
            ResetMini();
            WaitForCaption(VisibleWindow("DesktopLyrics"));
            timer.Interval = 1000;
        }
        finally { ticking = false; }
    }

    bool PresentMini(IntPtr window, SurfaceSnapshot snapshot)
    {
        if (snapshot != null && !String.IsNullOrEmpty(snapshot.error))
            throw new InvalidOperationException(snapshot.error);
        if (snapshot == null || snapshot.value == null) { ResetMini(); return false; }
        var data = json.Deserialize<MiniTrack>(snapshot.value);
        Bitmap previousArtwork = null;
        if (data.artworkKey != artworkKey)
        {
            Bitmap next = null;
            if (!String.IsNullOrEmpty(data.artwork))
                using (var stream = new MemoryStream(Convert.FromBase64String(data.artwork)))
                using (var image = Image.FromStream(stream)) next = new Bitmap(image);
            previousArtwork = artwork;
            artwork = next;
            artworkKey = data.artworkKey;
        }
        try
        {
            if (form == null || form.IsDisposed)
            {
                form = new MiniPlayerForm(SendCommand);
                parent = IntPtr.Zero;
            }
            form.UpdatePalette(data.palette);
            form.UpdateTrack(data.title, data.artist, artwork, data.position, data.duration, data.playing);
        }
        finally { if (previousArtwork != null) previousArtwork.Dispose(); }
        if (parent != window)
        {
            if (!form.Attach(window)) { ResetMini(); return false; }
            parent = window;
        }
        else form.SyncBounds();
        return data.playing;
    }

    bool PresentCaption(IntPtr window, SurfaceSnapshot snapshot)
    {
        if (snapshot != null && !String.IsNullOrEmpty(snapshot.error))
        {
            Debug.WriteLine(snapshot.error);
            return WaitForCaption(window);
        }
        if (snapshot == null || snapshot.value == null) return WaitForCaption(window);
        if (snapshot.value == "null") { ResetCaption(); return false; }
        var data = json.Deserialize<DesktopCaptionState>(snapshot.value);
        if (data != null && data.status == "transient")
            return WaitForCaption(window, data.identity);
        if (data == null || String.IsNullOrEmpty(data.key)) return WaitForCaption(window);
        // The renderer clock was sampled before CDP transfer and artwork decode.
        // Consume that delay from the same interpolation budget instead of adding lyric lag.
        double elapsed = Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - snapshot.sampledAt);
        if (data.playing) data.positionMs += Math.Min(elapsed, Math.Max(0, data.interpolationMs)) * data.rate;
        data.interpolationMs = Math.Max(0, data.interpolationMs - elapsed);
        if (captionState == null || data.key != captionState.key) captionState = data;
        else
        {
            captionState.positionMs = data.positionMs;
            captionState.playing = data.playing;
            captionState.interpolationMs = data.interpolationMs;
            captionState.rate = data.rate;
        }
        if (captionForm == null || captionForm.IsDisposed) captionForm = new DesktopCaptionForm(SendCaptionCommand);
        return captionForm.Present(window, captionState) && captionState.playing;
    }

    bool WaitForCaption(IntPtr window, string identity = null)
    {
        if (window == IntPtr.Zero) { SuspendCaption(); return false; }
        if (captionForm == null || captionForm.IsDisposed) return false;
        try { return captionForm.WaitForSnapshot(window, identity); }
        catch (Exception ex) { Debug.WriteLine(ex); ResetCaption(); return false; }
    }

    async void SendCaptionCommand(string command)
    {
        try
        {
            await Query("Promise.resolve(window.__pachiImmersive?.desktopAction(" + json.Serialize(command) + ")).then(String)");
            if (!ended) Tick(null, EventArgs.Empty);
        }
        catch (Exception ex) { if (!ended) Debug.WriteLine(ex); }
    }

    async void HandleCharacterRequest(PngExportRequest request)
    {
        exporting = true;
        object result;
        try
        {
            if (request.id == null || !request.id.StartsWith(exportSession + ":", StringComparison.Ordinal))
                throw new InvalidOperationException("结果图片请求无效，请重新生成。");
            result = request.kind == "portrait" ? ReadCharacterArt(request.resource) : await SaveCharacterPng(request);
        }
        catch (Exception error) { result = new { ok = false, error = error.Message }; }
        try
        {
            if (!ended) await Query("String(window.__pachiImmersive?.characterExportFinish?.(" +
                json.Serialize(request.id) + "," + json.Serialize(result) + "))");
        }
        catch (Exception error) { Debug.WriteLine(error); }
        finally { exporting = false; }
    }

    static object ReadCharacterArt(string resource)
    {
        if (resource == null || !resource.StartsWith("character-art.", StringComparison.Ordinal))
            throw new InvalidOperationException("角色图片资源无效。");
        string extension = Path.GetExtension(resource);
        string mime = extension == ".webp" ? "image/webp" : extension == ".png" ? "image/png" :
            extension == ".jpg" || extension == ".jpeg" ? "image/jpeg" : null;
        if (mime == null) throw new InvalidOperationException("角色图片格式无效。");
        using (var stream = typeof(MiniSession).Assembly.GetManifestResourceStream(resource))
        {
            if (stream == null) throw new InvalidOperationException("未找到角色图片，请更新 TouhouNCM。");
            using (var reader = new BinaryReader(stream))
                return new { dataUrl = "data:" + mime + ";base64," + Convert.ToBase64String(reader.ReadBytes(checked((int)stream.Length))) };
        }
    }

    async Task<byte[]> ReadResultPng(PngExportRequest request)
    {
        if (request.length <= 0 || request.length > 8 * 1024 * 1024 || request.length % 4 != 0)
            throw new InvalidOperationException("结果图片请求无效，请重新生成。");
        var encoded = new StringBuilder(request.length);
        while (encoded.Length < request.length)
        {
            string chunk = await Query("window.__pachiImmersive?.characterExportChunk?.(" +
                json.Serialize(request.id) + "," + encoded.Length + ")");
            if (ended) throw new OperationCanceledException();
            if (String.IsNullOrEmpty(chunk) || chunk.Length > 65536 || encoded.Length + chunk.Length > request.length)
                throw new InvalidOperationException("结果图片已失效，请重新导出。");
            encoded.Append(chunk);
        }
        return Convert.FromBase64String(encoded.ToString());
    }

    async Task<object> SaveCharacterPng(PngExportRequest request)
    {
        byte[] bytes = await ReadResultPng(request);
        ValidateResultPng(bytes);
        // The dialog runs on its own STA thread; caption polling stays active.
        string path = await ChoosePngPath(SafePngName(request.fileName));
        if (ended) throw new OperationCanceledException();
        if (path == null) return new { ok = false, canceled = true };
        await Task.Run(delegate { WriteResultPng(bytes, path); });
        return new { ok = true };
    }

    Task<string> ChoosePngPath(string name)
    {
        var completion = new TaskCompletionSource<string>();
        var owner = player.MainWindowHandle;
        var thread = new Thread(delegate() {
            try
            {
                using (var dialog = new SaveFileDialog())
                {
                    dialog.Title = "保存 TouhouNCM 角色测试图片";
                    dialog.Filter = "PNG 图片 (*.png)|*.png";
                    dialog.DefaultExt = "png";
                    dialog.AddExtension = true;
                    dialog.CheckPathExists = true;
                    dialog.OverwritePrompt = true;
                    dialog.FileName = name;
                    completion.SetResult(dialog.ShowDialog(new ExportOwner(owner)) == DialogResult.OK ? dialog.FileName : null);
                }
            }
            catch (Exception error) { completion.SetException(error); }
        });
        thread.IsBackground = true;
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task;
    }

    static string SafePngName(string name)
    {
        var result = new StringBuilder();
        foreach (char value in name ?? "")
            if (!Char.IsControl(value) && Array.IndexOf(Path.GetInvalidFileNameChars(), value) < 0) result.Append(value);
        string file = result.ToString().Trim(' ', '.');
        if (file.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) file = file.Substring(0, file.Length - 4);
        if (file.Length > 90) file = file.Substring(0, 90);
        return (file.StartsWith("TouhouNCM-", StringComparison.OrdinalIgnoreCase) ? file : "TouhouNCM-" + file) + ".png";
    }

    static void ValidateResultPng(byte[] bytes)
    {
        byte[] signature = { 137, 80, 78, 71, 13, 10, 26, 10 };
        if (bytes == null || bytes.Length < 33 || bytes.Length > 6 * 1024 * 1024)
            throw new InvalidOperationException("结果图片大小无效。");
        for (int index = 0; index < signature.Length; index++)
            if (bytes[index] != signature[index]) throw new InvalidOperationException("只能保存 PNG 结果图片。");
        long width = 0, height = 0;
        for (int index = 16; index < 20; index++) width = width * 256 + bytes[index];
        for (int index = 20; index < 24; index++) height = height * 256 + bytes[index];
        if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 8 * 1024 * 1024)
            throw new InvalidOperationException("结果图片尺寸无效。");
    }

    internal static void WriteResultPng(byte[] bytes, string path)
    {
        ValidateResultPng(bytes);
        if (!String.Equals(Path.GetExtension(path), ".png", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("请选择以 .png 结尾的文件名。");
        using (var stream = new MemoryStream(bytes, false))
        using (var image = Image.FromStream(stream, true, true))
        {
            if (image.RawFormat.Guid != ImageFormat.Png.Guid) throw new InvalidOperationException("只能保存 PNG 结果图片。");
            // Decode and re-encode the image; renderer input is never written as
            // arbitrary bytes or allowed to choose the destination path.
            using (var bitmap = new Bitmap(image)) bitmap.Save(path, ImageFormat.Png);
        }
    }

    sealed class ExportOwner : IWin32Window
    {
        readonly IntPtr handle;
        internal ExportOwner(IntPtr handle) { this.handle = handle; }
        public IntPtr Handle { get { return handle; } }
    }

    async void SendCommand(string command, double value)
    {
        try
        {
            await Query("Promise.resolve(window.__pachiImmersive?.miniAction(" + json.Serialize(command) +
                "," + json.Serialize(value) + ")).then(String)");
        }
        catch (Exception ex) { if (!ended) { Debug.WriteLine(ex); ResetMini(); } }
    }

    async Task<string> Query(string expression)
    {
        await exchange.WaitAsync();
        try
        {
            if (ended) return null;
            using (var timeout = new CancellationTokenSource(3000))
            {
                if (socket == null || socket.State != WebSocketState.Open)
                {
                    DropConnection();
                    var endpoint = await Launch.MainSocket(port);
                    if (ended || endpoint == null) return null;
                    socket = new ClientWebSocket();
                    socket.Options.Proxy = null;
                    await socket.ConnectAsync(endpoint, timeout.Token);
                }
                return await Launch.Evaluate(socket, expression, ++sequence, timeout.Token);
            }
        }
        catch { DropConnection(); throw; }
        finally { exchange.Release(); }
    }

    void DropConnection()
    {
        if (socket != null) { socket.Dispose(); socket = null; }
    }
    void ResetMini()
    {
        if (form != null) { if (!form.IsDisposed) { form.Detach(); form.Dispose(); } form = null; }
        if (artwork != null) { artwork.Dispose(); artwork = null; }
        parent = IntPtr.Zero;
        artworkKey = "";
    }
    void SuspendCaption()
    {
        if (captionForm != null && !captionForm.IsDisposed) captionForm.Suspend();
        captionState = null;
    }
    void ResetCaption()
    {
        SuspendCaption();
    }
    void ReleaseSurfaces()
    {
        ResetMini();
        ResetCaption();
        if (captionForm != null) { captionForm.Dispose(); captionForm = null; }
        DropConnection();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            ended = true;
            timer.Dispose();
            ReleaseSurfaces();
        }
        base.Dispose(disposing);
    }
    public sealed class SurfaceSnapshot
    {
        public long sampledAt { get; set; }
        public string value { get; set; }
        public string error { get; set; }
    }
    public sealed class SurfaceSnapshots
    {
        public SurfaceSnapshot mini { get; set; }
        public SurfaceSnapshot caption { get; set; }
        public PngExportRequest pngExport { get; set; }
    }
    public sealed class PngExportRequest
    {
        public string kind { get; set; }
        public string resource { get; set; }
        public string id { get; set; }
        public string fileName { get; set; }
        public int length { get; set; }
    }
    public sealed class MiniTrack
    {
        public string title { get; set; }
        public string artist { get; set; }
        public long position { get; set; }
        public long duration { get; set; }
        public bool playing { get; set; }
        public string artworkKey { get; set; }
        public string artwork { get; set; }
        public SurfacePalette palette { get; set; }
    }
}
