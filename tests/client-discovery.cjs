const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const project = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'touhou-ncm-discovery-test-'));
try {
  const executable = path.join(temp, 'discovery-tests.exe');
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  for (const [command, args] of [
    [compiler, ['/nologo', '/codepage:65001', '/target:exe', '/platform:x64', '/reference:System.Management.dll', '/out:' + executable,
      path.join(project, 'src/native/ClientDiscovery.cs'), path.join(__dirname, 'ClientDiscoveryTests.cs')]],
    [executable, [temp]],
  ]) {
    const result = cp.spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Discovery checks failed: ' + result.status);
  }
} finally {
  // The exact directory was created by this test beneath the OS temp directory.
  if (path.dirname(temp) !== path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('touhou-ncm-discovery-test-')) throw new Error('Unexpected test directory');
  fs.rmSync(temp, { recursive: true, force: true });
}
