const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appApi', {
	login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
	getSession: () => ipcRenderer.invoke('auth:get-session'),
	logout: () => ipcRenderer.invoke('auth:logout'),
	downloadPOFiles: () => ipcRenderer.invoke('po:download-files'),
	cancelDownloadPOFiles: () => ipcRenderer.invoke('po:cancel-download-files'),
	uploadOrderFile: (customer) => ipcRenderer.invoke('order:upload-file', customer),
	uploadFileToOllama: () => ipcRenderer.invoke('ollama:upload-file'),
	saveOrderAttachedFiles: (options) => ipcRenderer.invoke('order:save-attached-files', options),
	listOrderDownloadedFiles: (options) => ipcRenderer.invoke('order:list-downloaded-files', options),
	openOrderFile: (options) => ipcRenderer.invoke('order:open-file', options),
	openOrderDirectory: (options) => ipcRenderer.invoke('order:open-directory', options),
	composeOrderPromptFromTxt: (options) => ipcRenderer.invoke('order:compose-prompt-from-txt', options),
	composeOrderPromptFromFile: (options) => ipcRenderer.invoke('order:compose-prompt-from-file', options),
	listPODownloadFiles: () => ipcRenderer.invoke('po:list-files'),
	openPOFile: (fileName) => ipcRenderer.invoke('po:open-file', fileName),
	listAvailablePrinters: () => ipcRenderer.invoke('printer:list-available'),
	listNetworkPrinters: () => ipcRenderer.invoke('printer:list-available'),
	printFilesFromDirectory: (options) => ipcRenderer.invoke('printer:print-directory', options),
	printPOFile: (options) => ipcRenderer.invoke('printer:print-po-file', options),
	navigateToMain: () => ipcRenderer.invoke('nav:to-main'),
	navigateToLogin: () => ipcRenderer.invoke('nav:to-login'),
	callProtectedApi: (requestOptions) =>
		ipcRenderer.invoke('api:call-protected', requestOptions),
});
