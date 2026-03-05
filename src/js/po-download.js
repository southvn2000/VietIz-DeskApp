const path = require('node:path');
const fs = require('node:fs/promises');

let activeDownloadController = null;

const isAbortError = (error) =>
  error?.name === 'AbortError' ||
  error?.code === 'ABORT_ERR' ||
  String(error?.message ?? '').toLowerCase().includes('aborted');

const extractFileName = (response, fallbackName = 'DownloadedFile') => {
  const contentDisposition = response.headers.get('content-disposition') ?? '';
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const fileNameMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (fileNameMatch?.[1]) {
    return fileNameMatch[1];
  }

  const contentType = response.headers.get('content-type') ?? '';
  const extensionByContentType = {
    'application/pdf': '.pdf',
    'text/html': '.html',
    'application/json': '.json',
    'text/plain': '.txt',
  };

  const detectedType = Object.keys(extensionByContentType).find((type) =>
    contentType.includes(type),
  );
  const extension = detectedType ? extensionByContentType[detectedType] : '.bin';

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${fallbackName}_${timestamp}${extension}`;
};

const saveFileFromResponse = async (response, directory) => {
  const fileName = extractFileName(response, 'DownloadedPO');
  const fullPath = path.join(directory, fileName);
  const fileBuffer = Buffer.from(await response.arrayBuffer());

  if (fileBuffer.length === 0) {
    return null;
  }

  await fs.rm(fullPath, { force: true });
  await fs.writeFile(fullPath, fileBuffer);
  return fullPath;
};

const getErrorMessage = async (response) => {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    return payload?.message ?? JSON.stringify(payload);
  }

  return response.text();
};

const downloadPOFiles = async ({
  buildApiUrl,
  readPOForPrintPath,
  poDownloadDirectory,
  token,
}) => {
  if (activeDownloadController) {
    throw new Error('Download is already in progress.');
  }

  const downloadController = new AbortController();
  activeDownloadController = downloadController;

  await fs.mkdir(poDownloadDirectory, { recursive: true });

  const files = [];
  const uniqueFiles = new Set();

  try {
    while (true) {
      const headers = {
        CustomHeader: 'thevietfresh.com',
      };

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(buildApiUrl(readPOForPrintPath), {
        method: 'GET',
        headers,
        signal: downloadController.signal,
      });

      if (response.status === 204) {
        break;
      }

      if (!response.ok) {
        const errorMessage = await getErrorMessage(response);
        throw new Error(errorMessage || `Download failed with status ${response.status}`);
      }

      const savedFilePath = await saveFileFromResponse(response, poDownloadDirectory);
      if (!savedFilePath) {
        break;
      }

      files.push(savedFilePath);
      uniqueFiles.add(savedFilePath);
    }

    const downloadedCount = uniqueFiles.size;

    return {
      success: true,
      canceled: false,
      message: downloadedCount > 0 ? 'Download completed.' : 'No file available to download.',
      files,
      downloadedCount,
      directory: poDownloadDirectory,
    };
  } catch (error) {
    if (!isAbortError(error)) {
      throw error;
    }

    const downloadedCount = uniqueFiles.size;

    return {
      success: false,
      canceled: true,
      message: 'Download stopped by user.',
      files,
      downloadedCount,
      directory: poDownloadDirectory,
    };
  } finally {
    if (activeDownloadController === downloadController) {
      activeDownloadController = null;
    }
  }
};

const cancelDownloadPOFiles = () => {
  if (!activeDownloadController) {
    return { canceled: false, message: 'No active download.' };
  }

  activeDownloadController.abort();
  return { canceled: true, message: 'Download cancellation requested.' };
};

module.exports = {
  downloadPOFiles,
  cancelDownloadPOFiles,
};
