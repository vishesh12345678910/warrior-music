const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const appDir = __dirname;
const stageDir = path.join(appDir, 'stage_warrior_payload');
const zipFile = path.join(appDir, 'warrior-app-payload.zip');

if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}
if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

fs.mkdirSync(stageDir, { recursive: true });

// Copy files
fs.copyFileSync(path.join(appDir, 'WarriorMusic.exe'), path.join(stageDir, 'WarriorMusic.exe'));
fs.copyFileSync(path.join(appDir, 'server.js'), path.join(stageDir, 'server.js'));
fs.copyFileSync(path.join(appDir, 'package.json'), path.join(stageDir, 'package.json'));

// Copy public (without downloads)
function copyDir(src, dest, exclude = []) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, exclude);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(path.join(appDir, 'public'), path.join(stageDir, 'public'), ['downloads']);
copyDir(path.join(appDir, 'data'), path.join(stageDir, 'data'));
copyDir(path.join(appDir, 'node_modules'), path.join(stageDir, 'node_modules'));

console.log('Staged payload files. Now zipping...');
execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipFile}' -CompressionLevel Optimal"`, { stdio: 'inherit' });

console.log('Zip created! Size:', fs.statSync(zipFile).size);
fs.rmSync(stageDir, { recursive: true, force: true });
console.log('Cleaned up stage dir.');
