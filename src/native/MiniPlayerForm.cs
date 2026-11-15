using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// NetEase's layered MiniPlayer repaints over ordinary child windows. An owned
// popup follows its strip instead; the native HWND still owns the entry point,
// movement, visibility, topmost preference and any expanded playlist.
internal sealed class MiniPlayerForm : Form
{
    public const string PopupTitle = "网易云音乐 · 沉浸迷你播放器";
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out NativeRect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref NativePoint point);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr64(IntPtr window, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] static extern int SetWindowLong32(IntPtr window, int index, int value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWindowLong32(IntPtr window, int index);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool ReleaseCapture();
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, NativeWindowEvent callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct NativePoint { public int X, Y; }
    delegate void NativeWindowEvent(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint thread, uint time);

    readonly Action<string, double> command;
    readonly ToolTip tips = new ToolTip();
    readonly MiniButton previous = new MiniButton("previous", "上一首");
    readonly MiniButton play = new MiniButton("play", "播放");
    readonly MiniButton next = new MiniButton("next", "下一首");
    readonly MiniButton restore = new MiniButton("restore", "返回完整模式");
    readonly MiniButton close = new MiniButton("close", "关闭迷你播放器");
    readonly MiniSeekBar seek = new MiniSeekBar();
    readonly ContextMenuStrip menu = new ContextMenuStrip();
    ToolStripMenuItem collectionItem;
    readonly NativeWindowEvent nativeEvents;
    IntPtr nativeWindow;
    IntPtr eventHook;
    int nativeStripHeight;
    float uiScale = 1;
    Rectangle coverBounds, titleBounds, artistBounds;
    Font titleFont, artistFont;
    string songTitle = "尚未播放", songArtist = "从网易云音乐选择一首歌";
    Image cover;
    Bitmap ambient, surface;
    bool surfaceDirty = true;
    bool hasTrack, dismissed, nativeWasVisible;
    SurfacePalette palette;
    internal MiniColors Colors = MiniColors.Default;

    public MiniPlayerForm(Action<string, double> command)
    {
        if (command == null) throw new ArgumentNullException("command");
        this.command = command;
        nativeEvents = OnNativeWindowEvent;
        Text = PopupTitle;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        AutoScaleMode = AutoScaleMode.None;
        KeyPreview = true;
        StartPosition = FormStartPosition.Manual;
        ClientSize = new Size(303, 74);
        BackColor = Color.FromArgb(18, 27, 41);
        ForeColor = Color.FromArgb(247, 249, 255);
        AccessibleName = "网易云音乐迷你播放器";
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint |
            ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);

        Controls.AddRange(new Control[] { previous, play, next, restore, close, seek });
        previous.TabIndex = 0; play.TabIndex = 1; next.TabIndex = 2;
        seek.TabIndex = 3; restore.TabIndex = 4; close.TabIndex = 5;
        foreach (MiniButton button in new[] { previous, play, next, restore, close })
        {
            MiniButton current = button;
            tips.SetToolTip(current, current.AccessibleName);
            current.Click += delegate { IssueCommand(current.Command, 0); };
        }
        seek.SeekRequested += delegate(long position) { IssueCommand("seek", position); };
        seek.PreviewChanged += delegate { UpdateSeekTip(); };
        tips.InitialDelay = 450;
        tips.ReshowDelay = 100;
        tips.AutoPopDelay = 8000;
        menu.ShowImageMargin = false;
        menu.ShowCheckMargin = false;
        menu.Padding = new Padding(4);
        menu.BackColor = Color.FromArgb(29, 43, 62);
        menu.ForeColor = Color.FromArgb(237, 245, 255);
        menu.Font = new Font("Segoe UI", 9f);
        menu.Renderer = new MiniMenuRenderer(Colors);
        AddMenuItem("增大音量", "volumeUp");
        AddMenuItem("减小音量", "volumeDown");
        menu.Items.Add(new ToolStripSeparator());
        collectionItem = AddMenuItem("收藏到歌单", "collection");
        AddMenuItem("桌面歌词", "lyrics");
        AddMenuItem("更多…", "menu");
        menu.Items.Add(new ToolStripSeparator());
        AddMenuItem("返回完整模式", "restore");
        AddMenuItem("关闭迷你播放器", "close");
        menu.Opening += delegate { collectionItem.Enabled = hasTrack; };
        Reflow();
        SetPlaybackEnabled(false);
    }

    ToolStripMenuItem AddMenuItem(string text, string action)
    {
        var item = new ToolStripMenuItem(text);
        item.ForeColor = menu.ForeColor;
        item.Padding = new Padding(8, 5, 18, 5);
        item.Click += delegate {
            // Let the local menu close before the native menu takes ownership.
            if (action == "menu") BeginInvoke(new Action(delegate { if (!IsDisposed) IssueCommand(action, 0); }));
            else IssueCommand(action, 0);
        };
        menu.Items.Add(item);
        return item;
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams value = base.CreateParams;
            value.ExStyle = (value.ExStyle | 0x00000080) & ~0x00040000;
            return value;
        }
    }

    static IntPtr ReadWindowLong(IntPtr window, int index)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(window, index) : new IntPtr(GetWindowLong32(window, index));
    }

    static void WriteWindowLong(IntPtr window, int index, IntPtr value)
    {
        if (IntPtr.Size == 8) SetWindowLongPtr64(window, index, value);
        else SetWindowLong32(window, index, value.ToInt32());
    }

    void IssueCommand(string action, double value)
    {
        if (action == "restore" || action == "close")
        {
            dismissed = true;
            HideSurface();
        }
        command(action, value);
    }

    void HideSurface()
    {
        if (menu.Visible) menu.Close();
        if (Visible) Hide();
    }

    // The host should be per-monitor DPI aware before creating the form. An
    // explicit stripHeight is in that host's window coordinate units. Omitting
    // it uses the native 74-DIP strip and leaves any playlist underneath intact.
    public bool Attach(IntPtr window, int nativeStripHeight = 0)
    {
        if (!IsWindow(window)) return false;
        NativeRect rect;
        if (!GetClientRect(window, out rect) || rect.Right <= 0 || rect.Bottom <= 0) return false;
        if (nativeWindow != window)
        {
            Detach();
            nativeWindow = window;
            WriteWindowLong(Handle, -8, window); // GWLP_HWNDPARENT: an owner for this top-level popup.
            if (GetWindow(Handle, 4) != window) // GW_OWNER
            {
                nativeWindow = IntPtr.Zero;
                return false;
            }
            uint process;
            GetWindowThreadProcessId(window, out process);
            eventHook = SetWinEventHook(0x8001, 0x800B, IntPtr.Zero, nativeEvents, process, 0, 0);
            dismissed = nativeWasVisible = false;
        }
        this.nativeStripHeight = nativeStripHeight;
        SyncBounds();
        return true;
    }

    void OnNativeWindowEvent(IntPtr hook, uint kind, IntPtr window, int objectId, int childId, uint thread, uint time)
    {
        if (window != nativeWindow || objectId != 0 || childId != 0 || IsDisposed) return;
        if (kind != 0x8001 && kind != 0x8002 && kind != 0x8003 && kind != 0x800B) return;
        if (InvokeRequired) BeginInvoke(new Action(SyncBounds));
        else SyncBounds();
    }

    public void SyncBounds()
    {
        bool nativeVisible = nativeWindow != IntPtr.Zero && IsWindow(nativeWindow) && IsWindowVisible(nativeWindow) && !IsIconic(nativeWindow);
        if (!nativeVisible)
        {
            nativeWasVisible = false;
            HideSurface();
            return;
        }
        if (!nativeWasVisible) dismissed = false;
        nativeWasVisible = true;
        if (dismissed) { HideSurface(); return; }
        NativeRect rect;
        if (!GetClientRect(nativeWindow, out rect)) return;
        NativePoint location = new NativePoint();
        if (!ClientToScreen(nativeWindow, ref location)) return;
        uint dpi = 96;
        try { uint current = GetDpiForWindow(nativeWindow); if (current > 0) dpi = current; }
        catch (EntryPointNotFoundException) { }
        int stripHeight = nativeStripHeight > 0 ? nativeStripHeight : (int)Math.Round(74 * dpi / 96.0);
        int width = Math.Max(1, rect.Right - rect.Left);
        int height = Math.Max(1, Math.Min(stripHeight, rect.Bottom - rect.Top));
        bool nativeTopmost = (ReadWindowLong(nativeWindow, -20).ToInt64() & 8) != 0;
        bool popupTopmost = (ReadWindowLong(Handle, -20).ToInt64() & 8) != 0;
        if (Left != location.X || Top != location.Y || Width != width || Height != height || nativeTopmost != popupTopmost)
            SetWindowPos(Handle, nativeTopmost ? new IntPtr(-1) : new IntPtr(-2), location.X, location.Y, width, height,
                0x0010 | (nativeTopmost == popupTopmost ? 0x0004u : 0));
        if (!Visible) Show();
    }

    public void Detach()
    {
        HideSurface();
        if (eventHook != IntPtr.Zero) { UnhookWinEvent(eventHook); eventHook = IntPtr.Zero; }
        if (IsHandleCreated) WriteWindowLong(Handle, -8, IntPtr.Zero);
        nativeWindow = IntPtr.Zero;
        nativeWasVisible = dismissed = false;
    }

    public void UpdatePalette(SurfacePalette value)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke(new Action(delegate { UpdatePalette(value); }));
            return;
        }
        if (SurfacePalette.Same(palette, value)) return;
        palette = value;
        Colors = value == null ? MiniColors.Default : new MiniColors(value);
        BackColor = Colors.Background;
        ForeColor = Colors.Foreground;
        menu.BackColor = Colors.MenuBackground;
        menu.ForeColor = Colors.MenuForeground;
        foreach (ToolStripItem item in menu.Items) item.ForeColor = Colors.MenuForeground;
        menu.Renderer = new MiniMenuRenderer(Colors);
        surfaceDirty = true;
        Invalidate(true);
        menu.Invalidate(true);
    }

    // MiniSession owns the artwork and disposes it after replacing this reference
    // or disposing the form. Keep only the small ambient image here.
    public void UpdateTrack(string title, string artist, Image image, long positionMs, long durationMs, bool playing)
    {
        if (IsDisposed) return;
        if (InvokeRequired)
        {
            BeginInvoke(new Action(delegate { UpdateTrack(title, artist, image, positionMs, durationMs, playing); }));
            return;
        }
        hasTrack = !string.IsNullOrEmpty(title);
        string nextTitle = hasTrack ? title : "尚未播放";
        string nextArtist = hasTrack ? artist ?? "" : "从网易云音乐选择一首歌";
        bool metadataChanged = songTitle != nextTitle || songArtist != nextArtist;
        songTitle = nextTitle;
        songArtist = nextArtist;
        AccessibleName = "网易云音乐迷你播放器，" + songTitle + (songArtist.Length > 0 ? "，" + songArtist : "");
        if (!ReferenceEquals(cover, image))
        {
            Bitmap nextAmbient = null;
            if (image != null)
            {
                // Downsample before stretching: the image supplies soft color
                // fields, with no readable duplicate artwork behind the text.
                nextAmbient = new Bitmap(18, 7);
                using (Graphics graphics = Graphics.FromImage(nextAmbient))
                {
                    graphics.InterpolationMode = InterpolationMode.HighQualityBilinear;
                    graphics.DrawImage(image, new Rectangle(0, 0, 18, 7));
                }
            }
            if (ambient != null) ambient.Dispose();
            cover = image; ambient = nextAmbient;
            surfaceDirty = true;
            Invalidate(true);
        }
        string glyph = playing ? "pause" : "play";
        if (play.Glyph != glyph)
        {
            play.Glyph = glyph;
            play.Invalidate();
        }
        string playName = playing ? "暂停" : "播放";
        if (play.AccessibleName != playName)
        {
            play.AccessibleName = playName;
            tips.SetToolTip(play, playName + " · 空格");
        }
        SetPlaybackEnabled(hasTrack);
        seek.SetPosition(positionMs, durationMs);
        UpdateSeekTip();
        if (metadataChanged) Invalidate();
    }

    void SetPlaybackEnabled(bool enabled)
    {
        previous.Enabled = play.Enabled = next.Enabled = enabled;
    }

    void UpdateSeekTip()
    {
        string value = seek.Duration > 0 ? FormatTime(seek.PreviewPosition) + " / " + FormatTime(seek.Duration) : "当前曲目尚无可用进度";
        if (tips.GetToolTip(seek) != value) tips.SetToolTip(seek, value);
    }

    static string FormatTime(long milliseconds)
    {
        long seconds = Math.Max(0, milliseconds / 1000);
        return (seconds / 60).ToString() + ":" + (seconds % 60).ToString("00");
    }

    int Px(float value) { return (int)Math.Round(value * uiScale); }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (seek != null) Reflow();
    }

    void Reflow()
    {
        uiScale = Math.Max(.65f, Math.Min(Height / 74f, Width / 180f));
        int width = ClientSize.Width;
        coverBounds = new Rectangle(Px(10), Px(10), Px(45), Px(45));
        titleBounds = new Rectangle(Px(65), Px(10), Math.Max(1, width - Px(117)), Px(20));
        artistBounds = new Rectangle(Px(65), Px(35), Math.Max(1, width - Px(173)), Px(17));
        previous.Bounds = new Rectangle(width - Px(103), Px(32), Px(27), Px(27));
        play.Bounds = new Rectangle(width - Px(74), Px(29), Px(31), Px(31));
        next.Bounds = new Rectangle(width - Px(40), Px(32), Px(27), Px(27));
        restore.Bounds = new Rectangle(width - Px(50), Px(4), Px(22), Px(22));
        close.Bounds = new Rectangle(width - Px(26), Px(4), Px(22), Px(22));
        seek.Bounds = new Rectangle(Px(12), Height - Px(14), Math.Max(1, width - Px(24)), Px(13));
        foreach (MiniButton button in new[] { previous, play, next, restore, close }) button.ScaleFactor = uiScale;
        seek.ScaleFactor = uiScale;
        if (titleFont != null) titleFont.Dispose();
        if (artistFont != null) artistFont.Dispose();
        titleFont = new Font("Segoe UI", 12.5f * uiScale, FontStyle.Bold, GraphicsUnit.Pixel);
        artistFont = new Font("Segoe UI", 10.5f * uiScale, FontStyle.Regular, GraphicsUnit.Pixel);
        surfaceDirty = true;
        Invalidate(true);
    }

    void EnsureSurface()
    {
        if (Width < 1 || Height < 1) return;
        if (!surfaceDirty && surface != null && surface.Width == Width && surface.Height == Height) return;
        if (surface != null) surface.Dispose();
        surface = new Bitmap(Width, Height, PixelFormat.Format32bppPArgb);
        using (Graphics graphics = Graphics.FromImage(surface))
        {
            graphics.Clear(BackColor);
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            if (ambient != null)
            {
                graphics.DrawImage(ambient, ClientRectangle);
                using (var shade = new LinearGradientBrush(ClientRectangle,
                    Colors.ShadeTop, Colors.ShadeBottom, 15f)) graphics.FillRectangle(shade, ClientRectangle);
            }
            // Rasterize the glass once. Children copy their exact source rect;
            // WinForms' simulated transparent-parent painting is never used.
            using (var sheen = new LinearGradientBrush(ClientRectangle,
                Colors.SheenTop, Colors.SheenBottom, 100f)) graphics.FillRectangle(sheen, ClientRectangle);
            using (var edge = new Pen(Colors.TopEdge, Math.Max(1, uiScale * .65f)))
                graphics.DrawLine(edge, 0, uiScale * .4f, Width, uiScale * .4f);
            using (var edge = new Pen(Colors.Edge, Math.Max(1, uiScale * .65f)))
                graphics.DrawRectangle(edge, 0, 0, Width - 1, Height - 1);
        }
        surfaceDirty = false;
    }

    internal void PaintControlBackground(Graphics graphics, Rectangle bounds)
    {
        EnsureSurface();
        graphics.Clear(BackColor);
        if (surface != null) graphics.DrawImage(surface, new Rectangle(0, 0, bounds.Width, bounds.Height), bounds, GraphicsUnit.Pixel);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics graphics = e.Graphics;
        EnsureSurface();
        if (surface != null) graphics.DrawImageUnscaled(surface, 0, 0);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        using (var shape = RoundRect(coverBounds, Px(6)))
        {
            if (cover != null)
            {
                GraphicsState saved = graphics.Save();
                graphics.SetClip(shape);
                float side = Math.Min(cover.Width, cover.Height);
                graphics.DrawImage(cover, coverBounds, (cover.Width - side) / 2, (cover.Height - side) / 2, side, side, GraphicsUnit.Pixel);
                graphics.Restore(saved);
            }
            else
            {
                using (var fill = new SolidBrush(Colors.Placeholder)) graphics.FillPath(fill, shape);
                using (var pen = new Pen(Colors.PlaceholderInk, 1.7f * uiScale))
                {
                    float x = coverBounds.Left + Px(22), y = coverBounds.Top + Px(12);
                    graphics.DrawLines(pen, new[] { new PointF(x, y + Px(20)), new PointF(x, y), new PointF(x + Px(10), y - Px(2)), new PointF(x + Px(10), y + Px(15)) });
                    graphics.DrawEllipse(pen, x - Px(7), y + Px(16), Px(7), Px(5));
                    graphics.DrawEllipse(pen, x + Px(3), y + Px(12), Px(7), Px(5));
                }
            }
        }
        TextFormatFlags flags = TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding;
        TextRenderer.DrawText(graphics, songTitle, titleFont, titleBounds, Colors.Foreground, flags);
        if (artistBounds.Width > Px(16)) TextRenderer.DrawText(graphics, songArtist, artistFont, artistBounds, Colors.Muted, flags);
        base.OnPaint(e);
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        Cursor = coverBounds.Contains(e.Location) ? Cursors.Hand : Cursors.Default;
        base.OnMouseMove(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        if (coverBounds.Contains(e.Location) || e.Clicks > 1) { IssueCommand("restore", 0); return; }
        if (nativeWindow != IntPtr.Zero && IsWindow(nativeWindow))
        {
            ReleaseCapture();
            Point cursor = Cursor.Position;
            int packed = (cursor.Y << 16) | (cursor.X & 0xffff);
            // Post rather than Send: this UI thread must keep receiving native
            // location events while the other process runs its move loop.
            PostMessage(nativeWindow, 0x00A1, new IntPtr(2), new IntPtr(packed));
        }
    }

    protected override void WndProc(ref Message message)
    {
        // The regular actions remain available even when the native window's
        // context menu cannot be forwarded across the process boundary.
        if (message.Msg == 0x007B)
        {
            long point = message.LParam.ToInt64();
            Point location = point == -1 ? PointToScreen(new Point(Width / 2, Height / 2)) :
                new Point((short)(point & 0xffff), (short)((point >> 16) & 0xffff));
            menu.Show(location);
            message.Result = IntPtr.Zero;
            return;
        }
        base.WndProc(ref message);
    }

    protected override bool ProcessCmdKey(ref Message message, Keys keyData)
    {
        if (keyData == Keys.Escape) { IssueCommand("restore", 0); return true; }
        if (keyData == Keys.Space && !seek.Focused && !(ActiveControl is MiniButton))
        {
            if (hasTrack) IssueCommand("play", 0);
            return true;
        }
        return base.ProcessCmdKey(ref message, keyData);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            if (eventHook != IntPtr.Zero) { UnhookWinEvent(eventHook); eventHook = IntPtr.Zero; }
            tips.Dispose();
            menu.Dispose();
            cover = null;
            if (ambient != null) ambient.Dispose();
            if (surface != null) surface.Dispose();
            if (titleFont != null) titleFont.Dispose();
            if (artistFont != null) artistFont.Dispose();
        }
        base.Dispose(disposing);
    }

    internal static GraphicsPath RoundRect(RectangleF rect, float radius)
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
}

