using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;

// All geometry belongs to a lyric/size, rather than to a playback frame. Keeping
// outlined glyphs also avoids ClearType fringes on the premultiplied-alpha HWND.
internal sealed class DesktopCaptionPainter : IDisposable
{
    sealed class CaptionLine : IDisposable
    {
        internal int Start, End;
        internal float Width, X;
        internal bool Vertical;
        internal RectangleF Ink;
        internal GraphicsPath Path = new GraphicsPath();
        internal Bitmap Image, Highlight;
        internal Point ImageLocation;
        internal readonly List<Letter> Letters = new List<Letter>();
        public void Dispose()
        {
            if (Path != null) Path.Dispose();
            if (Image != null) Image.Dispose();
            if (Highlight != null) Highlight.Dispose();
        }
    }

    struct Letter
    {
        internal int Start, End;
        internal float Left, Right;
    }

    struct TimedSpan
    {
        internal int Start, End;
        internal double Time, Duration;
        internal string Text;
    }

    sealed class Face : IDisposable
    {
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
        static extern uint GetGlyphIndicesW(IntPtr dc, string text, int count, [Out] ushort[] glyphs, uint flags);

        internal readonly FontFamily Family;
        internal readonly Font Font;
        internal readonly FontStyle Style;
        internal readonly bool Slant;
        readonly Dictionary<string, bool> coverage = new Dictionary<string, bool>();
        readonly IntPtr dc, handle, previous;

        internal Face(string family, float size, bool original)
        {
            Family = new FontFamily(family);
            Style = FontStyle.Regular;
            if (original)
            {
                if (Family.IsStyleAvailable(FontStyle.Italic)) Style = FontStyle.Italic;
                else if (Family.IsStyleAvailable(FontStyle.Bold)) Style = FontStyle.Bold;
            }
            Slant = original && (Style & FontStyle.Italic) == 0 &&
                !family.StartsWith("Microsoft YaHei", StringComparison.OrdinalIgnoreCase);
            Font = new Font(Family, size, Style, GraphicsUnit.Pixel);
            handle = Font.ToHfont();
            dc = CreateCompatibleDC(IntPtr.Zero);
            previous = SelectObject(dc, handle);
        }

        internal bool Contains(string element)
        {
            if (String.IsNullOrWhiteSpace(element)) return true;
            bool present;
            if (coverage.TryGetValue(element, out present)) return present;
            ushort[] glyphs = new ushort[element.Length];
            present = GetGlyphIndicesW(dc, element, element.Length, glyphs, 1) != UInt32.MaxValue;
            for (int i = 0; present && i < glyphs.Length; i++)
                if (glyphs[i] == UInt16.MaxValue && !Char.IsControl(element[i])) present = false;
            coverage[element] = present;
            return present;
        }

        public void Dispose()
        {
            SelectObject(dc, previous);
            DeleteDC(dc);
            DeleteObject(handle);
            Font.Dispose();
            Family.Dispose();
        }
    }

    sealed class FontSet : IDisposable
    {
        internal readonly Face Preferred, Cjk, Symbols;
        internal readonly float Size;
        internal FontSet(string family, float size, bool original)
        {
            Size = size;
            Preferred = new Face(family, size, original);
            Cjk = new Face("Microsoft YaHei UI", size, original);
            Symbols = new Face("Segoe UI Symbol", size, original);
        }
        internal Face Pick(string element)
        {
            if (Preferred.Contains(element)) return Preferred;
            if (Cjk.Contains(element)) return Cjk;
            return Symbols;
        }
        public void Dispose() { Preferred.Dispose(); Cjk.Dispose(); Symbols.Dispose(); }
    }

    readonly StringFormat format;
    readonly StringFormat pageFormat;
    string text = "", translation = "", family = "", fontPreference = "";
    int fontSize, translationFontSize;
    int mainAlignment, secondaryAlignment;
    Rectangle bounds, requestedBounds;
    Rectangle panelBounds;
    float scale;
    FontSet mainFonts, translationFonts;
    List<CaptionLine> mainLines, translationLines;
    float mainPitch, translationPitch;
    Bitmap glass;
    SurfacePalette palette;
    SurfaceColors surfaceColors;
    Color originalTop, originalBottom, highlightTop, highlightBottom, originalStroke, highlightStroke;
    bool outlineEnabled, vertical, backgroundEnabled;
    SolidBrush pageBrush;
    Pen shadowPen, outlinePen, highlightOutline, translationOutline;
    Pen progressTrack, progressInk;
    Font pageFont;
    TimedSpan[] timed = new TimedSpan[0];
    DesktopCaptionWord[] lastWords;
    internal bool HasPages {
        get { return (mainLines != null && mainLines.Count > 2) || (translationLines != null && translationLines.Count > 2); }
    }
    internal int Height { get { return bounds.Height; } }
    internal int Width { get { return bounds.Width; } }

    internal DesktopCaptionPainter()
    {
        format = (StringFormat)StringFormat.GenericTypographic.Clone();
        format.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces | StringFormatFlags.NoClip;
        pageFormat = (StringFormat)StringFormat.GenericTypographic.Clone();
        pageFormat.Alignment = StringAlignment.Far;
        pageFormat.FormatFlags |= StringFormatFlags.NoWrap | StringFormatFlags.NoClip;
    }

