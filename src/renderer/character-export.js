(function (host) {
  "use strict";
  const WIDTH = 1080, HEIGHT = 1440, MAX_BASE64 = 8 * 1024 * 1024, CHUNK = 65536;
  const FONT = '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif';
  let pending = null, nativeSession = "", heartbeat = 0, serial = 0;
  const text = value => String(value == null ? "" : value).trim();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const fileName = character => "TouhouNCM-" + text(character).replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/[. ]+$/g, "").slice(0, 70) + ".png";

  async function loadPortrait(art) {
    const url = art.dataUrl || (await nativeRequest({ kind: "portrait", resource: art.resource })).dataUrl;
    return new Promise((resolve, reject) => {
      const image = new host.Image();
      image.onload = () => { image.onload = image.onerror = null; resolve(image); };
      image.onerror = () => { image.onload = image.onerror = null; image.src = ""; reject(new Error("角色图片加载失败，请重新导出。")); };
      image.src = url;
    });
  }

  async function background(ctx, art, color) {
    ctx.fillStyle = color.background; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const glow = ctx.createRadialGradient(940, 310, 30, 940, 310, 1050);
    glow.addColorStop(0, color.glow); glow.addColorStop(1, color.background);
    ctx.fillStyle = glow; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    if (!art?.dataUrl && !art?.resource) throw new Error("当前构建未包含角色立绘，请按仓库的素材说明补齐后导出。");
    const portrait = await loadPortrait(art);
    const placement = art.placement || {};
    const scale = Math.min(980 / portrait.naturalWidth, 1320 / portrait.naturalHeight, 1.6) * (placement.scale || 1);
    const width = portrait.naturalWidth * scale, height = portrait.naturalHeight * scale;
    const layer = host.document.createElement("canvas");
    layer.width = portrait.naturalWidth; layer.height = portrait.naturalHeight;
    const picture = layer.getContext("2d");
    picture.drawImage(portrait, 0, 0);
    if (art.framing !== "full-body") {
      picture.globalCompositeOperation = "destination-in";
      for (const end of [[layer.width, 0], [0, layer.height]]) {
        const edge = picture.createLinearGradient(0, 0, ...end);
        edge.addColorStop(0, "#0000"); edge.addColorStop(.06, "#000");
        edge.addColorStop(.94, "#000"); edge.addColorStop(1, "#0000");
        picture.fillStyle = edge; picture.fillRect(0, 0, layer.width, layer.height);
      }
    }
    ctx.save(); ctx.globalAlpha = .4; ctx.filter = "blur(2px)";
    ctx.drawImage(layer, WIDTH - width + 80 + (placement.x || 0), HEIGHT - height + 50 + (placement.y || 0), width, height);
    ctx.restore();
    layer.width = layer.height = 0;
    portrait.src = "";
    const veil = ctx.createLinearGradient(0, 0, WIDTH, 0);
    veil.addColorStop(0, color.background + "8c");
    veil.addColorStop(.5, color.background + "45");
    veil.addColorStop(1, color.background + "0f");
    ctx.fillStyle = veil; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const fade = ctx.createLinearGradient(0, 1040, 0, 1330);
    fade.addColorStop(0, color.background + "00");
    fade.addColorStop(1, color.background + "ff");
    ctx.fillStyle = fade; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function profileFor(profiles, character) {
    return text(profiles?.[character]?.description);
  }

  function lines(ctx, value, width, limit) {
    const output = [], paragraphs = text(value).split(/\r?\n/);
    for (const paragraph of paragraphs) {
      let line = "";
      for (const char of Array.from(paragraph)) {
        if (line && ctx.measureText(line + char).width > width) {
          const tail = Array.from(line);
          const carry = /[，。！？；：、）》」』】…]/u.test(char) && tail.length > 1 ? tail.pop() : "";
          output.push(tail.join("").trim()); line = carry + char;
        }
        else line += char;
      }
      if (line.trim()) output.push(line.trim());
    }
    if (output.length > limit) {
      output.length = limit;
      let last = output[limit - 1];
      while (last && ctx.measureText(last + "…").width > width) last = Array.from(last).slice(0, -1).join("");
      output[limit - 1] = last + "…";
    }
    return output;
  }

  function representativeRows(result) {
    const eligible = (result.rows || []).filter(row => row.matches?.length), selected = [];
    for (const rank of result.ranking.slice(0, 3)) {
      const count = rank === result.ranking[0] ? 2 : 1;
      const weight = row => row.matches.filter(match => match.character === rank.character).reduce((sum, match) => sum + number(match.contribution), 0);
      eligible.filter(row => row.matches.some(match => match.character === rank.character)).sort((a, b) => weight(b) - weight(a)).slice(0, count).forEach(row => {
        if (!selected.some(item => item.track.id === row.track.id)) selected.push(row);
      });
    }
    for (const row of eligible) {
      if (selected.length >= 4) break;
      if (!selected.some(item => item.track.id === row.track.id)) selected.push(row);
    }
    return selected.slice(0, 4);
  }

  async function create(result, profiles) {
    if (!result?.ranking?.length) throw new Error("先完成角色测试，再导出结果图片。");
    const winner = result.ranking[0].character;
    const color = host.NcmCharacterPalettes[winner], art = host.NcmCharacterArt[winner];
    const canvas = host.document.createElement("canvas"); canvas.width = WIDTH; canvas.height = HEIGHT;
    const ctx = canvas.getContext("2d"), left = 80, right = 1000, width = right - left, textWidth = width;
    await background(ctx, art, color);
    ctx.textBaseline = "top";
    const font = (size, weight = 400) => { ctx.font = weight + " " + size + "px " + FONT; };
    const write = (value, x, y, size, ink = color.foreground, weight = 400) => { font(size, weight); ctx.fillStyle = ink; ctx.fillText(text(value), x, y); };
    const rule = y => { ctx.fillStyle = color.foreground; ctx.globalAlpha = .16; ctx.fillRect(left, y, width, 1); ctx.globalAlpha = 1; };
    const drawLines = (rows, y, size, lineHeight, ink, weight = 400) => { rows.forEach((line, index) => write(line, left, y + index * lineHeight, size, ink, weight)); return y + rows.length * lineHeight; };

    write("TouhouNCM", left, 64, 32, color.foreground, 650);
    font(20); ctx.fillStyle = color.muted; ctx.textAlign = "right";
    ctx.fillText("听歌角色测试", right, 74); ctx.textAlign = "left";
    rule(126);
    write("你的听歌角色是", left, 164, 25, color.muted);
    let nameSize = 72;
    font(nameSize, 650);
    while (ctx.measureText(text(winner)).width > textWidth * 2 && nameSize > 58) { nameSize -= 4; font(nameSize, 650); }
    const nameLines = lines(ctx, winner, textWidth, 2);
    let y = drawLines(nameLines, 209, nameSize, nameSize + 10, color.foreground, 650) + 18;
    const description = profileFor(profiles, winner);
    if (description) { font(24); y = drawLines(lines(ctx, description, 800, 4), y, 24, 36, color.muted) + 20; }
    const similarity = text(result.ranking[0].summary);
    if (similarity) {
      font(24); y = drawLines(lines(ctx, similarity, width, 4), y, 24, 34, color.foreground) + 16;
    }
    y += 20;
    write(result.version >= 3 ? "听感契合度" : "与你相近的角色", left, y, 25, color.foreground, 600); y += 49;
    result.ranking.slice(0, 3).forEach((rank, index) => {
      const percentage = Math.max(0, Math.min(100, number(rank.percentage)));
      write(String(index + 1).padStart(2, "0"), left, y + 2, 20, color.muted);
      font(25, 550); const names = lines(ctx, rank.character, textWidth - 160, 2);
      names.forEach((line, lineIndex) => write(line, left + 40, y + lineIndex * 32, 25, color.foreground, 550));
      const rowHeight = Math.max(70, names.length * 32 + 28);
      ctx.textAlign = "right"; write(percentage.toFixed(1) + "%", left + textWidth, y, 26, color.accent, 600);
      ctx.textAlign = "left";
      ctx.globalAlpha = .14; ctx.fillStyle = color.accent; ctx.fillRect(left + 40, y + rowHeight - 18, textWidth - 40, 3); ctx.globalAlpha = 1;
      ctx.fillRect(left + 40, y + rowHeight - 18, (textWidth - 40) * percentage / 100, 3); y += rowHeight;
    });
    y += 28; rule(y); y += 29;
    write(result.version >= 3 ? "代表曲目与听感" : "代表曲目与原曲", left, y, 25, color.foreground, 600); y += 48;
    const rows = representativeRows(result).map(row => {
      font(24, 550); const titles = lines(ctx, row.track.title, width, 2);
      const kindLabels = { theme: "主题曲", stage: "关卡关联", work: "作品关联" };
      const kinds = [...new Set(row.matches.map(match => kindLabels[match.kind]).filter(Boolean))];
      const relation = result.version >= 3 ? (row.features?.labels || []).join(" · ")
        : (kinds.length ? kinds.join(" / ") + " · " : "") + [...new Set(row.matches.map(match => match.original || match.theme).filter(Boolean))].join(" / ") + "  →  " + [...new Set(row.matches.map(match => match.character))].join(" / ");
      font(20); const origins = lines(ctx, relation, width, 2);
      return { titles, origins, height: titles.length * 32 + origins.length * 28 + 23 };
    });
    const available = HEIGHT - 100 - y;
    while (rows.length > 3 && rows.reduce((sum, row) => sum + row.height, 0) > available) rows.pop();
    const compactLines = (items, size, weight) => {
      if (items.length < 2) return items;
      font(size, weight);
      let first = items[0];
      while (first && ctx.measureText(first + "…").width > width) first = Array.from(first).slice(0, -1).join("");
      return [first + "…"];
    };
    if (rows.reduce((sum, row) => sum + row.height, 0) > available) rows.forEach(row => {
      row.titles = compactLines(row.titles, 24, 550); row.height = 32 + row.origins.length * 28 + 23;
    });
    if (rows.reduce((sum, row) => sum + row.height, 0) > available) rows.forEach(row => {
      row.origins = compactLines(row.origins, 20, 400); row.height = row.titles.length * 32 + 28 + 23;
    });
    for (const row of rows) {
      y = drawLines(row.titles, y, 24, 32, color.foreground, 550);
      y = drawLines(row.origins, y + 2, 20, 28, color.muted) + 21;
    }
    rule(HEIGHT - 85);
    font(18);
    write(lines(ctx, "资料：THBWiki · 绘图：" + art.credit, 740, 1)[0], left, HEIGHT - 59, 18, color.muted);
    const date = new Date(result.createdAt || Date.now());
    ctx.textAlign = "right"; write(date.toLocaleDateString("zh-CN"), right, HEIGHT - 59, 18, color.muted); ctx.textAlign = "left";
    const dataUrl = canvas.toDataURL("image/png");
    canvas.width = canvas.height = 0;
    return { dataUrl, width: WIDTH, height: HEIGHT, fileName: fileName(winner) };
  }

  function finish(id, result) {
    if (!pending || pending.id !== id) return false;
    const request = pending; pending = null; host.clearInterval(request.watch);
    if (result.error) request.reject(new Error(result.error));
    else request.resolve(result);
    return true;
  }
  function nativeReady(session) {
    if (nativeSession && nativeSession !== session && pending) finish(pending.id, { error: "图片保存通道已重启，请重试。" });
    nativeSession = session; heartbeat = Date.now();
  }
  function nativeRequest(payload) {
    if (pending) return Promise.reject(new Error("另一张图片正在保存，请先完成另存为。"));
    if (!nativeSession || Date.now() - heartbeat > 5000) return Promise.reject(new Error("图片保存通道尚未连接，请重新打开 TouhouNCM 入口。"));
    return new Promise((resolve, reject) => {
      const id = nativeSession + ":" + (++serial);
      pending = { ...payload, id, resolve, reject, claimed: false,
        watch: host.setInterval(() => { if (pending?.id === id && Date.now() - heartbeat > 8000) finish(id, { error: "图片保存通道已断开，请重新打开入口后重试。" }); }, 2000) };
    });
  }
  function save(image) {
    const url = text(image?.dataUrl);
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) return Promise.reject(new Error("只能导出 PNG 结果图片。"));
    const data = url.slice(url.indexOf(",") + 1);
    if (data.length > MAX_BASE64) return Promise.reject(new Error("结果图片过大，请重新生成。"));
    return nativeRequest({ kind: "png", fileName: text(image.fileName) || fileName("角色测试"), data });
  }
  function takeRequest() {
    if (!pending || pending.claimed) return null;
    pending.claimed = true;
    return { id: pending.id, kind: pending.kind, resource: pending.resource, fileName: pending.fileName, length: pending.data?.length || 0 };
  }
  function readChunk(id, offset) {
    if (!pending || pending.id !== id || !pending.claimed || pending.kind !== "png" || !Number.isSafeInteger(offset) || offset < 0 || offset >= pending.data.length) return null;
    return pending.data.slice(offset, offset + CHUNK);
  }
  function dispose() { if (pending) finish(pending.id, { error: "导出已取消。" }); nativeSession = ""; heartbeat = 0; }
  host.NcmCharacterExport = { create, save, nativeReady, takeRequest, readChunk, finish, dispose };
})(window);