internal sealed class MiniColors
{
    internal static readonly MiniColors Default = new MiniColors(null);
    internal readonly Color Background = Color.FromArgb(18, 27, 41), Foreground = Color.FromArgb(247, 249, 255),
        Muted = Color.FromArgb(192, 208, 229), ShadeTop = Color.FromArgb(170, 14, 24, 38),
        ShadeBottom = Color.FromArgb(194, 12, 22, 36), SheenTop = Color.FromArgb(25, 223, 239, 255),
        SheenBottom = Color.FromArgb(3, 211, 231, 255), TopEdge = Color.FromArgb(57, 220, 239, 255),
        Edge = Color.FromArgb(25, 220, 239, 255), Placeholder = Color.FromArgb(39, 53, 73),
        PlaceholderInk = Color.FromArgb(193, 211, 233), ButtonInk = Color.FromArgb(239, 245, 255),
        ButtonDisabled = Color.FromArgb(105, 123, 148), PlayFill = Color.FromArgb(245, 249, 255),
        PlayPressed = Color.FromArgb(211, 227, 249), PlayDisabled = Color.FromArgb(58, 73, 93),
        PlayInk = Color.FromArgb(23, 35, 52), PlayDisabledInk = Color.FromArgb(132, 149, 171),
        Hover = Color.FromArgb(22, 235, 244, 255), Pressed = Color.FromArgb(36, 235, 244, 255),
        Focus = Color.FromArgb(221, 237, 255), ProgressTrack = Color.FromArgb(68, 204, 221, 245),
        ProgressInk = Color.FromArgb(226, 237, 253), ProgressThumb = Color.White,
        ProgressFocus = Color.FromArgb(182, 210, 244), MenuBackground = Color.FromArgb(29, 43, 62),
        MenuForeground = Color.FromArgb(237, 245, 255), MenuDisabled = Color.FromArgb(131, 152, 180),
        MenuBorder = Color.FromArgb(50, 68, 91), MenuSelected = Color.FromArgb(54, 73, 97),
        MenuSeparator = Color.FromArgb(56, 75, 99);

