import './main-screen.css';
import '@fontsource/material-symbols-outlined';
import layoutTemplate from '../layout/layout.html';
import leftMenuTemplate from '../layout/left-menu.html';
import headerTemplate from '../layout/header.html';
import dashboardTemplate from '../screens/dashboard/dashboard.html';
import ordersTemplate from '../screens/orders/orders.html';
import { initOrdersScreen } from '../screens/orders/orders';
import '../screens/orders/orders.css';
import orderFilesTemplate from '../screens/order-files/order-files.html';
import { initOrderFilesScreen } from '../screens/order-files/order-files';
import '../screens/order-files/order-files.css';
import '../screens/printPO/printPO.css';
import printPOTemplate from '../screens/printPO/printPO.html';
import { initPrintPOScreen } from '../screens/printPO/printPO';
import { initClientsHaveConfig } from '../../js/api';
import reportsTemplate from '../screens/reports/reports.html';
import settingsTemplate from '../screens/settings/settings.html';

const screenTemplates = {
  dashboard: dashboardTemplate,
  orders: ordersTemplate,
  'order-files': orderFilesTemplate,
  inpo: printPOTemplate,
  reports: reportsTemplate,
  settings: settingsTemplate,
};

let orderFilesContext = null;

const getDisplayName = (user) =>
  user?.name ??
  user?.fullName ??
  user?.displayName ??
  user?.username ??
  user?.firstName ??
  'Admin Viet Fresh';

const buildShortName = (displayName) => {
  const name = String(displayName ?? '').trim();
  if (!name) {
    return 'AV';
  }

  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return 'AV';
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

const hydrateHeaderUser = async () => {
  const userNameEl = document.getElementById('header-user-name');
  const userInitialsEl = document.getElementById('header-user-initials');

  if (!userNameEl || !userInitialsEl) {
    return;
  }

  try {
    const session = await window.appApi.getSession();
    const displayName = getDisplayName(session?.user);

    userNameEl.textContent = displayName;
    userInitialsEl.textContent = buildShortName(displayName);
  } catch {
    userNameEl.textContent = 'Admin Viet Fresh';
    userInitialsEl.textContent = 'AV';
  }
};

const setActiveMenuItem = (screenName) => {
  const menuItems = document.querySelectorAll('[data-nav-item]');

  menuItems.forEach((item) => {
    const isActive = item.dataset.screen === screenName;
    item.classList.toggle('menu-item-active', isActive);
  });
};

const renderScreen = (screenName) => {
  const contentSlot = document.getElementById('layout-content');
  if (!contentSlot) {
    return;
  }

  const resolvedScreenName = screenName in screenTemplates ? screenName : 'dashboard';
  const template = screenTemplates[resolvedScreenName];
  contentSlot.innerHTML = template;
  setActiveMenuItem(resolvedScreenName);

  if (resolvedScreenName === 'inpo') {
    initPrintPOScreen(contentSlot);
    return;
  }

  if (resolvedScreenName === 'orders') {
    initOrdersScreen(contentSlot, {
      onNavigateToOrderFiles: ({ customer, customerId }) => {
        orderFilesContext = {
          customer,
          customerId,
        };
        renderScreen('order-files');
      },
    });
    return;
  }

  if (resolvedScreenName === 'order-files') {
    void initOrderFilesScreen(contentSlot, {
      ...(orderFilesContext ?? {}),
      onBack: () => renderScreen('orders'),
    });
  }
};

const renderLayout = () => {
  const appRoot = document.getElementById('app-root');
  if (!appRoot) {
    return;
  }

  appRoot.innerHTML = layoutTemplate;

  const sidebarSlot = document.getElementById('layout-sidebar');
  const headerSlot = document.getElementById('layout-header');
  const contentSlot = document.getElementById('layout-content');

  if (sidebarSlot) {
    sidebarSlot.outerHTML = leftMenuTemplate;
  }

  if (headerSlot) {
    headerSlot.innerHTML = headerTemplate;
  }

  if (contentSlot) {
    renderScreen('dashboard');
  }
};

const wireActions = () => {
  const menuItems = document.querySelectorAll('[data-screen]');
  const logoutButton = document.getElementById('main-logout-button');

  menuItems.forEach((item) => {
    item.addEventListener('click', (event) => {
      event.preventDefault();
      const { screen } = item.dataset;
      if (!screen) {
        return;
      }

      renderScreen(screen);
    });
  });

  logoutButton?.addEventListener('click', async () => {
    try {
      await window.appApi.logout();
    } catch {
    }

    await window.appApi.navigateToLogin();
  });
};

document.addEventListener('DOMContentLoaded', () => {
  void initClientsHaveConfig().catch(() => {
  });

  renderLayout();
  void hydrateHeaderUser();
  wireActions();
});