    internal bool PrepareLayout(Rectangle area, float dpiScale, DesktopCaptionState data)
    {
        if (data == null || area.Width <= 0 || area.Height <= 0) return false;
        float nextScale = Math.Max(.5f, dpiScale);
        bool scaleChanged = scale != nextScale;
        string nextText = (data.text ?? "").Trim();
        string nextTranslation = (data.translation ?? "").Trim();
        string preference = data.font ?? "";
        string nextFamily = mainLines != null && fontPreference == preference ? family : ResolveFamily(preference);
        int nextMainAlignment = data.alignment == 2 || data.alignment == 3 ? data.alignment :
            data.lineMode == 0 && data.alignment == 1 ? 2 : 0;
        int nextSecondaryAlignment = data.secondaryIsNext && data.lineMode == 0 && data.alignment == 1 ? 3 : nextMainAlignment;
        Color nextOriginalTop = ReadColor(data.color, 0, Color.FromArgb(238, 238, 238));
        Color nextOriginalBottom = ReadColor(data.color, 1, Color.FromArgb(238, 238, 238));
        Color nextHighlightTop = ReadColor(data.color, 2, Color.FromArgb(255, 222, 222));
        Color nextHighlightBottom = ReadColor(data.color, 3, Color.FromArgb(255, 176, 176));
        Color nextOriginalStroke = ReadColor(data.outline, 0, Color.FromArgb(153, 153, 153));
        Color nextHighlightStroke = ReadColor(data.outline, 1, Color.FromArgb(203, 116, 116));
        bool nextOutlineEnabled = data.outlineEnabled.GetValueOrDefault(true);
        bool nextVertical = String.Equals(data.composition, "vertical", StringComparison.OrdinalIgnoreCase);
        bool nextBackground = data.background.GetValueOrDefault(true);
        bool backgroundChanged = backgroundEnabled != nextBackground;
        backgroundEnabled = nextBackground;
        bool paletteChanged = !SurfacePalette.Same(palette, data.palette);
        if (paletteChanged)
        {
            palette = data.palette;
            surfaceColors = palette == null ? null : new SurfaceColors(palette);
        }
        bool layoutChanged = mainLines == null || requestedBounds != area || scaleChanged || text != nextText ||
            translation != nextTranslation || family != nextFamily || fontSize != data.fontSize ||
            translationFontSize != data.translationFontSize ||
            mainAlignment != nextMainAlignment || secondaryAlignment != nextSecondaryAlignment ||
            originalTop != nextOriginalTop || originalBottom != nextOriginalBottom ||
            highlightTop != nextHighlightTop || highlightBottom != nextHighlightBottom ||
            originalStroke != nextOriginalStroke || highlightStroke != nextHighlightStroke || outlineEnabled != nextOutlineEnabled ||
            vertical != nextVertical;
        if (layoutChanged)
        {
            ClearLayout();
            requestedBounds = bounds = area; scale = nextScale; text = nextText; translation = nextTranslation;
            family = nextFamily; fontPreference = preference; fontSize = data.fontSize;
            translationFontSize = data.translationFontSize;
            mainAlignment = nextMainAlignment; secondaryAlignment = nextSecondaryAlignment;
            originalTop = nextOriginalTop; originalBottom = nextOriginalBottom;
            highlightTop = nextHighlightTop; highlightBottom = nextHighlightBottom;
            originalStroke = nextOriginalStroke; highlightStroke = nextHighlightStroke; outlineEnabled = nextOutlineEnabled;
            vertical = nextVertical;
            using (var measure = new Bitmap(1, 1))
            using (Graphics g = Graphics.FromImage(measure)) BuildLayout(g);
            lastWords = null;
            timed = new TimedSpan[0];
        }
        else if (paletteChanged) UpdateDecorationColors();
        if (!backgroundEnabled)
        {
            if (glass != null) { glass.Dispose(); glass = null; }
        }
        else if (glass == null || glass.Size != bounds.Size || scaleChanged || paletteChanged)
        {
            if (glass != null) glass.Dispose();
            glass = BuildGlass(bounds.Size, nextScale, surfaceColors);
        }
        return layoutChanged || paletteChanged || backgroundChanged;
    }

    internal void Draw(Graphics g, DesktopCaptionState data, double positionMs)
    {
        if (data == null || mainLines == null) return;
        UpdateTimings(data.words);

        GraphicsState state = g.Save();
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.CompositingQuality = CompositingQuality.HighSpeed;
        g.SetClip(bounds, CombineMode.Intersect);
        if (data.background.GetValueOrDefault(true)) DrawGlass(g);

        double fraction = Fraction(positionMs, data.startMs, data.endMs - data.startMs);
        double reveal = data.word ? RevealAt(positionMs, fraction) : text.Length;
        int mainPages = PageCount(mainLines), translatedPages = PageCount(translationLines);
        int page = data.word && timed.Length > 0 ? PageFor(reveal) :
            Math.Min(mainPages - 1, (int)(fraction * mainPages));
        int translatedPage = Math.Min(translatedPages - 1, (int)(fraction * translatedPages));

        for (int i = page * 2; i < Math.Min(mainLines.Count, page * 2 + 2); i++)
            DrawOriginal(g, mainLines[i], reveal);
        for (int i = translatedPage * 2; i < Math.Min(translationLines.Count, translatedPage * 2 + 2); i++)
            g.DrawImageUnscaled(translationLines[i].Image, translationLines[i].ImageLocation);
        if (mainPages > 1 || translatedPages > 1)
        {
            string label = mainPages > 1 ? (page + 1) + " / " + mainPages : "";
            if (translatedPages > 1) label += (label.Length > 0 ? "   ·   " : "") + "译 " + (translatedPage + 1) + " / " + translatedPages;
            g.DrawString(label, pageFont, pageBrush,
                new PointF(panelBounds.Right - 16 * scale, panelBounds.Bottom - 17 * scale), pageFormat);
        }
        if (data.playing && text.Length > 0 && (data.word || HasPages) &&
            data.endMs > data.startMs && positionMs >= data.startMs && positionMs < data.endMs)
        {
            float width = Math.Min(76 * scale, panelBounds.Width * .28f);
            float left = panelBounds.Left + (panelBounds.Width - width) / 2;
            float y = panelBounds.Bottom - 10 * scale;
            g.DrawLine(progressTrack, left, y, left + width, y);
            if (fraction > 0) g.DrawLine(progressInk, left, y, left + width * (float)fraction, y);
        }
        g.Restore(state);
    }

