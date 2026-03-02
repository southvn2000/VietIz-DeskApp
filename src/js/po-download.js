const path = require('node:path');
const fs = require('node:fs/promises');

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
  await fs.mkdir(poDownloadDirectory, { recursive: true });

  const files = [];

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
  }

  return {
    success: true,
    message: files.length > 0 ? 'Download completed.' : 'No file available to download.',
    files,
    directory: poDownloadDirectory,
  };
};

module.exports = {
  downloadPOFiles,
};
