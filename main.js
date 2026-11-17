const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec, spawn } = require('child_process');

let mainWindow;
let currentRoot = null;

// ==================== JDK MANAGER ====================
const JDK_ROOT = path.join(app.getPath('userData'), 'jdks');
let activeJdkPath = null; // ruta JAVA_HOME activa

function jdkVersionOf(dir) {
  try {
    const rel = path.join(dir, 'release');
    if (fs.existsSync(rel)) {
      const m = fs.readFileSync(rel, 'utf8').match(/JAVA_VERSION="([^"]+)"/);
      if (m) return m[1];
    }
  } catch {}
  try {
    const out = require('child_process').execSync(`"${path.join(dir, 'bin', 'java.exe')}" -version 2>&1`, { timeout: 8000 }).toString();
    const m = out.match(/version "([^"]+)"/);
    if (m) return m[1];
  } catch {}
  return null;
}

function scanJdkDir(base, out, source) {
  try {
    if (!fs.existsSync(base)) return;
    for (const name of fs.readdirSync(base)) {
      const full = path.join(base, name);
      try {
        if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'bin', 'javac.exe'))) {
          const v = jdkVersionOf(full);
          if (v) out.push({ path: full, version: v, name: name, vendor: detectVendor(full, name), source: source });
        }
      } catch {}
    }
  } catch {}
}

function detectVendor(dir, name) {
  const n = (name || '').toLowerCase();
  if (/adoptium|temurin/.test(n)) return 'Temurin';
  if (/zulu/.test(n)) return 'Zulu';
  if (/corretto/.test(n)) return 'Corretto';
  if (/microsoft|msopenjdk/.test(n)) return 'Microsoft';
  if (/oracle/.test(n)) return 'Oracle';
  if (/bellsoft|liberica/.test(n)) return 'Liberica';
  if (/semeru/.test(n)) return 'Semeru';
  return 'JDK';
}

function listJdks() {
  const out = [];
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  scanJdkDir(JDK_ROOT, out, 'instalado');
  for (const b of [
    path.join(pf, 'Java'), path.join(pf, 'Eclipse Adoptium'), path.join(pf, 'Eclipse Foundation'),
    path.join(pf, 'Microsoft'), path.join(pf, 'Zulu'), path.join(pf, 'Amazon Corretto'),
    path.join(pf, 'BellSoft'), path.join(pf, 'Semeru'), path.join(pf, 'JetBrains'),
    path.join(pf86, 'Java'), path.join(os.homedir(), '.jdks'), path.join(os.homedir(), 'scoop', 'apps', 'openjdk')
  ]) scanJdkDir(b, out, 'sistema');
  // JDK del PATH
  try {
    const where = require('child_process').execSync('where javac', { timeout: 5000 }).toString().split(/\r?\n/)[0];
    if (where) {
      const home = path.dirname(path.dirname(where));
      if (!out.find(j => j.path.toLowerCase() === home.toLowerCase())) {
        const v = jdkVersionOf(home);
        if (v) out.push({ path: home, version: v, name: 'PATH', vendor: 'Sistema', source: 'PATH' });
      }
    }
  } catch {}
  // dedupe por path
  const seen = new Set(); const uniq = [];
  for (const j of out) { const k = j.path.toLowerCase(); if (!seen.has(k)) { seen.add(k); uniq.push(j); } }
  uniq.sort((a, b) => a.version.localeCompare(b.version));
  return uniq;
}

function httpsDownload(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AntiIDE', 'Accept': 'application/octet-stream' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsDownload(res.headers.location, dest, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', c => { got += c.length; if (onProgress) onProgress(got, total); });
      res.on('error', reject);
      file.on('error', reject);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', reject);
  });
}

function spawnP(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, opts || {});
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => resolve({ out, err, code }));
    p.on('error', e => resolve({ out, err: String(e), code: 1 }));
  });
}

