const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { app, BrowserWindow, dialog, shell, nativeImage } = require('electron');
const fs = require('fs');

const BACKEND_PORT = Number.parseInt(process.env.DESKTOP_BACKEND_PORT || '3210', 10);
const BACKEND_BASE_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const BACKEND_API_URL = `${BACKEND_BASE_URL}/api`;
const AGENT_TOKEN = String(process.env.LOCAL_SERP_AGENT_TOKEN || 'desktop-local-agent-token').trim();
const AUTO_LAUNCH_ENABLED = String(
  process.env.DESKTOP_AUTO_LAUNCH
  || (app.isPackaged ? 'true' : 'false')
).trim().toLowerCase() !== 'false';

let mainWindow = null;
let backendProcess = null;
let localAgentProcess = null;
let shuttingDown = false;

function resolveAppRoot() {
  return app.getAppPath();
}

function resolveDesktopPath(...segments) {
  return path.join(resolveAppRoot(), ...segments);
}

function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore and continue
    }
  }

  return null;
}

function resolveDockIconPath() {
  return resolveExistingPath([
    path.join(process.resourcesPath || '', 'icon.icns'),
    path.join(process.resourcesPath || '', 'icon.png'),
    resolveDesktopPath('build', 'icons', 'icon.icns'),
    resolveDesktopPath('build', 'icons', 'icon-tight.png'),
    resolveDesktopPath('build', 'icons', 'icon-source.png'),
  ]);
}

function resolveWindowIconPath() {
  return resolveExistingPath([
    path.join(process.resourcesPath || '', 'icon.png'),
    resolveDesktopPath('build', 'icons', 'icon-tight.png'),
    resolveDesktopPath('build', 'icons', 'icon-source.png'),
  ]);
}

function applyRuntimeAppIcon() {
  const iconPath = resolveDockIconPath();
  if (!iconPath) {
    return;
  }

  const iconImage = nativeImage.createFromPath(iconPath);
  if (iconImage.isEmpty()) {
    return;
  }

  if (process.platform === 'darwin' && app.dock?.setIcon) {
    app.dock.setIcon(iconImage);
  }
}

function logChildOutput(prefix, child) {
  if (!child) {
    return;
  }

  child.stdout?.on('data', (chunk) => {
    const message = String(chunk || '').trim();
    if (message) {
      console.log(`${prefix} ${message}`);
    }
  });

  child.stderr?.on('data', (chunk) => {
    const message = String(chunk || '').trim();
    if (message) {
      console.error(`${prefix} ${message}`);
    }
  });
}

function spawnNodeProcess(scriptPath, extraEnv = {}, label = '[Desktop]') {
  const env = {
    ...process.env,
    ...extraEnv,
    ELECTRON_RUN_AS_NODE: '1',
  };

  const child = spawn(process.execPath, [scriptPath], {
    cwd: resolveAppRoot(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  logChildOutput(label, child);
  return child;
}

function isChildRunning(child) {
  return Boolean(child && child.exitCode == null && !child.killed);
}

function pingHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BACKEND_BASE_URL}/health`, { timeout: 2000 }, (res) => {
      const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
      res.resume();
      if (ok) {
        resolve(true);
      } else {
        reject(new Error(`Health returned status ${res.statusCode}`));
      }
    });

    req.on('timeout', () => req.destroy(new Error('Health request timed out')));
    req.on('error', reject);
  });
}

async function waitForBackend(maxWaitMs = 90000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    try {
      await pingHealth();
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return false;
}

function startBackendProcess() {
  const backendScript = resolveDesktopPath('backend', 'server.js');
  const desktopEnvPath = path.join(app.getPath('userData'), '.env');
  backendProcess = spawnNodeProcess(
    backendScript,
    {
      PORT: String(BACKEND_PORT),
      LOCAL_SERP_AGENT_TOKEN: AGENT_TOKEN,
      DESKTOP_ENV_PATH: desktopEnvPath,
    },
    '[Backend]'
  );

  backendProcess.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[Desktop] Backend exited unexpectedly (code=${code}, signal=${signal || 'none'})`);
    }
  });
}

function startLocalAgentProcess() {
  const localAgentScript = resolveDesktopPath('backend', 'scripts', 'localSerpAgent.js');
  const localProfileDir = path.join(app.getPath('userData'), 'local-serp-agent-profile');
  localAgentProcess = spawnNodeProcess(
    localAgentScript,
    {
      LOCAL_SERP_BACKEND_URL: BACKEND_API_URL,
      LOCAL_SERP_AGENT_TOKEN: AGENT_TOKEN,
      LOCAL_SERP_AGENT_ID: `${app.getName().replace(/\s+/g, '-')}-desktop-agent`,
      LOCAL_SERP_AGENT_HEADLESS: 'new',
      LOCAL_SERP_AGENT_USER_DATA_DIR: localProfileDir,
      LOCAL_SERP_AGENT_CHROME_PATH: process.execPath,
    },
    '[LocalAgent]'
  );

  localAgentProcess.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[Desktop] Local agent exited unexpectedly (code=${code}, signal=${signal || 'none'})`);
    }
  });
}

function stopChild(child) {
  if (!isChildRunning(child)) {
    return;
  }

  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
}

function stopBackgroundProcesses() {
  shuttingDown = true;
  stopChild(localAgentProcess);
  stopChild(backendProcess);
}

async function createMainWindow() {
  const windowIcon = resolveWindowIconPath();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: '#0f172a',
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(BACKEND_BASE_URL);
}

async function boot() {
  applyRuntimeAppIcon();

  if (AUTO_LAUNCH_ENABLED) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
    });
  }

  startBackendProcess();
  const backendReady = await waitForBackend();

  if (!backendReady) {
    await dialog.showErrorBox(
      'Backend failed to start',
      `Could not start backend on ${BACKEND_BASE_URL}. Close other instances using this port and reopen the app.`
    );
    app.quit();
    return;
  }

  startLocalAgentProcess();
  await createMainWindow();
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);
}

app.on('before-quit', () => {
  stopBackgroundProcesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow().catch((error) => {
      console.error('[Desktop] Failed to re-open window:', error.message);
    });
  }
});