    internal MiniColors(SurfacePalette palette)
    {
        if (palette == null) return;
        var colors = new SurfaceColors(palette);
        Background = colors.Background; Foreground = colors.Foreground; Muted = colors.Muted;
        ShadeTop = Color.FromArgb(205, Background);
        ShadeBottom = Color.FromArgb(228, SurfaceColors.Blend(Background, Color.Black, .12f));
        SheenTop = Color.FromArgb(18, Foreground); SheenBottom = Color.FromArgb(3, Foreground);
        TopEdge = Color.FromArgb(57, colors.Accent); Edge = Color.FromArgb(25, colors.Accent);
        Placeholder = SurfaceColors.Blend(Background, Foreground, .1f); PlaceholderInk = Muted;
        ButtonInk = Foreground; ButtonDisabled = SurfaceColors.Blend(Background, Muted, .65f);
        PlayFill = colors.Accent; PlayPressed = SurfaceColors.Blend(colors.Accent, Background, .14f);
        PlayInk = colors.AccentText; PlayDisabled = SurfaceColors.Blend(Background, colors.Accent, .18f);
        PlayDisabledInk = ButtonDisabled;
        Hover = Color.FromArgb(22, colors.Accent); Pressed = Color.FromArgb(36, colors.Accent);
        Focus = colors.Accent; ProgressTrack = Color.FromArgb(68, colors.Muted);
        ProgressInk = ProgressThumb = ProgressFocus = colors.Accent;
        MenuBackground = SurfaceColors.Blend(Background, Foreground, .055f); MenuForeground = Foreground;
        MenuDisabled = ButtonDisabled; MenuBorder = SurfaceColors.Blend(Background, colors.Accent, .24f);
        MenuSelected = SurfaceColors.Blend(MenuBackground, colors.Accent, .18f);
        MenuSeparator = SurfaceColors.Blend(MenuBackground, colors.Muted, .2f);
    }
}