    void DrawGlass(Graphics g)
    {
        // The smoke surface is generated once per window size/DPI. Nine slices
        // preserve its feather, corners and rim when a short lyric narrows it.
        int capX = Math.Min((int)Math.Ceiling(25 * scale), Math.Min(glass.Width, panelBounds.Width) / 3);
        int capY = Math.Min((int)Math.Ceiling(22 * scale), Math.Min(glass.Height, panelBounds.Height) / 3);
        int[] sourceX = { 0, capX, glass.Width - capX, glass.Width };
        int[] sourceY = { 0, capY, glass.Height - capY, glass.Height };
        int[] targetX = { panelBounds.Left, panelBounds.Left + capX, panelBounds.Right - capX, panelBounds.Right };
        int[] targetY = { panelBounds.Top, panelBounds.Top + capY, panelBounds.Bottom - capY, panelBounds.Bottom };
        for (int row = 0; row < 3; row++) for (int col = 0; col < 3; col++)
        {
            var target = Rectangle.FromLTRB(targetX[col], targetY[row], targetX[col + 1], targetY[row + 1]);
            if (target.Width <= 0 || target.Height <= 0) continue;
            g.DrawImage(glass, target, sourceX[col], sourceY[row], sourceX[col + 1] - sourceX[col],
                sourceY[row + 1] - sourceY[row], GraphicsUnit.Pixel);
        }
    }

    static double Fraction(double position, double start, double duration)
    {
        if (duration <= 0) return position >= start ? 1 : 0;
        return Math.Max(0, Math.Min(1, (position - start) / duration));
    }

    internal static Color ReadColor(string[] values, int index, Color fallback)
    {
        if (values == null || index >= values.Length || String.IsNullOrWhiteSpace(values[index])) return fallback;
        string value = values[index].Trim();
        if (value[0] == '#') value = value.Substring(1);
        uint color;
        if ((value.Length != 6 && value.Length != 8) ||
            !UInt32.TryParse(value, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out color)) return fallback;
        return Color.FromArgb(unchecked((int)(value.Length == 6 ? color | 0xff000000U : color)));
    }

    void UpdateTimings(DesktopCaptionWord[] words)
    {
        if (Object.ReferenceEquals(lastWords, words)) return;
        lastWords = words;
        bool same = words != null && words.Length == timed.Length;
        for (int i = 0; same && i < words.Length; i++)
            same = words[i] != null && timed[i].Text == words[i].text &&
                timed[i].Time == words[i].startMs && timed[i].Duration == Math.Max(0, words[i].durationMs);
        if (same) return;
        var spans = new List<TimedSpan>();
        int cursor = 0;
        if (words != null) foreach (DesktopCaptionWord word in words)
        {
            if (word == null || String.IsNullOrEmpty(word.text)) continue;
            string token = word.text;
            int start = text.IndexOf(token, cursor, StringComparison.Ordinal);
            if (start < 0)
            {
                token = token.Trim();
                if (token.Length == 0) continue;
                start = text.IndexOf(token, cursor, StringComparison.Ordinal);
            }
            if (start < 0) continue;
            int end = start + token.Length;
            spans.Add(new TimedSpan { Start = start, End = end, Time = word.startMs,
                Duration = Math.Max(0, word.durationMs), Text = word.text });
            cursor = end;
        }
        timed = spans.ToArray();
    }

    double RevealAt(double position, double fraction)
    {
        if (timed.Length == 0) return fraction * text.Length;
        TimedSpan last = timed[timed.Length - 1];
        if (position >= last.Time + last.Duration) return text.Length;
        double result = 0;
        foreach (TimedSpan span in timed)
        {
            if (position < span.Time) break;
            result = span.Start + (span.End - span.Start) * Fraction(position, span.Time, span.Duration);
            if (position < span.Time + span.Duration) break;
        }
        return result;
    }

    int PageFor(double reveal)
    {
        int line = 0;
        for (int i = 1; i < mainLines.Count && mainLines[i].Start <= reveal; i++) line = i;
        return line / 2;
    }

    static int PageCount(List<CaptionLine> lines) { return Math.Max(1, (lines.Count + 1) / 2); }

    void DrawOriginal(Graphics g, CaptionLine line, double reveal)
    {
        if (reveal <= line.Start) { g.DrawImageUnscaled(line.Image, line.ImageLocation); return; }
        if (reveal >= line.End) { g.DrawImageUnscaled(line.Highlight, line.ImageLocation); return; }
        float edge = line.X;
        foreach (Letter letter in line.Letters)
        {
            if (reveal >= letter.End) edge = line.X + letter.Right;
            else if (reveal >= letter.Start)
            {
                edge = line.X + letter.Left + (letter.Right - letter.Left) *
                    (float)((reveal - letter.Start) / Math.Max(1, letter.End - letter.Start));
                break;
            }
            else break;
        }
        Rectangle box = new Rectangle(line.ImageLocation, line.Image.Size);
        edge = line.Vertical ? Math.Max(box.Top, Math.Min(box.Bottom, edge)) : Math.Max(box.Left, Math.Min(box.Right, edge));
        GraphicsState state = g.Save();
        g.SetClip(line.Vertical ? new RectangleF(box.Left, edge, box.Width, box.Bottom - edge) :
            new RectangleF(edge, box.Top, box.Right - edge, box.Height), CombineMode.Intersect);
        g.DrawImageUnscaled(line.Image, line.ImageLocation);
        g.Restore(state);
        state = g.Save();
        g.SetClip(line.Vertical ? new RectangleF(box.Left, box.Top, box.Width, edge - box.Top) :
            new RectangleF(box.Left, box.Top, edge - box.Left, box.Height), CombineMode.Intersect);
        g.DrawImageUnscaled(line.Highlight, line.ImageLocation);
        g.Restore(state);
    }

