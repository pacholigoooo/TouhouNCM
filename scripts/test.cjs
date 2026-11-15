const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
for (const test of fs.readdirSync(path.join(root, "tests")).filter(name => name.endsWith(".cjs")).sort()) {
  const result = spawnSync(process.execPath, [path.join(root, "tests", test)], { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.status !== 0) process.exit(result.status || 1);
}