internal sealed class MiniMenuRenderer : ToolStripProfessionalRenderer
{
    readonly MiniColors colors;
    public MiniMenuRenderer(MiniColors colors) : base(new MiniMenuColors(colors))
    { this.colors = colors; RoundedEdges = false; }
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = e.Item.Enabled ? colors.MenuForeground : colors.MenuDisabled;
        base.OnRenderItemText(e);
    }
    sealed class MiniMenuColors : ProfessionalColorTable
    {
        readonly MiniColors colors;
        internal MiniMenuColors(MiniColors colors) { this.colors = colors; }
        public override Color ToolStripDropDownBackground { get { return colors.MenuBackground; } }
        public override Color MenuBorder { get { return colors.MenuBorder; } }
        public override Color MenuItemSelected { get { return colors.MenuSelected; } }
        public override Color MenuItemBorder { get { return colors.MenuSelected; } }
        public override Color SeparatorDark { get { return colors.MenuSeparator; } }
        public override Color SeparatorLight { get { return colors.MenuBackground; } }
    }
}

internal sealed class MiniButton : Control
{
    public readonly string Command;
    public string Glyph;
    public float ScaleFactor = 1;
    bool hovered, pressed;

    public MiniButton(string command, string name)
    {
        Command = command; Glyph = command;
        AccessibleName = name;
        AccessibleRole = AccessibleRole.PushButton;
        SetStyle(ControlStyles.UserPaint | ControlStyles.Opaque | ControlStyles.Selectable |
            ControlStyles.StandardClick | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.FromArgb(18, 27, 41);
        TabStop = true;
        Cursor = Cursors.Hand;
    }

    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = pressed = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { Focus(); pressed = true; } Invalidate(); base.OnMouseDown(e); }
    protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

