using System;
using System.Drawing;
using System.Globalization;

// Shared by both native surfaces and their JSON snapshots.
public sealed class SurfacePalette
{
    public string id { get; set; }
    public string background { get; set; }
    public string foreground { get; set; }
    public string muted { get; set; }
    public string accent { get; set; }
    public string accentText { get; set; }

    internal static bool Same(SurfacePalette a, SurfacePalette b)
    {
        return Object.ReferenceEquals(a, b) || a != null && b != null &&
            a.id == b.id && a.background == b.background && a.foreground == b.foreground &&
            a.muted == b.muted && a.accent == b.accent && a.accentText == b.accentText;
    }
}

// Resolve only when a palette changes; playback frames reuse these colors.
internal sealed class SurfaceColors
{
    internal readonly Color Background, Foreground, Muted, Accent, AccentText;

    internal SurfaceColors(SurfacePalette palette)
    {
        Background = Read(palette.background);
        Foreground = Read(palette.foreground);
        Muted = Read(palette.muted);
        Accent = Read(palette.accent);
        AccentText = Read(palette.accentText);
    }

    static Color Read(string value)
    {
        return Color.FromArgb(unchecked((int)(UInt32.Parse(value.Substring(1), NumberStyles.HexNumber,
            CultureInfo.InvariantCulture) | 0xff000000U)));
    }

    internal static Color Blend(Color from, Color to, float amount)
    {
        return Color.FromArgb((int)(from.R + (to.R - from.R) * amount),
            (int)(from.G + (to.G - from.G) * amount), (int)(from.B + (to.B - from.B) * amount));
    }
}
