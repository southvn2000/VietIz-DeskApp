/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './index.css';
import logoImage from './assets/viet-fresh-logo.png';

const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const rememberMeInput = document.getElementById('remember');
const loginButton = document.getElementById('login-button');
const fakeLoginButton = document.getElementById('fake-login-button');
const statusEl = document.getElementById('auth-status');
const themeToggleButton = document.getElementById('theme-toggle');
const loginView = document.getElementById('login-view');
const brandLogo = document.getElementById('brand-logo');

if (brandLogo) {
  brandLogo.src = logoImage;
}

const setStatus = (value) => {
  if (!statusEl) {
    return;
  }

  statusEl.textContent = typeof value === 'string' ? value : '';
};

if (!loginForm || !usernameInput || !passwordInput) {
  throw new Error('Login screen elements are missing.');
}

const getDisplayName = (user) =>
  user?.username ?? user?.firstName ?? user?.name ?? 'bạn';

const showLogin = () => {
  if (loginView) {
    loginView.classList.remove('hidden');
  }
};

const setDarkMode = (enabled) => {
  document.documentElement.classList.toggle('dark', enabled);
};

themeToggleButton?.addEventListener('click', () => {
  const isDark = document.documentElement.classList.contains('dark');
  setDarkMode(!isDark);
});

fakeLoginButton?.addEventListener('click', () => {
  window.appApi
    .navigateToMain()
    .catch(() => setStatus('Không thể mở trang chính.'));
  setStatus('');
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const credentials = {
    username: usernameInput.value.trim(),
    password: passwordInput.value,
    rememberMe: Boolean(rememberMeInput?.checked),
  };

  if (!credentials.username || !credentials.password) {
    setStatus('Vui lòng nhập tên đăng nhập và mật khẩu.');
    return;
  }

  if (loginButton) {
    loginButton.disabled = true;
  }

  setStatus('Đang đăng nhập...');

  try {
    await window.appApi.login(credentials);
    setStatus('');
    await window.appApi.navigateToMain();
  } catch (error) {
    setStatus(`Đăng nhập thất bại: ${error.message}`);
  } finally {
    if (loginButton) {
      loginButton.disabled = false;
    }
  }
});

const bootstrapSession = async () => {
  try {
    const session = await window.appApi.getSession();
    if (session?.isAuthenticated) {
      await window.appApi.navigateToMain();
      return;
    }

    showLogin();
  } catch {
    showLogin();
  }
};

void bootstrapSession();
