const appConfig = {
  //apiBaseUrl: process.env.API_BASE_URL ?? 'https://thevietfresh.com',
  apiBaseUrl: process.env.API_BASE_URL ?? ' https://610c-2001-ee0-4f43-2640-74d3-3cd1-2246-fd35.ngrok-free.app',   
  ollamaUploadUrl: process.env.OLLAMA_UPLOAD_URL ?? 'http://localhost:11434/upload',
  authLoginPath: process.env.AUTH_LOGIN_PATH ?? '/mobile/authenticate',
  readAttachedFilesPath: process.env.READ_ATTACHED_FILES_PATH ?? '/mobile/rest/get-clients-attached-files',
  protectedResourcePath: process.env.PROTECTED_RESOURCE_PATH ?? '/auth/me',
  readPOForPrintPath: process.env.READ_PO_FOR_PRINT_PATH ?? '/rest/home/readPOForPrint',
  poDownloadDirectory: process.env.PO_DOWNLOAD_DIRECTORY ?? 'C:/Downloads/DownloadedPOs',
  orderFileDirectory: process.env.ORDER_FILE_DIRECTORY ?? 'C:/Downloads/DownloadedOrderFiles',
};

module.exports = appConfig;