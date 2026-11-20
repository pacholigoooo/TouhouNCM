const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const cp = require("node:child_process");
const vm = require("node:vm");

// Embed the UI in the launcher, so the installed version needs only Windows/.NET.
const root = path.resolve(__dirname, "..");
const renderer = path.join(root, "src/renderer");
const read = name => fs.readFileSync(path.join(renderer, name), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const config = { version: pkg.version, repository: "pacholigoooo/TouhouNCM" };
const clientApi = read("client-api.js"), updates = read("updates.js");
const bridge = read("bridge.js"), view = read("view.js"), dialogs = read("dialogs.js");
const themeCss = read("touhou-themes.css");
const css = [read("view.css"), themeCss, read("origin-card.css"), read("character-quiz.css")].join("\n");
const minibar = read("minibar.js");
const desktopLyrics = read("desktop-lyrics.js");
const captionSettings = read("caption-settings.js");
const captionMenu = read("caption-menu.js");
const simplify = read("simplify.js");
const headerEntry = read("header-entry.js");
const touhouThemes = read("touhou-themes.js"), originClient = read("touhou-origin.js"), originCard = read("origin-card.js");
const touhouNames = read("touhou-names.js"), originDiscovery = read("origin-discovery.js");
const characterQuiz = read("character-quiz.js");
const characterProfiles = read("character-profiles.js"), characterExport = read("character-export.js");
const characterPalettes = read("character-palettes.js");
const characterAffinities = read("character-affinities.js"), characterMusic = read("character-music.js");
const artManifest = JSON.parse(fs.readFileSync(path.join(root, "assets/characters/manifest.json"), "utf8"));
const characterData = { window: {} };
vm.runInNewContext(characterProfiles + "\n" + characterPalettes + "\n" + characterAffinities, characterData);
for (const character of Object.keys(characterData.window.NcmCharacterProfiles)) {
  if (!artManifest[character] || !characterData.window.NcmCharacterPalettes[character] || !characterData.window.NcmCharacterAffinities[character]) throw new Error("角色数据或导出素材未齐全：" + character);
}
const artResources = new Map();
const characterArt = "window.NcmCharacterArt = " + JSON.stringify(Object.fromEntries(Object.entries(artManifest).map(([character, art]) => {
  if (process.argv.includes("--without-art")) return [character, { credit: art.credit, sourceUrl: art.sourceUrl }];
  const file = path.join(root, "assets/characters", art.file);
  if (!fs.existsSync(file)) throw new Error("缺少角色素材 " + file + "；请按 docs/assets.md 准备素材，或用 --without-art 构建纯代码版。");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
  const resource = "character-art." + digest + path.extname(art.file);
  artResources.set(resource, file);
  return [character, { credit: art.credit, sourceUrl: art.sourceUrl, framing: art.framing, placement: art.placement, resource }];
}))) + ";";
const entry = read("runtime-entry.js");
const nativeCSS = [...["theme.css", "chrome.css", "pages.css", "panels.css"].map(read), themeCss].join("\n");
const version = crypto.createHash("sha256").update(JSON.stringify(config)).update(clientApi).update(updates).update(bridge).update(view).update(css).update(dialogs).update(minibar).update(desktopLyrics).update(captionSettings).update(captionMenu).update(simplify).update(headerEntry).update(touhouThemes).update(originClient).update(touhouNames).update(originDiscovery).update(characterProfiles).update(characterPalettes).update(characterAffinities).update(characterMusic).update(characterArt).update(characterExport).update(characterQuiz).update(originCard).update(nativeCSS).update(entry).digest("hex").slice(0, 16);
const code = `(() => {
  if (!document.body || !document.getElementById("root") || !document.querySelector("footer")) return "pending";
  const previous=window.__pachiImmersive;
  if (previous && previous.version===${JSON.stringify(version)}) return "ready";
  const legacyClock = previous && window.NCMImmersiveBridge && window.NCMImmersiveBridge.clockSource!=="native-minibar";
  if (previous) previous.destroy();
  ${clientApi}
  if (legacyClock || window.NcmClientApi.needsMenuReload()) {
    setTimeout(()=>location.reload(),0);
    return "pending";
  }
  ${updates}
  ${bridge}
  ${touhouNames}
  ${view}
  ${dialogs}
  ${minibar}
  ${desktopLyrics}
  ${captionSettings}
  ${captionMenu}
  ${simplify}
  ${headerEntry}
  ${touhouThemes}
  ${originClient}
  ${originDiscovery}
  ${characterProfiles}
  ${characterPalettes}
  ${characterAffinities}
  ${characterMusic}
  ${characterArt}
  ${characterExport}
  ${characterQuiz}
  ${originCard}
  ${entry}
  return mountImmersiveRuntime(${JSON.stringify(version)}, ${JSON.stringify(css)}, ${JSON.stringify(nativeCSS)}, ${JSON.stringify(config)});
})()`;
new Function(code);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ncm-immersive-build-"));
const bundle = path.join(temp, "client.js");
const versionInfo = path.join(temp, "VersionInfo.cs");
const response = path.join(temp, "compile.rsp");
const checkOnly = process.argv.includes("--check");
const out = checkOnly ? temp : path.join(root, "dist");
fs.mkdirSync(out, {recursive:true});
try {
  fs.writeFileSync(bundle, code);
  const fileVersion = pkg.version.split(/[+-]/, 1)[0] + ".0";
  fs.writeFileSync(versionInfo, [
    "using System.Reflection;",
    '[assembly: AssemblyProduct("TouhouNCM")]',
    `[assembly: AssemblyVersion("${fileVersion}")]`,
    `[assembly: AssemblyInformationalVersion("${pkg.version}")]`
  ].join("\n"));
  const compiler = path.join(process.env.WINDIR, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  const args = ["/nologo","/codepage:65001","/target:winexe","/optimize+","/platform:x86",
    "/reference:System.Management.dll","/reference:System.Windows.Forms.dll","/reference:System.Web.Extensions.dll","/reference:System.Net.Http.dll",
    "/reference:System.Drawing.dll","/resource:"+bundle+",client.js", "/out:"+path.join(out,"NcmImmersive.exe"), versionInfo,
    ...Array.from(artResources, ([name, file]) => "/resource:" + file + "," + name),
    ...["Launch.cs","ClientDiscovery.cs","MiniSession.cs","ReleaseUpdater.cs","NativeCdpConnection.cs","WindowLong.cs","MiniPlayerForm.cs","DesktopCaptionForm.cs","DesktopCaptionPainter.cs","SurfacePalette.cs"].map(file=>path.join(root,"src/native",file))];
  // Keep embedded artwork outside the renderer bundle; only the requested
  // portrait crosses the native connection during an export.
  fs.writeFileSync(response, "\uFEFF" + args.map(arg => '"' + arg + '"').join("\n"));
  const result = cp.spawnSync(compiler, ["@" + response], {stdio:"inherit",windowsHide:true});
  if (result.status !== 0) throw Error("C# 编译失败");
} finally {
  if(fs.existsSync(bundle)) fs.unlinkSync(bundle);
  if(fs.existsSync(versionInfo)) fs.unlinkSync(versionInfo);
  if(fs.existsSync(response)) fs.unlinkSync(response);
  if (checkOnly && fs.existsSync(path.join(temp, "NcmImmersive.exe"))) fs.unlinkSync(path.join(temp, "NcmImmersive.exe"));
  fs.rmdirSync(temp);
}
