// Reuse the colors NetEase has already calculated for the playing artwork.
function setMinibarPalette(rgb, style) {
  if (!rgb) {
    style.removeProperty("--ncm-player-tint");
    style.removeProperty("--ncm-player-accent");
    return;
  }
  style.setProperty("--ncm-player-tint", "rgba(" + rgb.join(",") + ", .16)");
  // A midtone keeps the white transport icon and the thin seek track legible.
  const peak = Math.max(...rgb);
  const factor = peak > 0 ? Math.min(1, 158 / peak) : 1;
  const accent = rgb.map(value => Math.round(value * factor * .84 + 22));
  style.setProperty("--ncm-player-accent", "rgb(" + accent.join(",") + ")");
}

// The shell and the native mini player share one small copy of the loaded cover.
function createGlassArtwork() {
  const root = document.documentElement;
  // Native ThemeProvider replaces the entire html style attribute on skin
  // changes. Keep our cover and minibar tokens in their own stylesheet.
  const sheet = document.createElement("style");
  sheet.id = "ncm-immersive-artwork-style";
  document.head.appendChild(sheet);
  sheet.sheet.insertRule("html[data-ncm-skin] {}", 0);
  const palette = sheet.sheet.cssRules[0].style;
  const layer = document.createElement("div");
  layer.id = "ncm-glass-backdrop";
  layer.setAttribute("aria-hidden", "true");
  document.body.prepend(layer);
  let artworkKey = "", thumbnail = "";
  function syncTone() {
    const value = getComputedStyle(root).getPropertyValue("--colorBackground");
    const rgb = value.match(/[\d.]+/g);
    const dark = rgb && (+rgb[0] * .213 + +rgb[1] * .715 + +rgb[2] * .072) < 130;
    const tone = dark ? "dark" : "light";
    if (root.dataset.ncmGlassTone !== tone) root.dataset.ncmGlassTone = tone;
  }
  const observer = new MutationObserver(syncTone);
  observer.observe(root, {attributes:true,attributeFilter:["style","class","data-theme"]});
  syncTone();
  function update(image, key) {
    artworkKey = thumbnail = "";
    if (image && image.naturalWidth) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 96;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, 96, 96);
        const url = canvas.toDataURL("image/jpeg", .83);
        thumbnail = url.slice(url.indexOf(",") + 1);
        artworkKey = key;
        palette.setProperty("--ncm-artwork-image", 'url("' + url + '")');
        // Reuse the thumbnail when the native player has no topColor metadata.
        const pixels = context.getImageData(0, 0, 96, 96).data, sum = [0, 0, 0];
        let samples = 0;
        for (let i = 0; i < pixels.length; i += 64) {
          if (pixels[i + 3] < 128) continue;
          for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[i + channel];
          samples++;
        }
        if (samples) {
          const rgb = sum.map(value => value / samples);
          palette.setProperty("--ncm-artwork-panel-rgb", rgb.map(value => Math.round(value * .28 + 14)).join(","));
          palette.setProperty("--ncm-artwork-panel-accent", "rgb(" + rgb.map(value => Math.round(value * .18 + 205)).join(",") + ")");
        } else {
          palette.removeProperty("--ncm-artwork-panel-rgb");
          palette.removeProperty("--ncm-artwork-panel-accent");
        }
        return;
      } catch (_) { /* Some local covers only permit display in their original renderer. */ }
    }
    palette.removeProperty("--ncm-artwork-image");
    palette.removeProperty("--ncm-artwork-panel-rgb");
    palette.removeProperty("--ncm-artwork-panel-accent");
  }
  return {
    update, palette, get key(){return artworkKey;}, get thumbnail(){return thumbnail;},
    destroy(){ observer.disconnect(); layer.remove(); sheet.remove(); root.removeAttribute("data-ncm-glass-tone"); artworkKey = thumbnail = ""; }
  };
}

function makeMiniSnapshot(bridge, glass, getPalette = () => null) {
  return knownImage => {
    const state = bridge.getSnapshot(), track = state.track, playback = state.playback;
    const key = glass.key === track?.coverUrl ? glass.key : "";
    return JSON.stringify({
      title: track?.title || "", artist: (track?.artists || []).join(" / "),
      position: Math.round(playback.positionMs || 0), duration: Math.round(playback.durationMs || 0),
      playing: playback.state === "playing", artworkKey: key, palette: getPalette(),
      artwork: key && key !== knownImage ? glass.thumbnail : ""
    });
  };
}
