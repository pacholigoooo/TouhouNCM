using System;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

// One receive loop serves replies and renderer wake events, including while the
// native surfaces are closed. Requests remain serialized by MiniSession.
internal sealed class NativeCdpConnection : IDisposable
{
    internal const string WakeBinding = "__pachiNcmImmersiveNativeWake";
    readonly ClientWebSocket socket = new ClientWebSocket();
    readonly CancellationTokenSource lifetime = new CancellationTokenSource();
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 };
    readonly Action<string> wake;
    Task receiver;
    TaskCompletionSource<Dictionary<string, object>> reply;
    int sequence, pendingId;
    bool disposed, needsRebind;

    internal NativeCdpConnection(Action<string> wake)
    {
        this.wake = wake;
        socket.Options.Proxy = null;
    }

    internal bool IsOpen { get { return !disposed && socket.State == WebSocketState.Open; } }
    internal bool NeedsRebind { get { return needsRebind; } }

    internal async Task Connect(Uri endpoint, CancellationToken token)
    {
        await socket.ConnectAsync(endpoint, token);
        receiver = Receive();
        await Request("Page.enable", new { }, token);
        await Request("Runtime.addBinding", new { name = WakeBinding }, token);
    }

    internal async Task<string> Evaluate(string expression, CancellationToken token)
    {
        var result = await Request("Runtime.evaluate", new { expression, returnByValue = true, awaitPromise = true }, token);
        return Launch.ReadEvaluationResult(result);
    }

    internal async Task RemoveBinding(CancellationToken token)
    {
        await Request("Runtime.removeBinding", new { name = WakeBinding }, token);
    }

    internal async Task<bool> ReclaimIdleMemory(CancellationToken token)
    {
        // Recheck visibility in the renderer in case the window was restored
        // while this request was waiting. Style rules and playback stay intact.
        string reclaimed = await Evaluate("String(window.__pachiImmersive?.reclaimNativeStyleCache?.() === true)", token);
        if (reclaimed != "true") return false;
        await Request("Memory.simulatePressureNotification", new { level = "moderate" }, token);
        return true;
    }

    internal async Task RebindIfNeeded(CancellationToken token)
    {
        if (!needsRebind) return;
        needsRebind = false;
        // A new page context needs a fresh function. Re-adding an active name
        // alone is a no-op in CEF 91, so remove it first.
        await RemoveBinding(token);
        await Request("Runtime.addBinding", new { name = WakeBinding }, token);
    }

    async Task<Dictionary<string, object>> Request(string method, object parameters, CancellationToken token)
    {
        var completion = new TaskCompletionSource<Dictionary<string, object>>();
        int id = ++sequence;
        pendingId = id;
        reply = completion;
        try
        {
            using (token.Register(() => completion.TrySetCanceled()))
            {
                byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(new { id, method, @params = parameters }));
                await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, token);
                var response = await completion.Task;
                if (response.ContainsKey("error")) throw new InvalidOperationException("网易云原生窗口连接失败，请重新打开沉浸听歌入口。");
                return response;
            }
        }
        finally { if (reply == completion) reply = null; }
    }

    async Task Receive()
    {
        byte[] buffer = new byte[8192];
        try
        {
            while (!disposed && socket.State == WebSocketState.Open)
            {
                Dictionary<string, object> message;
                using (var output = new MemoryStream())
                {
                    WebSocketReceiveResult part;
                    do
                    {
                        part = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), lifetime.Token);
                        if (part.MessageType == WebSocketMessageType.Close)
                            throw new WebSocketException("网易云渲染页面已断开连接。");
                        output.Write(buffer, 0, part.Count);
                    } while (!part.EndOfMessage);
                    message = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(output.GetBuffer(), 0, checked((int)output.Length)));
                }
                object value;
                if (message.TryGetValue("id", out value))
                {
                    if (Convert.ToInt32(value) == pendingId && reply != null) reply.TrySetResult(message);
                }
                else if (message.TryGetValue("method", out value) && (string)value == "Runtime.bindingCalled")
                {
                    var parameters = (Dictionary<string, object>)message["params"];
                    if ((string)parameters["name"] == WakeBinding) wake((string)parameters["payload"]);
                }
                else if ((string)value == "Page.frameNavigated")
                {
                    var parameters = (Dictionary<string, object>)message["params"];
                    var frame = (Dictionary<string, object>)parameters["frame"];
                    if (!frame.ContainsKey("parentId"))
                    {
                        needsRebind = true;
                        wake("context");
                    }
                }
            }
        }
        catch (Exception error)
        {
            if (reply != null) reply.TrySetException(error);
            if (!disposed) socket.Abort();
        }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        lifetime.Cancel();
        socket.Dispose();
        if (reply != null) reply.TrySetCanceled();
        lifetime.Dispose();
    }
}
