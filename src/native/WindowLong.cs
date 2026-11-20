using System;
using System.Runtime.InteropServices;

internal static class WindowLong
{
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    static extern int Get32(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    static extern int Set32(IntPtr window, int index, int value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    static extern IntPtr Get64(IntPtr window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    static extern IntPtr Set64(IntPtr window, int index, IntPtr value);

    internal static IntPtr Read(IntPtr window, int index)
    {
        return IntPtr.Size == 8 ? Get64(window, index) : new IntPtr(Get32(window, index));
    }

    internal static void Write(IntPtr window, int index, IntPtr value)
    {
        if (IntPtr.Size == 8) Set64(window, index, value);
        else Set32(window, index, value.ToInt32());
    }
}