    void BuildLayout(Graphics g)
    {
        float size = Math.Max(12, Math.Min(72, fontSize > 0 ? fontSize : 28)) * scale;
        float translatedSize = translationFontSize > 0 ? Math.Max(10, Math.Min(48, translationFontSize)) * scale : size * .49f;
        mainFonts = new FontSet(family, size, true);
        translationFonts = new FontSet("Microsoft YaHei UI", translatedSize, false);
        if (vertical) BuildVerticalLayout(g, size, translatedSize);
        else BuildHorizontalLayout(g, size, translatedSize);

        pageBrush = new SolidBrush(Color.FromArgb(133, 173, 199, 196));
        shadowPen = new Pen(Color.FromArgb(100, 0, 5, 10), 3 * scale);
        outlinePen = new Pen(originalStroke, .9f * scale);
        highlightOutline = new Pen(highlightStroke, .9f * scale);
        translationOutline = new Pen(originalStroke, .7f * scale);
        shadowPen.LineJoin = outlinePen.LineJoin = highlightOutline.LineJoin = translationOutline.LineJoin = LineJoin.Round;
        progressTrack = new Pen(Color.FromArgb(highlightTop.A * 37 / 255, highlightTop), .8f * scale);
        progressInk = new Pen(Color.FromArgb(highlightBottom.A * 183 / 255, highlightBottom), 1.1f * scale);
        progressTrack.StartCap = progressTrack.EndCap = progressInk.StartCap = progressInk.EndCap = LineCap.Round;
        pageFont = new Font("Segoe UI", 8 * scale, FontStyle.Regular, GraphicsUnit.Pixel);
        UpdateDecorationColors();
        foreach (CaptionLine line in mainLines) Rasterize(line, true);
        foreach (CaptionLine line in translationLines) Rasterize(line, false);
        mainFonts.Dispose(); mainFonts = null;
        translationFonts.Dispose(); translationFonts = null;
    }

    void BuildHorizontalLayout(Graphics g, float size, float translatedSize)
    {
        float availableWidth = Math.Max(12, bounds.Width - 56 * scale);
        mainLines = Wrap(g, text, mainFonts, availableWidth);
        float translationWidth = Math.Min(availableWidth, Math.Max(230 * scale, Widest(mainLines) + 30 * scale));
        translationLines = Wrap(g, translation, translationFonts, translationWidth);
        mainPitch = Pitch(mainLines, size);
        translationPitch = Pitch(translationLines, translatedSize);
        float total = BlockHeight(mainLines, mainPitch, size) + BlockHeight(translationLines, translationPitch, translatedSize);
        if (mainLines.Count > 0 && translationLines.Count > 0) total += 6 * scale;
        total += FooterHeight();
        int panelWidth = Math.Min(bounds.Width, (int)Math.Ceiling(Math.Max(156 * scale,
            Math.Max(Widest(mainLines), Widest(translationLines)) + 44 * scale)));
        bool split = mainAlignment != secondaryAlignment && mainLines.Count > 0 && translationLines.Count > 0;
        if (split) panelWidth = Math.Min(bounds.Width, Math.Max(panelWidth, bounds.Width - (int)Math.Round(12 * scale)));
        int panelHeight = (int)Math.Ceiling(Math.Max(38 * scale, total + 28 * scale));
        // Let the surface grow instead of silently shrinking either chosen font.
        bounds.Height = Math.Max(bounds.Height, panelHeight);
        int panelLeft = bounds.Left + (bounds.Width - panelWidth) / 2;
        int edge = Math.Min((int)Math.Round(6 * scale), (bounds.Width - panelWidth) / 2);
        if (!split && mainAlignment == 2) panelLeft = bounds.Left + edge;
        else if (!split && mainAlignment == 3) panelLeft = bounds.Right - edge - panelWidth;
        panelBounds = new Rectangle(panelLeft,
            bounds.Top + (bounds.Height - panelHeight) / 2, panelWidth, panelHeight);
        float y = panelBounds.Top + Math.Max(5 * scale, (panelBounds.Height - total) / 2);
        Position(mainLines, y, mainPitch, mainAlignment);
        y += BlockHeight(mainLines, mainPitch, size) + (mainLines.Count > 0 && translationLines.Count > 0 ? 6 * scale : 0);
        Position(translationLines, y, translationPitch, secondaryAlignment);
    }