    public void PerformClick() { if (Enabled) OnClick(EventArgs.Empty); }
    protected override bool IsInputKey(Keys keyData)
    {
        Keys key = keyData & Keys.KeyCode;
        return key == Keys.Space || key == Keys.Enter || base.IsInputKey(keyData);
    }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        if (e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter)
        { pressed = true; Invalidate(); e.Handled = e.SuppressKeyPress = true; }
        base.OnKeyDown(e);
    }
    protected override void OnKeyUp(KeyEventArgs e)
    {
        if (pressed && (e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter))
        { pressed = false; Invalidate(); e.Handled = e.SuppressKeyPress = true; PerformClick(); }
        base.OnKeyUp(e);
    }
    protected override void OnPaintBackground(PaintEventArgs e) { }

    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        var owner = Parent as MiniPlayerForm;
        MiniColors colors = owner == null ? MiniColors.Default : owner.Colors;
        if (owner != null) owner.PaintControlBackground(g, Bounds);
        else g.Clear(BackColor);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float scale = ScaleFactor;
        bool main = Command == "play";
        var bounds = new RectangleF(2 * scale, 2 * scale, Width - 4 * scale, Height - 4 * scale);
        Color ink = Enabled ? colors.ButtonInk : colors.ButtonDisabled;
        if (main)
        {
            using (var fill = new SolidBrush(Enabled ? (pressed ? colors.PlayPressed : colors.PlayFill) : colors.PlayDisabled)) g.FillEllipse(fill, bounds);
            ink = Enabled ? colors.PlayInk : colors.PlayDisabledInk;
        }
        else if (Enabled && (hovered || pressed))
        {
            using (var shape = MiniPlayerForm.RoundRect(bounds, 5 * scale))
            using (var fill = new SolidBrush(pressed ? colors.Pressed : colors.Hover)) g.FillPath(fill, shape);
        }
        float cx = Width / 2f, cy = Height / 2f;
        using (var pen = new Pen(ink, 1.45f * scale))
        using (var fill = new SolidBrush(ink))
        {
            pen.StartCap = pen.EndCap = LineCap.Round;
            if (Glyph == "play") g.FillPolygon(fill, new[] { new PointF(cx - 3 * scale, cy - 5 * scale), new PointF(cx + 5 * scale, cy), new PointF(cx - 3 * scale, cy + 5 * scale) });
            else if (Glyph == "pause")
            {
                g.FillRectangle(fill, cx - 4 * scale, cy - 4.5f * scale, 2.5f * scale, 9 * scale);
                g.FillRectangle(fill, cx + 1.5f * scale, cy - 4.5f * scale, 2.5f * scale, 9 * scale);
            }
            else if (Glyph == "previous" || Glyph == "next")
            {
                float direction = Glyph == "previous" ? -1 : 1;
                g.FillPolygon(fill, new[] { new PointF(cx - direction * 3.5f * scale, cy - 4.5f * scale), new PointF(cx + direction * 3.5f * scale, cy), new PointF(cx - direction * 3.5f * scale, cy + 4.5f * scale) });
                g.DrawLine(pen, cx + direction * 5.5f * scale, cy - 4.5f * scale, cx + direction * 5.5f * scale, cy + 4.5f * scale);
            }
            else if (Glyph == "restore")
            {
                g.DrawLines(pen, new[] { new PointF(cx - 5 * scale, cy), new PointF(cx - 5 * scale, cy + 4 * scale), new PointF(cx - scale, cy + 4 * scale) });
                g.DrawLines(pen, new[] { new PointF(cx + scale, cy - 4 * scale), new PointF(cx + 5 * scale, cy - 4 * scale), new PointF(cx + 5 * scale, cy) });
                g.DrawLine(pen, cx + 5 * scale, cy - 4 * scale, cx, cy + scale);
            }
            else if (Glyph == "close")
            {
                g.DrawLine(pen, cx - 3.5f * scale, cy - 3.5f * scale, cx + 3.5f * scale, cy + 3.5f * scale);
                g.DrawLine(pen, cx + 3.5f * scale, cy - 3.5f * scale, cx - 3.5f * scale, cy + 3.5f * scale);
            }
        }
        if (Focused && ShowFocusCues)
        {
            using (var pen = new Pen(colors.Focus, Math.Max(1, scale)))
            using (var shape = MiniPlayerForm.RoundRect(new RectangleF(scale, scale, Width - 2 * scale, Height - 2 * scale), main ? Width / 2f : 6 * scale)) g.DrawPath(pen, shape);
        }
    }
}

