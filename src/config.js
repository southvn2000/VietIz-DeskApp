const appConfig = {
  apiBaseUrl: process.env.API_BASE_URL ?? 'https://thevietfresh.com',
  authLoginPath: process.env.AUTH_LOGIN_PATH ?? '/mobile/authenticate',
  protectedResourcePath: process.env.PROTECTED_RESOURCE_PATH ?? '/auth/me',
  readPOForPrintPath: process.env.READ_PO_FOR_PRINT_PATH ?? '/rest/home/readPOForPrint',
  poDownloadDirectory: process.env.PO_DOWNLOAD_DIRECTORY ?? 'C:/Downloads/DownloadedPOs',
};

module.exports = appConfig;