    void BuildVerticalLayout(Graphics g, float size, float translatedSize)
    {
        float availableHeight = Math.Max(size * 3, bounds.Height - 48 * scale);
        mainLines = WrapVertical(g, text, mainFonts, availableHeight);
        translationLines = WrapVertical(g, translation, translationFonts, availableHeight);
        mainPitch = ColumnPitch(mainLines, size);
        translationPitch = ColumnPitch(translationLines, translatedSize);
        float mainWidth = Math.Min(2, mainLines.Count) * mainPitch;
        float translatedWidth = Math.Min(2, translationLines.Count) * translationPitch;
        float gap = mainWidth > 0 && translatedWidth > 0 ? 9 * scale : 0;
        float contentHeight = Math.Max(Tallest(mainLines), Tallest(translationLines));
        float footer = FooterHeight();
        int panelWidth = (int)Math.Ceiling(Math.Max(76 * scale, mainWidth + translatedWidth + gap + 32 * scale));
        int panelHeight = (int)Math.Ceiling(Math.Max(78 * scale, contentHeight + footer + 32 * scale));
        bool split = mainAlignment != secondaryAlignment && mainWidth > 0 && translatedWidth > 0;
        if (split) panelHeight = Math.Max(panelHeight, bounds.Height - (int)Math.Round(12 * scale));
        // Large, independently sized columns may grow in both dimensions.
        bounds.Width = Math.Max(bounds.Width, panelWidth);
        bounds.Height = Math.Max(bounds.Height, panelHeight);
        panelBounds = new Rectangle(bounds.Left + (bounds.Width - panelWidth) / 2,
            bounds.Top + (bounds.Height - panelHeight) / 2, panelWidth, panelHeight);
        float right = panelBounds.Right - 16 * scale;
        float top = panelBounds.Top + 16 * scale;
        float height = panelBounds.Height - 32 * scale - footer;
        PositionColumns(mainLines, right, mainPitch, top, height, mainAlignment);
        PositionColumns(translationLines, right - mainWidth - gap, translationPitch, top, height, secondaryAlignment);
    }

    static float ColumnPitch(List<CaptionLine> columns, float size)
    {
        return Math.Max(size, Widest(columns)) + size * .22f;
    }

    static float Tallest(List<CaptionLine> columns)
    {
        float height = 0;
        foreach (CaptionLine column in columns) height = Math.Max(height, Math.Max(column.Width, column.Ink.Height));
        return height;
    }

    void PositionColumns(List<CaptionLine> columns, float right, float pitch, float top, float height, int alignment)
    {
        for (int i = 0; i < columns.Count; i++)
        {
            CaptionLine column = columns[i];
            float columnHeight = Math.Max(column.Width, column.Ink.Height);
            float y = top + (height - columnHeight) / 2;
            if (alignment == 2) y = top;
            else if (alignment == 3) y = top + height - columnHeight;
            float x = right - (i % 2 + .5f) * pitch;
            using (var matrix = new Matrix())
            {
                matrix.Translate(x, y);
                column.Path.Transform(matrix);
            }
            column.X = y;
            column.Ink = column.Path.GetBounds();
        }
    }

    List<CaptionLine> WrapVertical(Graphics g, string value, FontSet fonts, float maxHeight)
    {
        var columns = new List<CaptionLine>();
        int[] elements = StringInfo.ParseCombiningCharacters(value);
        CaptionLine column = null;
        float used = 0;
        for (int i = 0; i < elements.Length;)
        {
            int start = elements[i], end = i + 1 < elements.Length ? elements[i + 1] : value.Length;
            string element = value.Substring(start, end - start);
            if (element == "\r" || element == "\n" || element == "\r\n")
            {
                FinishColumn(columns, ref column, ref used);
                i++;
                continue;
            }
            bool whitespace = String.IsNullOrWhiteSpace(element);
            bool sideways = IsSideways(element) || RotateVerticalPunctuation(element);
            int next = i + 1;
            if (IsSideways(element) && !whitespace)
            {
                // Keep a Latin word together and rotate its baseline downwards.
                while (next < elements.Length)
                {
                    int after = next + 1 < elements.Length ? elements[next + 1] : value.Length;
                    string following = value.Substring(elements[next], after - elements[next]);
                    if (String.IsNullOrWhiteSpace(following) || !IsSideways(following)) break;
                    end = after;
                    next++;
                }
            }
            if (column == null && whitespace) { i = next; continue; }
            CaptionLine token = MakeLine(g, value, start, end, fonts);
            if (sideways && token.Width > maxHeight && token.Letters.Count > 1)
            {
                // A word longer than a column breaks only between graphemes.
                int split = token.Letters[0].End;
                foreach (Letter letter in token.Letters)
                {
                    if (letter.Right > maxHeight - fonts.Size * .1f) break;
                    split = letter.End;
                }
                token.Dispose();
                end = split;
                token = MakeLine(g, value, start, end, fonts);
                next = i + 1;
                while (next < elements.Length && elements[next] < end) next++;
            }
            float advance = MakeVerticalToken(token, fonts.Size, sideways, element);
            if (column != null && used + advance > maxHeight)
                FinishColumn(columns, ref column, ref used);
            if (column == null && whitespace) { token.Dispose(); i = next; continue; }
            if (column == null) column = new CaptionLine { Start = token.Start, Vertical = true };
            using (var matrix = new Matrix())
            {
                matrix.Translate(0, used);
                token.Path.Transform(matrix);
            }
            if (token.Path.PointCount > 0) column.Path.AddPath(token.Path, false);
            foreach (Letter letter in token.Letters)
                column.Letters.Add(new Letter { Start = letter.Start, End = letter.End,
                    Left = used + letter.Left, Right = used + letter.Right });
            used += advance;
            column.End = token.End;
            token.Dispose();
            i = next;
        }
        FinishColumn(columns, ref column, ref used);
        return columns;
    }

    static void FinishColumn(List<CaptionLine> columns, ref CaptionLine column, ref float used)
    {
        if (column != null)
        {
            column.Width = used;
            column.Ink = column.Path.GetBounds();
            columns.Add(column);
            column = null;
        }
        used = 0;
    }

