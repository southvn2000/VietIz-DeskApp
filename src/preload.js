const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appApi', {
	login: (credentials) => ipcRenderer.invoke('auth:login', credentials),
	getSession: () => ipcRenderer.invoke('auth:get-session'),
	logout: () => ipcRenderer.invoke('auth:logout'),
	downloadPOFiles: () => ipcRenderer.invoke('po:download-files'),
	listPODownloadFiles: () => ipcRenderer.invoke('po:list-files'),
	openPOFile: (fileName) => ipcRenderer.invoke('po:open-file', fileName),
	listAvailablePrinters: () => ipcRenderer.invoke('printer:list-available'),
	listNetworkPrinters: () => ipcRenderer.invoke('printer:list-available'),
	printFilesFromDirectory: (options) => ipcRenderer.invoke('printer:print-directory', options),
	navigateToMain: () => ipcRenderer.invoke('nav:to-main'),
	navigateToLogin: () => ipcRenderer.invoke('nav:to-login'),
	callProtectedApi: (requestOptions) =>
		ipcRenderer.invoke('api:call-protected', requestOptions),
});
