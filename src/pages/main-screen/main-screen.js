import './main-screen.css';
import '@fontsource/material-symbols-outlined';
import layoutTemplate from '../layout/layout.html';
import leftMenuTemplate from '../layout/left-menu.html';
import headerTemplate from '../layout/header.html';
import dashboardTemplate from '../screens/dashboard/dashboard.html';
import ordersTemplate from '../screens/orders/orders.html';
import '../screens/printPO/printPO.css';
import printPOTemplate from '../screens/printPO/printPO.html';
import { initPrintPOScreen } from '../screens/printPO/printPO';
import reportsTemplate from '../screens/reports/reports.html';
import settingsTemplate from '../screens/settings/settings.html';

const screenTemplates = {
  dashboard: dashboardTemplate,
  orders: ordersTemplate,
  inpo: printPOTemplate,
  reports: reportsTemplate,
  settings: settingsTemplate,
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
  renderLayout();
  wireActions();
});