    static bool IsSideways(string element)
    {
        char c = element[0];
        if (IsCjk(element) || c >= '\uff01' && c <= '\uffef') return false;
        UnicodeCategory category = CharUnicodeInfo.GetUnicodeCategory(element, 0);
        return c >= '!' && c <= '~' || category == UnicodeCategory.UppercaseLetter ||
            category == UnicodeCategory.LowercaseLetter || category == UnicodeCategory.TitlecaseLetter ||
            category == UnicodeCategory.DecimalDigitNumber;
    }

    static bool RotateVerticalPunctuation(string element)
    {
        return element.Length == 1 && "ーｰ—–…‥（）「」『』〈〉《》【】〔〕〖〗〘〙〚〛".IndexOf(element[0]) >= 0;
    }

    static float MakeVerticalToken(CaptionLine token, float size, bool sideways, string element)
    {
        RectangleF ink = token.Ink;
        float advance;
        if (sideways)
        {
            advance = Math.Max(token.Width, ink.Right) - Math.Min(0, ink.Left) + size * .1f;
            using (var matrix = new Matrix(0, 1, -1, 0, ink.Top + ink.Height / 2, -Math.Min(0, ink.Left)))
                token.Path.Transform(matrix);
            for (int i = 0; i < token.Letters.Count; i++)
            {
                Letter letter = token.Letters[i];
                letter.Left -= Math.Min(0, ink.Left);
                letter.Right -= Math.Min(0, ink.Left);
                token.Letters[i] = letter;
            }
        }
        else
        {
            bool dot = element.Length == 1 && "、。，．｡､".IndexOf(element[0]) >= 0;
            bool whitespace = String.IsNullOrWhiteSpace(element);
            advance = whitespace ? size * .5f : Math.Max(size, ink.Height) + size * .1f;
            using (var matrix = new Matrix())
            {
                matrix.Translate(-ink.Left - ink.Width / 2 + (dot ? size * .26f : 0),
                    -ink.Top + (dot ? size * .08f : Math.Max(0, (size - ink.Height) / 2)));
                token.Path.Transform(matrix);
            }
            token.Letters.Clear();
            token.Letters.Add(new Letter { Start = token.Start, End = token.End, Left = 0, Right = advance });
        }
        return advance;
    }

    void UpdateDecorationColors()
    {
        pageBrush.Color = surfaceColors == null ? Color.FromArgb(133, 173, 199, 196) : Color.FromArgb(205, surfaceColors.Muted);
        progressTrack.Color = surfaceColors == null ? Color.FromArgb(highlightTop.A * 37 / 255, highlightTop) :
            Color.FromArgb(37, surfaceColors.Accent);
        progressInk.Color = surfaceColors == null ? Color.FromArgb(highlightBottom.A * 183 / 255, highlightBottom) :
            Color.FromArgb(183, surfaceColors.Accent);
    }

    float FooterHeight()
    {
        return HasPages ? 12 * scale : text.Length > 0 ? 7 * scale : 0;
    }

    static float Widest(List<CaptionLine> lines)
    {
        float width = 0;
        foreach (CaptionLine line in lines) width = Math.Max(width, line.Ink.Width);
        return width;
    }

    void Rasterize(CaptionLine line, bool original)
    {
        int margin = (int)Math.Ceiling(3 * scale);
        Rectangle box = Rectangle.Ceiling(line.Ink);
        box.Inflate(margin, margin);
        line.ImageLocation = box.Location;
        line.Image = new Bitmap(Math.Max(1, box.Width), Math.Max(1, box.Height), PixelFormat.Format32bppPArgb);
        RectangleF gradientArea = new RectangleF(line.Ink.Left, line.Ink.Top, Math.Max(1, line.Ink.Width), Math.Max(1, line.Ink.Height));
        using (Graphics target = Graphics.FromImage(line.Image))
        using (var originalBrush = new LinearGradientBrush(gradientArea, originalTop, originalBottom, 90))
        {
            target.SmoothingMode = SmoothingMode.AntiAlias;
            target.PixelOffsetMode = PixelOffsetMode.HighQuality;
            target.TranslateTransform(-box.Left, -box.Top);
            if (original)
            {
                if (outlineEnabled) { target.DrawPath(shadowPen, line.Path); target.DrawPath(outlinePen, line.Path); }
                target.FillPath(originalBrush, line.Path);
            }
            else
            {
                if (outlineEnabled) target.DrawPath(translationOutline, line.Path);
                target.FillPath(originalBrush, line.Path);
            }
        }
        if (original)
        {
            line.Highlight = new Bitmap(line.Image.Width, line.Image.Height, PixelFormat.Format32bppPArgb);
            using (Graphics target = Graphics.FromImage(line.Highlight))
            using (var highlightBrush = new LinearGradientBrush(gradientArea, highlightTop, highlightBottom, 90))
            {
                target.SmoothingMode = SmoothingMode.AntiAlias;
                target.PixelOffsetMode = PixelOffsetMode.HighQuality;
                target.TranslateTransform(-box.Left, -box.Top);
                if (outlineEnabled) { target.DrawPath(shadowPen, line.Path); target.DrawPath(highlightOutline, line.Path); }
                target.FillPath(highlightBrush, line.Path);
            }
        }
        line.Path.Dispose();
        line.Path = null;
    }

    static float Pitch(List<CaptionLine> lines, float size)
    {
        float height = size * .85f;
        foreach (CaptionLine line in lines) height = Math.Max(height, line.Ink.Height);
        return height + size * .17f;
    }

    static float BlockHeight(List<CaptionLine> lines, float pitch, float size)
    {
        return lines.Count == 0 ? 0 : Math.Min(2, lines.Count) * pitch - size * .17f;
    }

