const path = require('path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const next = require('next');

const isDev = process.env.ELECTRON_DEV === 'true';
const port = parseInt(process.env.ELECTRON_PORT || '3000', 10);
const startUrl = process.env.ELECTRON_APP_URL || `http://localhost:${port}`;
const frontendDir = path.join(__dirname, '..', 'frontend');
let nextServer;

const createWindow = async () => {
  const window = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 980,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#07070F',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  await window.loadURL(startUrl);
  window.once('ready-to-show', () => window.show());

  if (isDev) {
    window.webContents.openDevTools({ mode: 'detach' });
  }
};

const initializeNextServer = async () => {
  const appNext = next({ dev: false, dir: frontendDir });
  await appNext.prepare();
  const handler = appNext.getRequestHandler();

  nextServer = http.createServer((req, res) => handler(req, res));
  return new Promise((resolve, reject) => {
    nextServer.listen(port, () => resolve());
    nextServer.on('error', reject);
  });
};

const initializeAutoUpdater = () => {
  if (isDev) {
    return;
  }

  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'info';

    autoUpdater.on('checking-for-update', () => {
      console.log('Checking for update...');
    });
    autoUpdater.on('update-available', (info) => {
      console.log('Update available:', info.version);
    });
    autoUpdater.on('update-not-available', () => {
      console.log('No update available');
    });
    autoUpdater.on('error', (err) => {
      console.error('Auto update error:', err);
    });
    autoUpdater.on('update-downloaded', () => {
      console.log('Update downloaded');
      autoUpdater.quitAndInstall();
    });

    autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    console.warn('Auto updater is not available in this environment.', error);
  }
};

app.whenReady().then(async () => {
  if (!isDev) {
    await initializeNextServer();
  }

  initializeAutoUpdater();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.close();
  }
});

ipcMain.handle('open-external', async (_, url) => {
  await shell.openExternal(url);
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});