internal sealed class MiniSeekBar : Control
{
    public event Action<long> SeekRequested;
    public event Action PreviewChanged;
    public float ScaleFactor = 1;
    long position, duration, preview;
    bool dragging, hovered;
    public long Duration { get { return duration; } }
    public long PreviewPosition { get { return dragging ? preview : position; } }

    public MiniSeekBar()
    {
        AccessibleName = "播放进度";
        AccessibleRole = AccessibleRole.Slider;
        SetStyle(ControlStyles.UserPaint | ControlStyles.Opaque | ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer | ControlStyles.Selectable, true);
        BackColor = Color.FromArgb(18, 27, 41);
        TabStop = true;
        Cursor = Cursors.Hand;
    }

    public void SetPosition(long current, long total)
    {
        long nextDuration = Math.Max(0, total);
        long nextPosition = Math.Max(0, Math.Min(nextDuration, current));
        if (duration == nextDuration && position == nextPosition && Enabled == (nextDuration > 0)) return;
        duration = nextDuration;
        position = nextPosition;
        Enabled = duration > 0;
        AccessibleDescription = (position / 1000).ToString() + " / " + (duration / 1000).ToString() + " 秒";
        Invalidate();
    }

    long At(int x)
    {
        float inset = 3 * ScaleFactor;
        return (long)Math.Round(Math.Max(0, Math.Min(1, (x - inset) / (double)Math.Max(1, Width - inset * 2))) * duration);
    }
    protected override void OnMouseEnter(EventArgs e) { hovered = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { hovered = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left || duration <= 0) return;
        Focus(); dragging = true; Capture = true; preview = At(e.X);
        Invalidate(); if (PreviewChanged != null) PreviewChanged();
    }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!dragging) return;
        preview = At(e.X); Invalidate(); if (PreviewChanged != null) PreviewChanged();
    }
    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (!dragging || e.Button != MouseButtons.Left) return;
        position = At(e.X); dragging = false; Capture = false;
        Invalidate(); if (SeekRequested != null) SeekRequested(position);
    }
    protected override void OnMouseCaptureChanged(EventArgs e)
    {
        if (dragging && !Capture) { dragging = false; Invalidate(); }
        base.OnMouseCaptureChanged(e);
    }
    protected override bool IsInputKey(Keys keyData)
    {
        Keys key = keyData & Keys.KeyCode;
        return key == Keys.Left || key == Keys.Right || key == Keys.Home || key == Keys.End || base.IsInputKey(keyData);
    }
    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (duration <= 0) return;
        long target = position;
        if (e.KeyCode == Keys.Left) target -= 5000;
        else if (e.KeyCode == Keys.Right) target += 5000;
        else if (e.KeyCode == Keys.Home) target = 0;
        else if (e.KeyCode == Keys.End) target = duration;
        else return;
        position = Math.Max(0, Math.Min(duration, target));
        Invalidate(); e.Handled = e.SuppressKeyPress = true;
        if (SeekRequested != null) SeekRequested(position);
        if (PreviewChanged != null) PreviewChanged();
    }
    protected override void OnPaintBackground(PaintEventArgs e) { }
    protected override void OnPaint(PaintEventArgs e)
    {
        Graphics g = e.Graphics;
        var owner = Parent as MiniPlayerForm;
        MiniColors colors = owner == null ? MiniColors.Default : owner.Colors;
        if (owner != null) owner.PaintControlBackground(g, Bounds);
        else g.Clear(BackColor);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float y = Height / 2f, inset = 3 * ScaleFactor, width = Math.Max(1, Width - inset * 2);
        float x = inset + (duration > 0 ? width * PreviewPosition / duration : 0);
        using (var pen = new Pen(colors.ProgressTrack, Math.Max(2, 2 * ScaleFactor)))
        {
            pen.StartCap = pen.EndCap = LineCap.Round;
            g.DrawLine(pen, inset, y, Width - inset, y);
            if (Enabled && x > inset) { pen.Color = colors.ProgressInk; g.DrawLine(pen, inset, y, x, y); }
        }
        if (Enabled && (hovered || Focused || dragging))
        {
            using (var fill = new SolidBrush(colors.ProgressThumb)) g.FillEllipse(fill, x - 3 * ScaleFactor, y - 3 * ScaleFactor, 6 * ScaleFactor, 6 * ScaleFactor);
        }
        if (Focused && ShowFocusCues)
        {
            using (var pen = new Pen(colors.ProgressFocus, ScaleFactor)) g.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
        }
        base.OnPaint(e);
    }
}