    void Position(List<CaptionLine> lines, float top, float pitch, int alignment)
    {
        for (int i = 0; i < lines.Count; i++)
        {
            CaptionLine line = lines[i];
            float left = panelBounds.Left + (panelBounds.Width - line.Ink.Width) / 2;
            if (alignment == 2) left = panelBounds.Left + 22 * scale;
            else if (alignment == 3) left = panelBounds.Right - 22 * scale - line.Ink.Width;
            float x = left - line.Ink.Left;
            float y = top + (i % 2) * pitch - line.Ink.Top;
            using (var matrix = new Matrix())
            {
                matrix.Translate(x, y);
                line.Path.Transform(matrix);
            }
            line.X = x;
            line.Ink = line.Path.GetBounds();
        }
    }

    List<CaptionLine> Wrap(Graphics g, string value, FontSet fonts, float maxWidth)
    {
        var lines = new List<CaptionLine>();
        if (value.Length == 0) return lines;
        int start = 0, end = 0, breakAt = -1;
        TextElementEnumerator elements = StringInfo.GetTextElementEnumerator(value);
        while (elements.MoveNext())
        {
            string element = elements.GetTextElement();
            int index = elements.ElementIndex;
            if (element == "\r" || element == "\n" || element == "\r\n")
            {
                if (end > start) lines.Add(MakeLine(g, value, start, end, fonts));
                start = end = index + element.Length; breakAt = -1;
                continue;
            }
            float nextWidth = Measure(g, value.Substring(start, index + element.Length - start), fonts);
            if (nextWidth > maxWidth && end > start)
            {
                int split = breakAt > start ? breakAt : end;
                lines.Add(MakeLine(g, value, start, TrimEnd(value, start, split), fonts));
                start = split;
                while (start < index && Char.IsWhiteSpace(value[start])) start++;
                breakAt = -1;
            }
            end = index + element.Length;
            // Latin words stay together where possible. CJK and oversized words
            // can break at text-element boundaries, so surrogate/combining pairs survive.
            if (Char.IsWhiteSpace(element, 0) || IsCjk(element)) breakAt = end;
        }
        if (end > start) lines.Add(MakeLine(g, value, start, TrimEnd(value, start, end), fonts));
        return lines;
    }

    static int TrimEnd(string value, int start, int end)
    {
        while (end > start && Char.IsWhiteSpace(value[end - 1])) end--;
        return end;
    }

    static bool IsCjk(string element)
    {
        char c = element[0];
        return c >= '\u2e80' && c <= '\ua4cf' || c >= '\uac00' && c <= '\ud7af' || c >= '\uf900' && c <= '\ufaff';
    }

    float Measure(Graphics g, string value, FontSet fonts)
    {
        float width = 0;
        WalkRuns(value, fonts, delegate(string run, int start, Face face)
        {
            width += g.MeasureString(run, face.Font, Int32.MaxValue, format).Width;
        });
        return width;
    }

    CaptionLine MakeLine(Graphics g, string source, int start, int end, FontSet fonts)
    {
        var line = new CaptionLine { Start = start, End = end };
        string value = source.Substring(start, end - start);
        float x = 0;
        WalkRuns(value, fonts, delegate(string run, int offset, Face face)
        {
            using (var path = new GraphicsPath())
            {
                path.AddString(run, face.Family, (int)face.Style, fonts.Size, new PointF(0, 0), format);
                using (var matrix = new Matrix())
                {
                    if (face.Slant) matrix.Shear(-.09f, 0);
                    matrix.Translate(x, 0, MatrixOrder.Append);
                    path.Transform(matrix);
                }
                if (path.PointCount > 0) line.Path.AddPath(path, false);
            }
            TextElementEnumerator elements = StringInfo.GetTextElementEnumerator(run);
            float previous = 0;
            while (elements.MoveNext())
            {
                int a = elements.ElementIndex, b = a + elements.GetTextElement().Length;
                float right = g.MeasureString(run.Substring(0, b), face.Font, Int32.MaxValue, format).Width;
                line.Letters.Add(new Letter { Start = start + offset + a, End = start + offset + b,
                    Left = x + previous, Right = x + right });
                previous = right;
            }
            x += g.MeasureString(run, face.Font, Int32.MaxValue, format).Width;
        });
        line.Width = x;
        line.Ink = line.Path.PointCount > 0 ? line.Path.GetBounds() : new RectangleF(0, 0, x, fonts.Size);
        return line;
    }

    static void WalkRuns(string value, FontSet fonts, Action<string, int, Face> visit)
    {
        TextElementEnumerator elements = StringInfo.GetTextElementEnumerator(value);
        Face current = null;
        int start = 0;
        while (elements.MoveNext())
        {
            Face face = fonts.Pick(elements.GetTextElement());
            if (current != null && face != current)
            {
                visit(value.Substring(start, elements.ElementIndex - start), start, current);
                start = elements.ElementIndex;
            }
            current = face;
        }
        if (current != null) visit(value.Substring(start), start, current);
    }

    static string ResolveFamily(string value)
    {
        switch (value ?? "")
        {
            case "": case "system": value = "Microsoft YaHei UI"; break;
            case "song": case "serif": value = "宋体"; break;
            case "kai": value = "楷体"; break;
            case "xingkai": value = "华文行楷"; break;
            case "youyuan": value = "幼圆"; break;
            case "corsiva": case "xinwei": value = "Monotype Corsiva"; break;
            case "baskerville": case "lishu": value = "Baskerville Old Face"; break;
            case "rockwell": case "zhongsong": value = "Rockwell"; break;
        }
        try { using (var check = new FontFamily(value)) return check.Name; }
        catch (ArgumentException) { return "Microsoft YaHei UI"; }
    }