async function installJdk(version, send) {
  fs.mkdirSync(JDK_ROOT, { recursive: true });
  const url = `https://api.adoptium.net/v3/binary/latest/${version}/ga/windows/x64/jdk/hotspot/normal/eclipse`;
  const tmpFile = path.join(os.tmpdir(), `antiide-jdk-${version}-${Date.now()}.zip`);
  send('⏳ Descargando Temurin JDK ' + version + '... (puede tardar, ~200MB)');
  await httpsDownload(url, tmpFile, (got, total) => {
    const pct = total ? Math.round(got / total * 100) : 0;
    send('descarga', { pct, got, total, version });
  });
  send('📦 Extrayendo... (unos segundos)');
  const xtmp = path.join(os.tmpdir(), 'antiide-jdk-x-' + Date.now());
  fs.mkdirSync(xtmp, { recursive: true });
  // 1) bsdtar (Windows 10+) entiende zip ; 2) PowerShell Expand-Archive
  let r = await spawnP('tar', ['-xf', tmpFile, '-C', xtmp]);
  if (r.code !== 0) {
    r = await spawnP('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath "${tmpFile}" -DestinationPath "${xtmp}" -Force`]);
  }
  let inner = null;
  try { inner = fs.readdirSync(xtmp).find(n => fs.existsSync(path.join(xtmp, n, 'bin', 'java.exe'))); } catch {}
  if (!inner) {
    // a veces queda un nivel extra de carpeta
    for (const n of (fs.readdirSync(xtmp) || [])) {
      const sub = path.join(xtmp, n);
      try { const s2 = fs.readdirSync(sub).find(m => fs.existsSync(path.join(sub, m, 'bin', 'java.exe'))); if (s2) { inner = path.join(n, s2); break; } } catch {}
    }
  }
  if (!inner) { try { fs.rmSync(xtmp, { recursive: true, force: true }); } catch {} throw new Error('No se encontró java.exe tras extraer. ' + (r.err || '').slice(0, 200)); }
  const dest = path.join(JDK_ROOT, 'Temurin-' + version);
  try { fs.rmSync(dest, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(path.join(xtmp, inner), dest);
  try { fs.rmSync(xtmp, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(tmpFile, { force: true }); } catch {}
  const v = jdkVersionOf(dest) || version;
  send('✅ Instalado Temurin ' + v);
  return { path: dest, version: v, name: 'Temurin-' + version, vendor: 'Temurin', source: 'instalado' };
}

// ==================== FIN JDK MANAGER ====================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    backgroundColor: '#2b2d30',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'logo.png'),
    title: 'Anti IDE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

async function openFolder() {
  try {
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (!res.canceled && res.filePaths[0]) {
      currentRoot = res.filePaths[0];
      try { mainWindow.webContents.send('folder:opened', currentRoot); } catch {}
      return currentRoot;
    }
    return null;
  } catch (err) {
    return null;
  }
}

function mkProjectSync(parentDir, name) {
  const proj = path.join(parentDir, name);
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'Main.java'), 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hola Anti IDE!");\n    }\n}\n', 'utf8');
  fs.writeFileSync(path.join(proj, 'demo.js'), 'console.log("Hola Anti IDE!");\nfor (let i = 1; i <= 5; i++) console.log("linea " + i);\n', 'utf8');
  fs.writeFileSync(path.join(proj, 'index.html'), '<!DOCTYPE html><html><body><h1>Hola Anti IDE</h1><script>console.log("hola")</script></body></html>', 'utf8');
  return proj;
}

const TEMPLATES = {
  java: { file: 'src/Main.java', content: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hola Anti IDE!");\n    }\n}\n', lang: 'java' },
  kotlin: { file: 'src/Main.kt', content: 'fun main() {\n    println("Hola Anti IDE!")\n}\n', lang: 'kotlin' },
  javascript: { file: 'index.js', content: 'console.log("Hola Anti IDE!");\nfor (let i = 1; i <= 5; i++) console.log("linea " + i);\n', lang: 'javascript' },
  python: { file: 'main.py', content: 'print("Hola Anti IDE!")\nfor i in range(1, 6):\n    print("linea", i)\n', lang: 'python' },
  c: { file: 'main.c', content: '#include <stdio.h>\n\nint main() {\n    printf("Hola Anti IDE!\\n");\n    return 0;\n}\n', lang: 'c' },
  web: { file: 'index.html', content: '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>Anti IDE Web</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hola Anti IDE!</h1>\n  <script src="app.js"></script>\n</body>\n</html>\n', lang: 'html' },
  maven: { file: 'src/main/java/Main.java', content: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hola Anti IDE (Maven)!");\n    }\n}\n', lang: 'java', extra: { 'pom.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>{group}</groupId>\n  <artifactId>{name}</artifactId>\n  <version>1.0.0</version>\n</project>\n' } },
  gradle: { file: 'src/main/java/Main.java', content: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hola Anti IDE (Gradle)!");\n    }\n}\n', lang: 'java', extra: { 'build.gradle': "plugins { id 'java' }\n\njar {\n  manifest { attributes 'Main-Class': 'Main' }\n}\n" } },
  spring: { file: 'src/main/java/com/example/DemoApplication.java', content: 'package com.example;\n\npublic class DemoApplication {\n    public static void main(String[] args) {\n        System.out.println("Hola Spring Boot (Anti IDE)!");\n    }\n}\n', lang: 'java', extra: { 'pom.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>{group}</groupId>\n  <artifactId>{name}</artifactId>\n  <version>1.0.0</version>\n  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>3.2.0</version></parent>\n</project>\n' } },
  empty: null
};

function createProjectAt(parentDir, name, template, opts) {
  opts = opts || {};
  const proj = path.join(parentDir, name);
  fs.mkdirSync(proj, { recursive: true });
  const tpl = TEMPLATES[template];
  if (tpl) {
    const fp = path.join(proj, tpl.file);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, tpl.content, 'utf8');
    if (tpl.extra) {
      for (const [rel, body] of Object.entries(tpl.extra)) {
        const ex = path.join(proj, rel);
        fs.mkdirSync(path.dirname(ex), { recursive: true });
        fs.writeFileSync(ex, body.replace(/\{name\}/g, name).replace(/\{group\}/g, opts.group || 'com.example'), 'utf8');
      }
    }
    if (template === 'web') {
      fs.writeFileSync(path.join(proj, 'style.css'), 'body { font-family: sans-serif; background: #1e1f22; color: #eee; text-align: center; padding-top: 40px; }\n', 'utf8');
      fs.writeFileSync(path.join(proj, 'app.js'), 'console.log("Hola Anti IDE Web!");\n', 'utf8');
    }
  }
  if (opts.git) {
    try {
      const { execSync } = require('child_process');
      execSync('git init', { cwd: proj, stdio: 'ignore' });
      fs.writeFileSync(path.join(proj, '.gitignore'), 'node_modules/\n*.class\n*.exe\ndist/\n', 'utf8');
    } catch {}
  }
  return proj;
}

function listDirRecursive(root, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];
  let out = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.antiide') continue;
      const full = path.join(root, e.name);
      const node = { name: e.name, path: full, isDir: e.isDirectory(), children: [] };
      if (e.isDirectory()) node.children = listDirRecursive(full, depth + 1, maxDepth);
      out.push(node);
    }
  } catch {}
  return out;
}

// ---------- IPC ----------
ipcMain.handle('ping', () => ({ ok: true, electron: process.versions.electron, node: process.versions.node }));
ipcMain.handle('dialog:openFolder', openFolder);
// ---------- JDK IPC ----------
function settingsPath(root) { return path.join(root || currentRoot || app.getPath('userData'), '.antiide', 'settings.json'); }
function readSettings(root) {
  try { return JSON.parse(fs.readFileSync(settingsPath(root), 'utf8')); } catch { return {}; }
}
function writeSettings(root, obj) {
  try {
    const p = settingsPath(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const cur = readSettings(root);
    fs.writeFileSync(p, JSON.stringify(Object.assign(cur, obj), null, 2), 'utf8');
    return true;
  } catch { return false; }
}

ipcMain.handle('jdk:list', () => { const list = listJdks(); return { ok: true, list, active: activeJdkPath, root: JDK_ROOT, managed: JDK_ROOT }; });
ipcMain.handle('jdk:install', async (e, version) => {
  try {
    const send = (msg, data) => { try { mainWindow.webContents.send('jdk:progress', { msg, data }); } catch {} };
    const jdk = await installJdk(String(version), send);
    return { ok: true, jdk };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('jdk:versions', () => ([
  { v: '8', label: 'JDK 8 (1.8) - viejo', lts: false },
  { v: '11', label: 'JDK 11 LTS', lts: true },
  { v: '17', label: 'JDK 17 LTS', lts: true },
  { v: '21', label: 'JDK 21 LTS (recomendado)', lts: true },
  { v: '23', label: 'JDK 23', lts: false },
  { v: '24', label: 'JDK 24 (más nuevo)', lts: false }
]));
ipcMain.handle('jdk:setActive', (e, jdkPath) => {
  activeJdkPath = jdkPath || null;
  if (currentRoot) writeSettings(currentRoot, { jdk: activeJdkPath });
  return { ok: true, active: activeJdkPath };
});
ipcMain.handle('jdk:getProject', () => {
  const s = readSettings(currentRoot);
  return { ok: true, jdk: s.jdk || activeJdkPath, active: activeJdkPath };
});
ipcMain.handle('project:saveSettings', (e, obj) => ({ ok: writeSettings(currentRoot, obj || {}) }));

function envWithJdk(jdkPath) {
  const env = Object.assign({}, process.env);
  const j = jdkPath || activeJdkPath;
  if (j && fs.existsSync(j)) {
    env.JAVA_HOME = j;
    env.PATH = path.join(j, 'bin') + ';' + (process.env.PATH || '');
  }
  return env;
}

// ---------- JDK IPC fin ----------

ipcMain.handle('path:defaultLocation', () => {
  try { return { ok: true, desktop: app.getPath('desktop'), documents: app.getPath('documents') }; }
  catch { return { ok: false }; }
});
ipcMain.handle('project:new', (e, cfg) => {
  try {
    cfg = cfg || {};
    let parent = cfg.location;
    if (!parent) parent = app.getPath('desktop');
    const raw = String(cfg.name || 'untitled').trim() || 'untitled';
    const safe = raw.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    const proj = createProjectAt(parent, safe, cfg.template || 'java', { git: !!cfg.git, group: cfg.group });
    currentRoot = proj;
    if (cfg.jdk !== undefined) { activeJdkPath = cfg.jdk || activeJdkPath; writeSettings(proj, { jdk: activeJdkPath }); }
    try { mainWindow.webContents.send('folder:opened', proj); } catch {}
    return { ok: true, path: proj, jdk: activeJdkPath };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('dialog:pickParent', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Elegir carpeta' });
  if (!res.canceled && res.filePaths[0]) return res.filePaths[0];
  return null;
});
ipcMain.handle('project:create', (e, parentDir, name) => {
  try {
    if (!parentDir) parentDir = app.getPath('documents');
    const safe = String(name || 'MiProyecto').replace(/[<>:"/\\|?*]/g, '_').slice(0, 60) || 'MiProyecto';
    const proj = mkProjectSync(parentDir, safe);
    currentRoot = proj;
    try { mainWindow.webContents.send('folder:opened', proj); } catch {}
    return { ok: true, path: proj };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('project:createHere', (e, name) => {
  try {
    const base = app.getPath('documents');
    const raw = String(name || '').trim();
    const safe = raw ? raw.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60) : 'AntiIDE-' + new Date().toISOString().slice(0, 10);
    const proj = mkProjectSync(base, safe);
    currentRoot = proj;
    try { mainWindow.webContents.send('folder:opened', proj); } catch {}
    return { ok: true, path: proj };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
});
ipcMain.handle('fs:list', (e, root) => {
  currentRoot = root;
  const s = readSettings(root);
  if (s.jdk !== undefined) activeJdkPath = s.jdk;
  return listDirRecursive(root);
});
ipcMain.handle('fs:read', (e, fp) => { try { return { ok: true, content: fs.readFileSync(fp, 'utf8'), ext: path.extname(fp) }; } catch (err) { return { ok: false, error: String(err) }; } });
ipcMain.handle('fs:write', (e, fp, content) => { try { fs.writeFileSync(fp, content, 'utf8'); return { ok: true }; } catch (err) { return { ok: false, error: String(err) }; } });
ipcMain.handle('fs:create', (e, base, name, isDir) => {
  try {
    const fp = path.join(base, name);
    if (isDir) fs.mkdirSync(fp, { recursive: true }); else fs.writeFileSync(fp, '', { flag: 'wx' });
    return { ok: true, path: fp };
  } catch (err) { return { ok: false, error: String(err) }; }
});
ipcMain.handle('fs:delete', (e, fp) => { try { fs.rmSync(fp, { recursive: true, force: true }); return { ok: true }; } catch (err) { return { ok: false, error: String(err) }; } });
ipcMain.handle('fs:rename', (e, oldP, newP) => { try { fs.renameSync(oldP, newP); return { ok: true }; } catch (err) { return { ok: false, error: String(err) }; } });

function cmdForFile(fp) {
  const ext = path.extname(fp).toLowerCase();
  const base = path.basename(fp);
  const dir = path.dirname(fp);
  const noExt = path.basename(fp, ext);
  if (ext === '.js') return { cmd: 'node', args: [fp], cwd: dir, label: `node ${base}` };
  if (ext === '.ts') return { cmd: 'npx', args: ['ts-node', fp], cwd: dir, label: `ts-node ${base}` };
  if (ext === '.py') return { cmd: 'python', args: [fp], cwd: dir, label: `python ${base}`, fallback: { cmd: 'py', args: [fp] } };
  if (ext === '.java') return { build: `javac "${fp}"`, cmd: 'java', args: ['-cp', dir, noExt], cwd: dir, label: `javac + java ${base}` };
  if (ext === '.c') return { build: `gcc "${fp}" -o "${path.join(dir, noExt)}.exe"`, cmd: path.join(dir, noExt + '.exe'), args: [], cwd: dir, label: `gcc ${base}` };
  if (ext === '.cpp' || ext === '.cc') return { build: `g++ "${fp}" -o "${path.join(dir, noExt)}.exe"`, cmd: path.join(dir, noExt + '.exe'), args: [], cwd: dir, label: `g++ ${base}` };
  if (ext === '.go') return { cmd: 'go', args: ['run', fp], cwd: dir, label: `go run ${base}` };
  if (ext === '.php') return { cmd: 'php', args: [fp], cwd: dir, label: `php ${base}` };
  if (ext === '.rb') return { cmd: 'ruby', args: [fp], cwd: dir, label: `ruby ${base}` };
  if (ext === '.rs') return { build: `rustc "${fp}" -o "${path.join(dir, noExt)}.exe"`, cmd: path.join(dir, noExt + '.exe'), args: [], cwd: dir, label: `rustc ${base}` };
  if (ext === '.kt') return { cmd: 'kotlinc-script', args: [fp], cwd: dir, label: `kotlinc ${base} (requiere kotlinc)` };
  if (ext === '.html' || ext === '.htm') return { preview: true, label: `preview ${base}` };
  if (ext === '.sh') return { cmd: 'bash', args: [fp], cwd: dir, label: `bash ${base}` };
  if (ext === '.ps1') return { cmd: 'powershell', args: ['-ExecutionPolicy', 'Bypass', '-File', fp], cwd: dir, label: `powershell ${base}` };
  return null;
}

ipcMain.handle('run:file', async (e, fp, jdkPath) => {
  const info = cmdForFile(fp);
  if (!info) return { ok: false, error: 'Extensión no soportada para Run directo. Usa la Terminal.' };
  if (info.preview) return { ok: true, preview: fp };
  const env = envWithJdk(jdkPath);
  const runOne = (cmd, args, cwd) => new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, shell: true, env });
    let out = '', err = '';
    p.stdout.on('data', d => out += d.toString());
    p.stderr.on('data', d => err += d.toString());
    p.on('close', code => resolve({ out, err, code }));
    p.on('error', e2 => resolve({ out, err: String(e2), code: 1 }));
    setTimeout(() => { try { p.kill(); } catch {} resolve({ out: out + '\n[TIMEOUT 15s]', err, code: 1 }); }, 15000);
  });
  try {
    if (info.build) {
      const b = await new Promise((res) => exec(info.build, { cwd: info.cwd, timeout: 20000, env }, (e2, stdout, stderr) => res({ e2, stdout, stderr })));
      if (b.e2) return { ok: false, error: 'BUILD FAILED:\n' + (b.stderr || b.stdout || String(b.e2)), label: info.label, jdk: env.JAVA_HOME || null };
      const r = await runOne(info.cmd, info.args, info.cwd);
      return { ok: true, ...r, label: info.label, jdk: env.JAVA_HOME || null };
    }
    const r = await runOne(info.cmd, info.args, info.cwd);
    // fallback python -> py en Windows
    if (r.code !== 0 && info.fallback && /not recognized|not found/i.test(r.err + r.out)) {
      const r2 = await runOne(info.fallback.cmd, info.fallback.args, info.cwd);
      return { ok: true, ...r2, label: info.label + ' (fallback py)', jdk: env.JAVA_HOME || null };
    }
    return { ok: true, ...r, label: info.label, jdk: env.JAVA_HOME || null };
  } catch (err) { return { ok: false, error: String(err) }; }
});

ipcMain.handle('term:exec', async (e, cwd, command, jdkPath) => {
  return new Promise((resolve) => {
    exec(command, { cwd: cwd || currentRoot || app.getPath('home'), timeout: 20000, shell: 'powershell.exe', env: envWithJdk(jdkPath) }, (err, stdout, stderr) => {
      resolve({ out: stdout, err: stderr, code: err ? err.code || 1 : 0 });
    });
  });
});

ipcMain.handle('git:exec', async (e, cwd, args) => {
  return new Promise((resolve) => {
    exec(`git ${args}`, { cwd: cwd || currentRoot || app.getPath('home'), timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ out: stdout, err: stderr, code: err ? 1 : 0 });
    });
  });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
