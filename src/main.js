const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const {
  apiBaseUrl,
  authLoginPath,
  protectedResourcePath,
  readPOForPrintPath,
  poDownloadDirectory,
} = require('./config');
const { downloadPOFiles } = require('./js/po-download');
const { listAvailableNetworkPrinters, listFilesInDirectory, printFilesFromDirectory } = require('./js/print-util');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const authState = {
  token: null,
  user: null,
};

let mainWindow;

const buildApiUrl = (pathName) => {
  if (pathName.startsWith('http://') || pathName.startsWith('https://')) {
    return pathName;
  }

  return new URL(pathName, apiBaseUrl).toString();
};

const getResponsePayload = async (response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  return response.text();
};

const extractToken = (payload) =>
  payload?.id_token ?? payload?.token ?? payload?.accessToken ?? payload?.access_token ?? payload?.jwt ?? null;

const getRoles = (user) => {
  if (!user) {
    return [];
  }

  if (typeof user.authorities === 'string' && user.authorities.trim().length > 0) {
    return user.authorities
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);
  }

  if (typeof user.roles === 'string' && user.roles.trim().length > 0) {
    return user.roles
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean);
  }

  if (Array.isArray(user.roles)) {
    return user.roles.filter(Boolean);
  }

  if (typeof user.role === 'string' && user.role.length > 0) {
    return [user.role];
  }

  return [];
};

const hasRole = (requiredRole, user) => {
  if (!requiredRole) {
    return true;
  }

  const roles = getRoles(user);
  return roles.includes(requiredRole);
};

ipcMain.handle('auth:login', async (_, credentials) => {
  const username = credentials?.username?.trim();
  const password = credentials?.password;
  const rememberMe = Boolean(credentials?.rememberMe);

  if (!username || !password) {
    throw new Error('Username and password are required.');
  }

  const loginResponse = await fetch(buildApiUrl(authLoginPath), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CustomHeader': 'thevietfresh.com', 
    },
    body: JSON.stringify({ username, password, rememberMe }),
  });

  const loginPayload = await getResponsePayload(loginResponse);
  if (!loginResponse.ok) {
    throw new Error(
      typeof loginPayload === 'string'
        ? loginPayload
        : loginPayload?.message ?? 'Authentication failed.',
    );
  }

  const token = extractToken(loginPayload);
  if (!token) {
    throw new Error(`Authentication succeeded but no access token was returned. JSON response: ${JSON.stringify(loginPayload)}`);
  }

  let user = {
    username,
    name: loginPayload?.name ?? null,
    roles: loginPayload?.roles ?? loginPayload?.authorities ?? '',
    token,
  };
  try {
    const profileResponse = await fetch(buildApiUrl(protectedResourcePath), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (profileResponse.ok) {
      user = await getResponsePayload(profileResponse);
    }
  } catch {
    user = {
      username,
      name: loginPayload?.name ?? null,
      roles: loginPayload?.roles ?? loginPayload?.authorities ?? '',
      token,
    };
  }

  authState.token = token;
  authState.user = user;

  return {
    isAuthenticated: true,
    user,
    roles: getRoles(user),
  };
});

ipcMain.handle('auth:get-session', () => ({
  isAuthenticated: Boolean(authState.token),
  user: authState.user,
  roles: getRoles(authState.user),
}));

ipcMain.handle('auth:logout', () => {
  authState.token = null;
  authState.user = null;
  return { isAuthenticated: false };
});

ipcMain.handle('po:download-files', async () =>
  downloadPOFiles({
    buildApiUrl,
    readPOForPrintPath,
    poDownloadDirectory,
    token: authState.token,
  }),
);

ipcMain.handle('po:list-files', async () => listFilesInDirectory(poDownloadDirectory));

ipcMain.handle('po:open-file', async (_, fileName) => {
  if (typeof fileName !== 'string' || fileName.trim().length === 0) {
    throw new Error('File name is required.');
  }

  const normalizedFileName = fileName.trim();
  const rootDirectory = path.resolve(poDownloadDirectory);
  const targetPath = path.resolve(rootDirectory, normalizedFileName);
  const relativePath = path.relative(rootDirectory, targetPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid file name.');
  }

  await fs.access(targetPath);

  const openError = await shell.openPath(targetPath);
  if (openError) {
    throw new Error(openError);
  }

  return {
    success: true,
    fileName: normalizedFileName,
    path: targetPath,
  };
});

ipcMain.handle('printer:list-available', async () => listAvailableNetworkPrinters());
ipcMain.handle('printer:list-network', async () => listAvailableNetworkPrinters());

ipcMain.handle('printer:print-directory', async (_, options = {}) =>
  printFilesFromDirectory(options),
);

ipcMain.handle('api:call-protected', async (_, requestOptions = {}) => {
  if (!authState.token) {
    throw new Error('Not authenticated. Please sign in first.');
  }

  const requiredRole = requestOptions.requiredRole ?? null;
  if (!hasRole(requiredRole, authState.user)) {
    throw new Error(`Forbidden. Missing required role: ${requiredRole}`);
  }

  const method = requestOptions.method ?? 'GET';
  const endpoint = requestOptions.path ?? protectedResourcePath;

  const headers = {
    ...(requestOptions.headers ?? {}),
    Authorization: `Bearer ${authState.token}`,
  };

  if (requestOptions.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(buildApiUrl(endpoint), {
    method,
    headers,
    body:
      requestOptions.body && headers['Content-Type'] === 'application/json'
        ? JSON.stringify(requestOptions.body)
        : requestOptions.body,
  });

  const payload = await getResponsePayload(response);

  if (!response.ok) {
    throw new Error(
      typeof payload === 'string'
        ? payload
        : payload?.message ?? `Request failed with status ${response.status}`,
    );
  }

  return {
    status: response.status,
    data: payload,
  };
});

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

ipcMain.handle('nav:to-main', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  await mainWindow.loadURL(MAIN_SCREEN_WEBPACK_ENTRY);
});

ipcMain.handle('nav:to-login', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  await mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
