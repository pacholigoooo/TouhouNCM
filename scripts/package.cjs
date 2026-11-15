const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const compiler = process.env.ISCC_PATH || [
  process.env["ProgramFiles(x86)"], process.env.ProgramFiles,
  path.join(process.env.LOCALAPPDATA || "", "Programs")
].filter(Boolean).flatMap(base => ["Inno Setup 7", "Inno Setup 6"].map(name =>
  path.join(base, name, "ISCC.exe")
)).find(file => fs.existsSync(file));

if (!compiler) {
  throw new Error("请安装 Inno Setup 6.5+，或将 ISCC_PATH 设置为 ISCC.exe 的完整路径。");
}

const result = cp.spawnSync(compiler, [
  "/Q", "/DAppVersion=" + pkg.version, path.join(root, "installer", "TouhouNCM.iss")
], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
