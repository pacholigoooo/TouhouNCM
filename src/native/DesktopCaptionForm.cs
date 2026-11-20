using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

internal sealed class DesktopCaptionWord
{
    public string text { get; set; }
    public double startMs { get; set; }
    public double durationMs { get; set; }
}

internal sealed class DesktopCaptionState
{
    public string status { get; set; }
    public string identity { get; set; }
    public string key { get; set; }
    public string text { get; set; }
    public string translation { get; set; }
    public string font { get; set; }
    public int fontSize { get; set; }
    public int translationFontSize { get; set; }
    public double captionScale { get; set; }
    public string composition { get; set; }
    public bool? background { get; set; }
    public int lineMode { get; set; }
    public int alignment { get; set; }
    public bool secondaryIsNext { get; set; }
    public string[] color { get; set; }
    public string[] outline { get; set; }
    public SurfacePalette palette { get; set; }
    public bool? outlineEnabled { get; set; }
    public bool word { get; set; }
    public bool playing { get; set; }
    public bool locked { get; set; }
    public double startMs { get; set; }
    public double endMs { get; set; }
    public double positionMs { get; set; }
    public double rate { get; set; }
    public double interpolationMs { get; set; }
    public DesktopCaptionWord[] words { get; set; }
}

internal sealed class DesktopCaptionForm : Form
{
    const string RegionMarker = "Pachi.NcmImmersive.CaptionRegion";
    static readonly string RegionPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Pachi", "NcmImmersive", "caption-region.txt");
    [StructLayout(LayoutKind.Sequential)] struct Rect { internal int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential, Pack = 1)] struct Blend { public byte op, flags, alpha, format; }
    [StructLayout(LayoutKind.Sequential)] struct BitmapInfo
    {
        public uint size; public int width, height; public ushort planes, bits;
        public uint compression, bytes; public int xPels, yPels; public uint colors, important;
    }
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder name, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string type, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetProp(IntPtr h, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool SetProp(IntPtr h, string name, IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr RemoveProp(IntPtr h, string name);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect rect);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int height, uint flags);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr h, IntPtr region);
    [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h, IntPtr region, bool redraw);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int x, int y, int r, int b);
    [DllImport("gdi32.dll")] static extern uint GetRegionData(IntPtr region, uint count, [Out] byte[] data);
    [DllImport("gdi32.dll")] static extern IntPtr ExtCreateRegion(IntPtr transform, uint count, byte[] data);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BitmapInfo info, uint colors, out IntPtr pixels, IntPtr section, uint offset);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref Point at, ref Size size,
        IntPtr src, ref Point from, uint key, ref Blend blend, uint flags);

    readonly DesktopCaptionPainter painter = new DesktopCaptionPainter();
    readonly Action<string> command;
    readonly ToolTip tips = new ToolTip();
    readonly string[] actions = { "detail", "playprev", "play_pause", "playnext", "lock", "setting", "close" };
    readonly string[] labels = { "打开播放详情", "上一首", "播放 / 暂停", "下一首", "锁定歌词", "歌词设置", "关闭桌面歌词" };
    readonly Timer timer = new Timer();
    readonly Stopwatch sampleAge = new Stopwatch();
    bool waitingForSnapshot, pendingTrackChange;
    DesktopCaptionState line;
    IntPtr source, savedRegion, dc, dib, previous;
    bool clipped, shown, clickThrough, topmost, drawnPlaying, hovering, dragging, moved, controlsDirty = true;
    Rectangle sourceRect, drawnRect;
    Rectangle toolbar;
    readonly Rectangle[] buttons = new Rectangle[7];
    Point dragCursor;
    Rectangle dragWindow;
    int hot = -1, pressed = -1;
    float drawnScale;
    IntPtr bits;
    Bitmap pixels;
    Graphics graphics;
    double anchor, budget, rate, lastFrame = -1;
    string drawnKey;
    SurfacePalette toolbarPalette;
    SurfaceColors toolbarColors;
    bool toolbarColorsReady;
    Color toolbarAccentTop, toolbarAccentBottom, toolbarTop, toolbarBottom, toolbarRim,
        toolbarHoverTop, toolbarHoverBottom, toolbarPressedTop, toolbarPressedBottom,
        toolbarIcon, toolbarHotIcon, toolbarLabel;

    internal DesktopCaptionForm(Action<string> command)
    {
        if (command == null) throw new ArgumentNullException("command");
        this.command = command;
        Text = "网易云音乐 · 沉浸桌面歌词";
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        AutoScaleMode = AutoScaleMode.None;
        StartPosition = FormStartPosition.Manual;
        tips.InitialDelay = 400;
        tips.ReshowDelay = 80;
        tips.AutoPopDelay = 6000;
        timer.Tick += delegate {
            try { RefreshCaption(); }
            catch (Exception e) { Debug.WriteLine(e); Suspend(); }
        };
    }

    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get {
            CreateParams p = base.CreateParams;
            // The painted surface receives real mouse input. In locked mode
            // only the small unlock control temporarily accepts input.
            p.ExStyle = (p.ExStyle | 0x08080080) & ~0x40000;
            return p;
        }
    }

    protected override void WndProc(ref Message m)
    {
        const int print = 0x317, printClient = 0x318;
        if ((m.Msg == print || m.Msg == printClient) && pixels != null && m.WParam != IntPtr.Zero)
        {
            using (Graphics target = Graphics.FromHdc(m.WParam))
                target.DrawImageUnscaled(pixels, Point.Empty);
            m.Result = new IntPtr(1);
            return;
        }
        if (m.Msg == 0x21) { m.Result = new IntPtr(3); return; } // MA_NOACTIVATE
        base.WndProc(ref m);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (line == null || source == IntPtr.Zero) return;
        if (e.Button == MouseButtons.Right && !line.locked) { command("setting"); return; }
        if (e.Button != MouseButtons.Left) return;
        pressed = HitButton(e.Location);
        if (line.locked && pressed != 4) return;
        Capture = true;
        if (pressed < 0 && GetCursorPos(out dragCursor))
        {
            dragging = true; moved = false; dragWindow = sourceRect;
            // A larger caption can be clamped away from its native anchor.
            // Start dragging from the surface the user actually grabbed.
            dragWindow.Offset(drawnRect.Left - (sourceRect.Left + (sourceRect.Width - drawnRect.Width) / 2),
                drawnRect.Top - (sourceRect.Top + (sourceRect.Height - drawnRect.Height) / 2));
            NotifyNativeMove(0x231); // WM_ENTERSIZEMOVE
        }
        controlsDirty = true;
        RefreshCaption();
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!dragging || line == null || line.locked) return;
        Point cursor;
        if (!GetCursorPos(out cursor)) return;
        int dx = cursor.X - dragCursor.X, dy = cursor.Y - dragCursor.Y;
        if (!moved && Math.Abs(dx) < SystemInformation.DragSize.Width / 2 && Math.Abs(dy) < SystemInformation.DragSize.Height / 2) return;
        moved = true;
        Rectangle next = new Rectangle(dragWindow.Left + dx, dragWindow.Top + dy, dragWindow.Width, dragWindow.Height);
        Rectangle area = CaptionBounds(next, drawnRect.Size);
        next.Offset(area.Left - (next.Left + (next.Width - area.Width) / 2),
            area.Top - (next.Top + (next.Height - area.Height) / 2));
        // Both positions are physical screen coordinates. Moving the native
        // HWND also keeps its saved position and every native entry point aligned.
        SetWindowPos(source, IntPtr.Zero, next.X, next.Y, 0, 0, 0x15);
        RefreshCaption();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left) return;
        int action = pressed;
        bool activate = Capture && !dragging && action >= 0 && action == HitButton(e.Location);
        EndGesture();
        if (activate) command(action == 4 && line != null && line.locked ? "unlock" : actions[action]);
        controlsDirty = true;
        if (line != null) RefreshCaption();
    }

    protected override void OnMouseCaptureChanged(EventArgs e)
    {
        base.OnMouseCaptureChanged(e);
        if (!Capture) EndGesture();
    }

    protected override void OnMouseDoubleClick(MouseEventArgs e)
    {
        base.OnMouseDoubleClick(e);
        if (e.Button == MouseButtons.Left && line != null && !line.locked && HitButton(e.Location) < 0) command("detail");
    }

    void NotifyNativeMove(uint message)
    {
        IntPtr result;
        if (source != IntPtr.Zero && IsWindow(source)) SendMessageTimeout(source, message, IntPtr.Zero, IntPtr.Zero, 2, 200, out result);
    }

    void EndGesture()
    {
        bool wasDragging = dragging;
        dragging = moved = false; pressed = -1;
        if (Capture) Capture = false;
        if (wasDragging) NotifyNativeMove(0x232); // WM_EXITSIZEMOVE lets the native window persist its bounds.
        controlsDirty = true;
    }

    int HitButton(Point point)
    {
        if (!hovering || line == null) return -1;
        for (int i = 0; i < buttons.Length; i++)
            if ((!line.locked || i == 4) && buttons[i].Contains(point)) return i;
        return -1;
    }

    internal bool Present(IntPtr native, DesktopCaptionState data)
    {
        if (data == null || native == IntPtr.Zero) { Suspend(); return false; }
        if (source != native)
        {
            Suspend();
            if (source != IntPtr.Zero) return false;
            WindowLong.Write(Handle, -8, native);
            if (GetWindow(Handle, 4) != native) return false;
            source = native;
        }
        UpdateToolbarColors(data);
        if (waitingForSnapshot) controlsDirty = true;
        waitingForSnapshot = pendingTrackChange = false;
        line = data;
        anchor = data.positionMs;
        budget = Math.Min(360, Math.Max(0, data.interpolationMs));
        rate = data.rate;
        sampleAge.Restart();
        timer.Interval = data.playing && data.word ? 33 : 40;
        if (!RefreshCaption()) return false;
        timer.Start();
        return true;
    }

    internal bool WaitForSnapshot(IntPtr native, string identity = null)
    {
        if (native != source || !shown || line == null) return false;
        if (!waitingForSnapshot)
        {
            waitingForSnapshot = true;
            anchor = lastFrame >= 0 ? lastFrame : anchor;
            controlsDirty = true;
        }
        if (!String.IsNullOrEmpty(identity) && identity != line.identity && !pendingTrackChange)
        {
            pendingTrackChange = true;
            controlsDirty = true;
        }
        // A sample gap freezes this line; a confirmed track change clears it.
        // Keep ownership until the surface closes or a fresh sample arrives.
        return RefreshCaption();
    }

    bool RefreshCaption()
    {
        Rect win;
        if (line == null || !IsWindowVisible(source) || !GetWindowRect(source, out win)) { Suspend(); return false; }
        Rectangle window = Rectangle.FromLTRB(win.left, win.top, win.right, win.bottom);
        if (window.Width <= 0 || window.Height <= 0) return EnsureNativeSurfaceHidden();
        float dpiScale = Math.Max(1, GetDpiForWindow(source) / 96f);
        bool vertical = String.Equals(line.composition, "vertical", StringComparison.OrdinalIgnoreCase);
        float captionScale = (float)Math.Max(.65, Math.Min(1.6, line.captionScale > 0 ? line.captionScale : 1));
        float scale = dpiScale * captionScale;
        int controls = (int)Math.Ceiling(39 * scale);
        int width = Math.Max((int)Math.Ceiling(236 * scale), (int)Math.Round(window.Width * captionScale));
        int height = Math.Max((int)Math.Ceiling((vertical ? 200 : 46) * scale), (int)Math.Round(window.Height * captionScale) - controls);
        // Size the overlay from the real text before allocating its bitmap;
        // the native HWND keeps its own saved bounds and remains the drag anchor.
        bool captionChanged = painter.PrepareLayout(new Rectangle(0, controls, width, height), scale, line);
        Rectangle area = CaptionBounds(window, new Size(painter.Width, controls + painter.Height));

        if (line.locked && dragging) EndGesture();
        sourceRect = window;
        LayoutToolbar(area.Size, scale);
        Point cursor;
        bool hasCursor = GetCursorPos(out cursor);
        bool over = Capture || hasCursor && area.Contains(cursor);
        Point local = new Point(cursor.X - area.Left, cursor.Y - area.Top);
        bool oldHover = hovering;
        hovering = over;
        int nextHot = hasCursor && over ? HitButton(local) : -1;
        if (nextHot != hot || oldHover != hovering)
        {
            hot = nextHot;
            controlsDirty = true;
            tips.SetToolTip(this, hot < 0 ? null : hot == 4 && line.locked ? "解锁歌词" : labels[hot]);
        }
        Cursor = hot >= 0 ? Cursors.Hand : line.locked ? Cursors.Default : Cursors.SizeAll;
        bool passInput = line.locked && hot != 4 && !Capture;
        if (clickThrough != passInput)
        {
            long style = WindowLong.Read(Handle, -20).ToInt64();
            WindowLong.Write(Handle, -20, new IntPtr(passInput ? style | 0x20 : style & ~0x20L));
            clickThrough = passInput;
        }
        double position = anchor + (line.playing && !waitingForSnapshot ? Math.Min(sampleAge.Elapsed.TotalMilliseconds, budget) * rate : 0);
        bool movingInk = !waitingForSnapshot && (line.word || painter.HasPages);
        if (!shown || controlsDirty || captionChanged || drawnKey != line.key || area != drawnRect || drawnScale != scale || drawnPlaying != line.playing ||
            movingInk && Math.Abs(position - lastFrame) >= 8)
        {
            if (!PaintLayer(area, scale, position)) { Suspend(); return false; }
            drawnKey = line.key; drawnRect = area; drawnScale = scale; lastFrame = position; drawnPlaying = line.playing;
            controlsDirty = false;
        }
        bool nativeTop = (WindowLong.Read(source, -20).ToInt64() & 8) != 0;
        if (!shown || nativeTop != topmost)
        {
            if (!SetWindowPos(Handle, new IntPtr(nativeTop ? -1 : -2), 0, 0, 0, 0, 0x253)) { Suspend(); return false; }
            shown = true; topmost = nativeTop;
        }
        if (!EnsureNativeSurfaceHidden()) { Suspend(); return false; }
        return true;
    }

    static Rectangle CaptionBounds(Rectangle native, Size size)
    {
        Rectangle area = new Rectangle(native.Left + (native.Width - size.Width) / 2,
            native.Top + (native.Height - size.Height) / 2, size.Width, size.Height);
        Rectangle work = Screen.FromRectangle(native).WorkingArea;
        area.X = Math.Max(work.Left, Math.Min(work.Right - area.Width, area.Left));
        area.Y = Math.Max(work.Top, Math.Min(work.Bottom - area.Height, area.Top));
        return area;
    }

    bool EnsureNativeSurfaceHidden()
    {
        if (!clipped) return HideNativeSurface();
        // Native hover/lock handling can replace its region after our first
        // clip. Check the HWND rather than trusting the ownership flag alone.
        IntPtr region = CreateRectRgn(0, 0, 0, 0);
        if (region == IntPtr.Zero) return false;
        int kind;
        try { kind = GetWindowRgn(source, region); }
        catch { DeleteObject(region); throw; }
        if (kind == 1) { DeleteObject(region); return true; }
        // Locking, resizing or changing composition can replace the native
        // shape. Preserve that latest shape before hiding it again.
        IntPtr original = savedRegion;
        savedRegion = kind == 0 ? IntPtr.Zero : region;
        try { SaveRegion(true); }
        catch { savedRegion = original; DeleteObject(region); throw; }
        if (kind == 0) DeleteObject(region);
        if (original != IntPtr.Zero) DeleteObject(original);
        return ClipNativeSurface();
    }

    void LayoutToolbar(Size size, float scale)
    {
        int button = Math.Min((int)Math.Round(32 * scale), (size.Width - (int)Math.Round(12 * scale)) / buttons.Length);
        int height = (int)Math.Round(30 * scale), top = (int)Math.Round(4 * scale);
        int width = line.locked ? (int)Math.Round(110 * scale) : button * buttons.Length;
        toolbar = new Rectangle((size.Width - width) / 2, top, width, height);
        for (int i = 0; i < buttons.Length; i++)
            buttons[i] = line.locked ? i == 4 ? toolbar : Rectangle.Empty :
                new Rectangle(toolbar.Left + button * i, top, button, height);
    }

    bool HideNativeSurface()
    {
        // Save before clipping: a later launcher/helper can recover this HWND
        // even if this process exits without running Dispose.
        savedRegion = CreateRectRgn(0, 0, 0, 0);
        if (savedRegion == IntPtr.Zero) return false;
        int kind = GetWindowRgn(source, savedRegion);
        if (kind == 1)
        {
            // An empty native region is an old helper's clipping, never an
            // original region to preserve and later restore as invisible.
            if (SetWindowRgn(source, IntPtr.Zero, true) == 0) { DeleteObject(savedRegion); savedRegion = IntPtr.Zero; return false; }
            kind = 0;
        }
        if (kind == 0) { DeleteObject(savedRegion); savedRegion = IntPtr.Zero; }
        try { SaveRegion(); }
        catch
        {
            if (savedRegion != IntPtr.Zero) { DeleteObject(savedRegion); savedRegion = IntPtr.Zero; }
            throw;
        }
        if (ClipNativeSurface()) return true;
        if (savedRegion != IntPtr.Zero) { DeleteObject(savedRegion); savedRegion = IntPtr.Zero; }
        RemoveProp(source, RegionMarker);
        File.Delete(RegionPath);
        return false;
    }

    bool ClipNativeSurface()
    {
        IntPtr hidden = CreateRectRgn(0, 0, 0, 0);
        if (hidden != IntPtr.Zero && SetWindowRgn(source, hidden, true) != 0) { clipped = true; return true; }
        if (hidden != IntPtr.Zero) DeleteObject(hidden);
        return false;
    }

    void SaveRegion(bool replace = false)
    {
        if (!replace && File.Exists(RegionPath)) throw new InvalidOperationException("上一次桌面歌词窗口尚未恢复，请重新打开沉浸听歌入口。");
        byte[] data = new byte[0];
        if (savedRegion != IntPtr.Zero)
        {
            uint size = GetRegionData(savedRegion, 0, null);
            if (size == 0) throw new InvalidOperationException("无法保存原生桌面歌词窗口区域。");
            data = new byte[size];
            if (GetRegionData(savedRegion, size, data) != size) throw new InvalidOperationException("无法保存原生桌面歌词窗口区域。");
        }
        int pid;
        GetWindowThreadProcessId(source, out pid);
        using (var process = Process.GetProcessById(pid))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(RegionPath));
            string temporary = RegionPath + ".tmp";
            File.WriteAllLines(temporary, new[] { pid.ToString(), process.StartTime.ToUniversalTime().Ticks.ToString(),
                source.ToInt64().ToString(), Convert.ToBase64String(data) });
            if (replace) File.Replace(temporary, RegionPath, null);
            else File.Move(temporary, RegionPath);
        }
        if (!SetProp(source, RegionMarker, new IntPtr(1)))
        {
            File.Delete(RegionPath);
            throw new InvalidOperationException("无法记录原生桌面歌词窗口，已保留原生显示。");
        }
    }

    internal static void RecoverNativeSurface(Process player)
    {
        if (File.Exists(RegionPath))
        {
            string[] record = File.ReadAllLines(RegionPath);
            int pid; long started, window;
            if (record.Length != 4 || !Int32.TryParse(record[0], out pid) || !Int64.TryParse(record[1], out started) ||
                !Int64.TryParse(record[2], out window)) throw new InvalidOperationException("桌面歌词窗口恢复记录无效。");
            IntPtr native = new IntPtr(window);
            bool sameProcess = false;
            try
            {
                using (var process = Process.GetProcessById(pid))
                    sameProcess = process.StartTime.ToUniversalTime().Ticks == started;
            }
            catch (ArgumentException) { }
            catch (InvalidOperationException) { }
            int actualPid;
            var name = new StringBuilder(64);
            GetWindowThreadProcessId(native, out actualPid);
            GetClassName(native, name, name.Capacity);
            if (sameProcess && actualPid == pid && name.ToString() == "DesktopLyrics" && GetProp(native, RegionMarker) != IntPtr.Zero)
            {
                IntPtr current = CreateRectRgn(0, 0, 0, 0);
                if (current == IntPtr.Zero) throw new InvalidOperationException("无法恢复原生桌面歌词窗口。");
                int kind;
                try { kind = GetWindowRgn(native, current); }
                finally { DeleteObject(current); }
                // Native code may already have replaced the region while we
                // were absent. Preserve that current region when it is visible.
                if (kind == 1)
                {
                    byte[] data = Convert.FromBase64String(record[3]);
                    IntPtr original = data.Length == 0 ? IntPtr.Zero : ExtCreateRegion(IntPtr.Zero, (uint)data.Length, data);
                    if (data.Length > 0 && original == IntPtr.Zero) throw new InvalidOperationException("无法恢复原生桌面歌词窗口区域。");
                    if (SetWindowRgn(native, original, true) == 0)
                    {
                        if (original != IntPtr.Zero) DeleteObject(original);
                        throw new InvalidOperationException("原生桌面歌词窗口暂时无法恢复，请稍后重试。");
                    }
                }
                RemoveProp(native, RegionMarker);
            }
            File.Delete(RegionPath);
        }
        // Migrate a window clipped by a version without a recovery record.
        IntPtr legacy = IntPtr.Zero;
        while ((legacy = FindWindowEx(IntPtr.Zero, legacy, "DesktopLyrics", null)) != IntPtr.Zero)
        {
            int pid;
            GetWindowThreadProcessId(legacy, out pid);
            if (pid != player.Id || !IsWindowVisible(legacy)) continue;
            IntPtr region = CreateRectRgn(0, 0, 0, 0);
            if (region == IntPtr.Zero) throw new InvalidOperationException("无法检查原生桌面歌词窗口区域。");
            int kind;
            try { kind = GetWindowRgn(legacy, region); }
            finally { DeleteObject(region); }
            if (kind == 1 && SetWindowRgn(legacy, IntPtr.Zero, true) == 0)
                throw new InvalidOperationException("原生桌面歌词窗口暂时无法恢复，请稍后重试。");
        }
    }

    bool RestoreRegion()
    {
        if (!clipped) return true;
        bool exists = IsWindow(source);
        bool restore = false;
        if (exists)
        {
            IntPtr current = CreateRectRgn(0, 0, 0, 0);
            if (current == IntPtr.Zero) return false;
            try { restore = GetWindowRgn(source, current) == 1; }
            finally { DeleteObject(current); }
        }
        // The native lock/hover code can replace our empty clipping region.
        // Restore only our clipping, preserving a region the native window updated.
        if (restore && SetWindowRgn(source, savedRegion, true) == 0) return false;
        if (!restore && savedRegion != IntPtr.Zero) DeleteObject(savedRegion);
        savedRegion = IntPtr.Zero; clipped = false;
        RemoveProp(source, RegionMarker);
        File.Delete(RegionPath);
        return true;
    }
    bool HideOverlay()
    {
        bool restored = RestoreRegion();
        if (shown) { ShowWindow(Handle, 0); shown = false; }
        return restored;
    }
    bool PaintLayer(Rectangle area, float scale, double pos)
    {
        Size size = area.Size;
        if (pixels == null || size != pixels.Size)
        {
            FreeBuffer();
            var info = new BitmapInfo { size = 40, width = size.Width, height = -size.Height, planes = 1, bits = 32 };
            dc = CreateCompatibleDC(IntPtr.Zero);
            if (dc == IntPtr.Zero) return false;
            dib = CreateDIBSection(dc, ref info, 0, out bits, IntPtr.Zero, 0);
            if (dib == IntPtr.Zero || bits == IntPtr.Zero) return false;
            previous = SelectObject(dc, dib);
            pixels = new Bitmap(size.Width, size.Height, size.Width * 4, PixelFormat.Format32bppPArgb, bits);
            graphics = Graphics.FromImage(pixels);
        }
        graphics.Clear(Color.Transparent);
        if (!pendingTrackChange && (!String.IsNullOrWhiteSpace(line.text) || !String.IsNullOrWhiteSpace(line.translation)))
            painter.Draw(graphics, line, pos);
        if (hovering) DrawToolbar(graphics, scale);
        graphics.Flush();
        Point at = area.Location, zero = Point.Empty;
        Blend blend = new Blend { alpha = 255, format = 1 };
        return UpdateLayeredWindow(Handle, IntPtr.Zero, ref at, ref size, dc, ref zero, 0, ref blend, 2);
    }

    void DrawToolbar(Graphics g, float scale)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using (GraphicsPath shape = Rounded(toolbar, 9 * scale))
        using (var fill = new LinearGradientBrush(toolbar, toolbarTop, toolbarBottom, 90))
        using (var rim = new Pen(toolbarRim, scale))
        {
            g.FillPath(fill, shape);
            g.DrawPath(rim, shape);
        }
        for (int i = 0; i < buttons.Length; i++)
        {
            if (line.locked && i != 4) continue;
            Rectangle rect = buttons[i];
            if (hot == i || pressed == i)
            {
                Rectangle highlight = rect;
                highlight.Inflate(-(int)Math.Ceiling(2 * scale), -(int)Math.Ceiling(2 * scale));
                using (GraphicsPath shape = Rounded(highlight, 6 * scale))
                using (var fill = new LinearGradientBrush(highlight,
                    pressed == i ? toolbarPressedTop : toolbarHoverTop,
                    pressed == i ? toolbarPressedBottom : toolbarHoverBottom, 90)) g.FillPath(fill, shape);
            }
            float x = line.locked ? rect.Left + 23 * scale : rect.Left + rect.Width / 2f;
            float y = rect.Top + rect.Height / 2f;
            GraphicsState state = g.Save();
            g.TranslateTransform(x, y);
            g.ScaleTransform(scale, scale);
            using (var pen = new Pen(hot == i ? toolbarHotIcon : toolbarIcon, 1.35f))
            using (var ink = new SolidBrush(pen.Color))
            {
                pen.StartCap = pen.EndCap = LineCap.Round;
                pen.LineJoin = LineJoin.Round;
                if (i == 0)
                {
                    g.DrawLines(pen, new[] { new PointF(1, -6), new PointF(-6, -6), new PointF(-6, 6), new PointF(6, 6), new PointF(6, -1) });
                    g.DrawLines(pen, new[] { new PointF(1, -7), new PointF(7, -7), new PointF(7, -1) });
                    g.DrawLine(pen, 0, 0, 7, -7);
                }
                else if (i == 1 || i == 3)
                {
                    float direction = i == 1 ? -1 : 1;
                    g.FillPolygon(ink, new[] { new PointF(4 * direction, 0), new PointF(-4 * direction, -6), new PointF(-4 * direction, 6) });
                    g.DrawLine(pen, 6 * direction, -6, 6 * direction, 6);
                }
                else if (i == 2)
                {
                    if (line.playing) { g.FillRectangle(ink, -5, -6, 3, 12); g.FillRectangle(ink, 2, -6, 3, 12); }
                    else g.FillPolygon(ink, new[] { new PointF(-4, -7), new PointF(7, 0), new PointF(-4, 7) });
                }
                else if (i == 4)
                {
                    g.DrawRectangle(pen, -6, -1, 12, 9);
                    if (line.locked) g.DrawArc(pen, -4, -8, 8, 13, 180, 180);
                    else g.DrawArc(pen, -1, -8, 8, 13, 180, 180);
                    g.DrawLine(pen, 0, 2, 0, 5);
                }
                else if (i == 5)
                {
                    for (int dot = -1; dot <= 1; dot++) g.FillEllipse(ink, dot * 5 - 1.3f, -1.3f, 2.6f, 2.6f);
                }
                else { g.DrawLine(pen, -5, -5, 5, 5); g.DrawLine(pen, 5, -5, -5, 5); }
            }
            g.Restore(state);
            if (line.locked)
                using (var font = new Font("Microsoft YaHei UI", 11 * scale, FontStyle.Regular, GraphicsUnit.Pixel))
                using (var ink = new SolidBrush(toolbarLabel))
                using (var format = new StringFormat { LineAlignment = StringAlignment.Center })
                    g.DrawString("解锁歌词", font, ink, new RectangleF(rect.Left + 39 * scale, rect.Top, rect.Width - 43 * scale, rect.Height), format);
        }
    }

    void UpdateToolbarColors(DesktopCaptionState data)
    {
        Color accentTop = DesktopCaptionPainter.ReadColor(data.color, 2, Color.FromArgb(255, 222, 222));
        Color accentBottom = DesktopCaptionPainter.ReadColor(data.color, 3, Color.FromArgb(255, 176, 176));
        bool samePalette = SurfacePalette.Same(toolbarPalette, data.palette);
        if (toolbarColorsReady && samePalette && toolbarAccentTop == accentTop && toolbarAccentBottom == accentBottom) return;
        if (!samePalette) toolbarColors = data.palette == null ? null : new SurfaceColors(data.palette);
        toolbarPalette = data.palette;
        toolbarAccentTop = accentTop; toolbarAccentBottom = accentBottom;
        toolbarTop = Color.FromArgb(247, 31, 43, 49); toolbarBottom = Color.FromArgb(247, 17, 27, 32);
        toolbarIcon = Color.FromArgb(221, 234, 235); toolbarLabel = Color.FromArgb(232, 244, 240);
        toolbarHotIcon = Color.FromArgb((accentTop.R + 255) / 2, (accentTop.G + 255) / 2, (accentTop.B + 255) / 2);
        if (toolbarColors != null)
        {
            toolbarTop = Color.FromArgb(247, SurfaceColors.Blend(toolbarColors.Background, toolbarColors.Foreground, .065f));
            toolbarBottom = Color.FromArgb(247, toolbarColors.Background);
            toolbarIcon = toolbarLabel = toolbarColors.Foreground;
            toolbarHotIcon = accentTop = accentBottom = toolbarColors.Accent;
        }
        toolbarRim = Color.FromArgb(accentTop.A * 98 / 255, accentTop);
        toolbarHoverTop = Color.FromArgb(accentTop.A * 32 / 255, accentTop);
        toolbarHoverBottom = Color.FromArgb(accentBottom.A * 32 / 255, accentBottom);
        toolbarPressedTop = Color.FromArgb(accentTop.A * 66 / 255, accentTop);
        toolbarPressedBottom = Color.FromArgb(accentBottom.A * 66 / 255, accentBottom);
        toolbarColorsReady = true;
        controlsDirty = true;
    }

    static GraphicsPath Rounded(Rectangle rect, float radius)
    {
        float diameter = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
        var path = new GraphicsPath();
        path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    void FreeBuffer()
    {
        if (graphics != null) { graphics.Dispose(); graphics = null; }
        if (pixels != null) { pixels.Dispose(); pixels = null; }
        if (previous != IntPtr.Zero) { SelectObject(dc, previous); previous = IntPtr.Zero; }
        if (dib != IntPtr.Zero) { DeleteObject(dib); dib = IntPtr.Zero; }
        if (dc != IntPtr.Zero) { DeleteDC(dc); dc = IntPtr.Zero; }
    }
    internal void Suspend()
    {
        timer.Stop(); EndGesture();
        waitingForSnapshot = pendingTrackChange = false;
        if (HideOverlay())
        {
            if (source != IntPtr.Zero && IsHandleCreated) WindowLong.Write(Handle, -8, IntPtr.Zero);
            source = IntPtr.Zero;
        }
        line = null; drawnKey = null;
        hovering = false; hot = -1; controlsDirty = true;
        tips.SetToolTip(this, null);
        FreeBuffer();
        painter.Clear();
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing) { Suspend(); timer.Dispose(); tips.Dispose(); painter.Dispose(); }
        base.Dispose(disposing);
    }
}