    static Bitmap BuildGlass(Size size, float scale, SurfaceColors colors)
    {
        var bitmap = new Bitmap(size.Width, size.Height, PixelFormat.Format32bppPArgb);
        byte[] pixels = new byte[size.Width * 4];
        BitmapData data = bitmap.LockBits(new Rectangle(Point.Empty, size), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
        float radius = Math.Min(14 * scale, size.Height / 2f);
        float feather = Math.Max(1, 1.3f * scale);
        float halfWidth = size.Width / 2f - 5 * scale;
        float halfHeight = size.Height / 2f - 5 * scale;
        try
        {
            for (int y = 0; y < size.Height; y++)
            {
                float vertical = y / (float)Math.Max(1, size.Height - 1);
                for (int x = 0; x < size.Width; x++)
                {
                    float dx = Math.Abs(x + .5f - size.Width / 2f) - halfWidth + radius;
                    float dy = Math.Abs(y + .5f - size.Height / 2f) - halfHeight + radius;
                    float distance = (float)Math.Sqrt(Math.Max(dx, 0) * Math.Max(dx, 0) + Math.Max(dy, 0) * Math.Max(dy, 0)) + Math.Min(Math.Max(dx, dy), 0) - radius;
                    float opacity = Math.Max(0, Math.Min(1, .5f - distance / feather));
                    opacity = opacity * opacity * (3 - 2 * opacity);
                    float shadowY = Math.Abs(y + .5f - size.Height / 2f - 1.6f * scale) - halfHeight + radius;
                    float shadowDistance = Math.Max(0, (float)Math.Sqrt(Math.Max(dx, 0) * Math.Max(dx, 0) +
                        Math.Max(shadowY, 0) * Math.Max(shadowY, 0)) + Math.Min(Math.Max(dx, shadowY), 0) - radius);
                    float edgeFade = Math.Max(0, Math.Min(1, Math.Min(Math.Min(x, size.Width - x - 1),
                        Math.Min(y, size.Height - y - 1)) / (2 * scale)));
                    float shadowAlpha = 29 * (float)Math.Exp(-shadowDistance * shadowDistance / (11 * scale * scale)) * edgeFade;
                    float bodyAlpha = (181 + 17 * vertical) * opacity;
                    float alpha = bodyAlpha + shadowAlpha * (1 - bodyAlpha / 255);
                    float rimAlpha = (float)Math.Exp(-distance * distance / (.38f * scale * scale)) * (25 - 13 * vertical);
                    float topLight = (1 - vertical) * (1 - vertical);
                    float bodyBlue = colors == null ? 27 + 9 * topLight : colors.Background.B + (colors.Foreground.B - colors.Background.B) * .065f * topLight;
                    float bodyGreen = colors == null ? 22 + 8 * topLight : colors.Background.G + (colors.Foreground.G - colors.Background.G) * .065f * topLight;
                    float bodyRed = colors == null ? 17 + 7 * topLight : colors.Background.R + (colors.Foreground.R - colors.Background.R) * .065f * topLight;
                    float blue = (bodyBlue * bodyAlpha + 8 * shadowAlpha * (1 - bodyAlpha / 255)) / 255;
                    float green = (bodyGreen * bodyAlpha + 6 * shadowAlpha * (1 - bodyAlpha / 255)) / 255;
                    float red = (bodyRed * bodyAlpha + 3 * shadowAlpha * (1 - bodyAlpha / 255)) / 255;
                    blue = blue * (1 - rimAlpha / 255) + (colors == null ? 193 : colors.Accent.B) * rimAlpha / 255;
                    green = green * (1 - rimAlpha / 255) + (colors == null ? 190 : colors.Accent.G) * rimAlpha / 255;
                    red = red * (1 - rimAlpha / 255) + (colors == null ? 166 : colors.Accent.R) * rimAlpha / 255;
                    alpha += rimAlpha * (1 - alpha / 255);
                    int p = x * 4;
                    pixels[p] = (byte)blue;
                    pixels[p + 1] = (byte)green;
                    pixels[p + 2] = (byte)red;
                    pixels[p + 3] = (byte)alpha;
                }
                Marshal.Copy(pixels, 0, IntPtr.Add(data.Scan0, y * data.Stride), pixels.Length);
            }
        }
        finally { bitmap.UnlockBits(data); }
        return bitmap;
    }

    void ClearText()
    {
        if (mainLines != null) { foreach (CaptionLine line in mainLines) line.Dispose(); mainLines = null; }
        if (translationLines != null) { foreach (CaptionLine line in translationLines) line.Dispose(); translationLines = null; }
        if (mainFonts != null) { mainFonts.Dispose(); mainFonts = null; }
        if (translationFonts != null) { translationFonts.Dispose(); translationFonts = null; }
    }

    void ClearLayout()
    {
        ClearText();
        if (pageBrush != null) { pageBrush.Dispose(); pageBrush = null; }
        if (shadowPen != null) { shadowPen.Dispose(); shadowPen = null; }
        if (outlinePen != null) { outlinePen.Dispose(); outlinePen = null; }
        if (highlightOutline != null) { highlightOutline.Dispose(); highlightOutline = null; }
        if (translationOutline != null) { translationOutline.Dispose(); translationOutline = null; }
        if (progressTrack != null) { progressTrack.Dispose(); progressTrack = null; }
        if (progressInk != null) { progressInk.Dispose(); progressInk = null; }
        if (pageFont != null) { pageFont.Dispose(); pageFont = null; }
    }

    internal void Clear()
    {
        ClearLayout();
        if (glass != null) { glass.Dispose(); glass = null; }
        text = translation = "";
        lastWords = null;
        if (timed.Length > 0) timed = new TimedSpan[0];
    }

    public void Dispose() {
        Clear();
        format.Dispose(); pageFormat.Dispose();
    }
}
