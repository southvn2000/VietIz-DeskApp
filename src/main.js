const path = require('node:path');
const fs = require('node:fs/promises');
const axios = require('axios');
const electron = require('electron');
const {
  app: electronApp,
  BrowserWindow,
  ipcMain: electronIpcMain,
  shell,
  dialog,
} = electron;
const ipcMain = electronIpcMain && typeof electronIpcMain.handle === 'function'
  ? electronIpcMain
  : { handle: () => {} };
const pdfParse = require('pdf-parse/lib/pdf-parse.js');
const { createCanvas } = require('@napi-rs/canvas');
const {
  apiBaseUrl,
  ollamaUploadUrl,
  authLoginPath,
  readAttachedFilesPath,
  protectedResourcePath,
  readPOForPrintPath,
  poDownloadDirectory,
  orderFileDirectory,
} = require('./config');
const { downloadPOFiles, cancelDownloadPOFiles } = require('./js/po-download');
const {
  listAvailableNetworkPrinters,
  listFilesInDirectory,
  printFilesFromDirectory,
  printFileWithOptions,
} = require('./js/print-util');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  electronApp?.quit?.();
}

if (electronApp?.commandLine?.appendSwitch) {
  electronApp.commandLine.appendSwitch('lang', 'en-GB');
  electronApp.commandLine.appendSwitch('accept-lang', 'en-GB,en');
}

const authState = {
  token: null,
  user: null,
};

let mainWindow;

const getAppPathSafe = () => {
  try {
    return electronApp?.getAppPath?.() || process.cwd();
  } catch {
    return process.cwd();
  }
};

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

const extractFileNameFromResponse = (response, fallbackName = 'attached-file') => {
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
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'application/json': '.json',
    'text/plain': '.txt',
  };

  const matchedType = Object.keys(extensionByContentType).find((type) => contentType.includes(type));
  const extension = matchedType ? extensionByContentType[matchedType] : '.bin';
  return `${fallbackName}${extension}`;
};

const sanitizePathSegment = (value, fallbackValue = 'unknown') => {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-');

  return normalized || fallbackValue;
};

const buildCustomerIdSegment = (customer = {}, fallbackId = 'unknown-id') =>
  sanitizePathSegment(customer?.id ?? customer?.customerId ?? fallbackId, 'unknown-id');

const buildCustomerNamePrefix = (customer = {}, fallbackName = '') =>
  sanitizePathSegment(customer?.name ?? customer?.customerName ?? fallbackName, 'customer');

const withCustomerPrefix = (fileName, customerPrefix) => {
  const normalizedName = String(fileName ?? '').trim();
  const normalizedPrefix = sanitizePathSegment(customerPrefix, 'customer');

  if (!normalizedName) {
    return `${normalizedPrefix}-attached-file.pdf`;
  }

  const lowerName = normalizedName.toLowerCase();
  const lowerPrefix = `${normalizedPrefix.toLowerCase()}-`;
  if (lowerName.startsWith(lowerPrefix)) {
    return normalizedName;
  }

  return `${normalizedPrefix}-${normalizedName}`;
};

const ensureUniqueFilePath = async (directoryPath, fileName) => {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let currentIndex = 0;

  while (true) {
    const candidateName = currentIndex === 0 ? `${baseName}${extension}` : `${baseName}-${currentIndex}${extension}`;
    const candidatePath = path.join(directoryPath, candidateName);

    try {
      await fs.access(candidatePath);
      currentIndex += 1;
    } catch {
      return {
        fileName: candidateName,
        filePath: candidatePath,
      };
    }
  }
};

const isSameLocalDate = (leftDate, rightDate) =>
  leftDate.getFullYear() === rightDate.getFullYear()
  && leftDate.getMonth() === rightDate.getMonth()
  && leftDate.getDate() === rightDate.getDate();

const resolveCreatedDate = (stats) => {
  if (Number.isFinite(stats?.birthtimeMs) && stats.birthtimeMs > 0) {
    return new Date(stats.birthtimeMs);
  }

  if (Number.isFinite(stats?.ctimeMs) && stats.ctimeMs > 0) {
    return new Date(stats.ctimeMs);
  }

  return new Date(stats?.mtimeMs ?? Date.now());
};

const collectAttachedFileLinks = (value, links = new Set()) => {
  if (typeof value === 'string') {
    const candidate = value.trim();
    if (candidate) {
      links.add(candidate);
    }
    return links;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectAttachedFileLinks(item, links));
    return links;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectAttachedFileLinks(item, links));
  }

  return links;
};

const resolveAttachedFileUrl = (value) => {
  const candidate = String(value ?? '').trim();
  if (!candidate) {
    return '';
  }

  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    return candidate;
  }

  if (candidate.startsWith('/')) {
    return buildApiUrl(candidate);
  }

  return '';
};

const isLikelyLocalFilePath = (value) => {
  const candidate = String(value ?? '').trim();
  if (!candidate) {
    return false;
  }

  if (/^[a-zA-Z]:[\\/]/.test(candidate)) {
    return true;
  }

  return candidate.startsWith('\\\\');
};

const decodeBase64FileContent = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const normalized = (raw.includes(',')
    ? raw.slice(raw.indexOf(',') + 1)
    : raw)
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  if (!normalized) {
    return null;
  }

  const padded = (() => {
    const remainder = normalized.length % 4;
    if (remainder === 0) {
      return normalized;
    }

    return `${normalized}${'='.repeat(4 - remainder)}`;
  })();

  try {
    const fileBuffer = Buffer.from(padded, 'base64');
    if (fileBuffer.length === 0) {
      return null;
    }

    return fileBuffer;
  } catch {
    return null;
  }
};

const collectAttachedFilesFromPayload = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.files)) {
    return payload.files;
  }

  if (Array.isArray(payload?.data)) {
    return payload.data;
  }

  return [];
};

const resolveAttachedFileName = (attachedFile) => {
  if (!attachedFile || typeof attachedFile !== 'object') {
    return '';
  }

  const candidateKeys = ['fileName', 'filename', 'name', 'originalFileName', 'originalFilename'];

  for (const key of candidateKeys) {
    const value = attachedFile[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
};

const resolveAttachedFileBase64 = (attachedFile) => {
  if (!attachedFile || typeof attachedFile !== 'object') {
    return '';
  }

  const candidateKeys = [
    'base64',
    'base64Data',
    'base64Content',
    'fileBase64',
    'fileData',
    'contentBase64',
    'content',
    'data',
  ];

  for (const key of candidateKeys) {
    const value = attachedFile[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  const stringValues = Object.values(attachedFile)
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  return stringValues[0] ?? '';
};

const isPdfFileName = (fileName) => path.extname(String(fileName ?? '')).toLowerCase() === '.pdf';
const isTxtFileName = (fileName) => path.extname(String(fileName ?? '')).toLowerCase() === '.txt';
const isImageFileName = (fileName) => ['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp']
  .includes(path.extname(String(fileName ?? '')).toLowerCase());

const normalizePdfText = (value) =>
  String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const extractPdfPageCount = (parsedPdf) => {
  const candidate = Number(parsedPdf?.numpages ?? parsedPdf?.numPages ?? 1);
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return 1;
  }

  return Math.floor(candidate);
};

const parsePdfTextData = async (pdfBuffer) => {
  try {
    const parsedText = await pdfParse(pdfBuffer);
    return {
      text: String(parsedText?.text ?? ''),
      totalPages: Number(parsedText?.numpages ?? parsedText?.numPages ?? 1),
      parseError: '',
    };
  } catch (error) {
    return {
      text: '',
      totalPages: 1,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
};

const createPdfFallbackTextFile = async ({
  destinationDirectory,
  originalFileName,
  reason,
}) => {
  const baseName = sanitizePathSegment(path.basename(originalFileName, path.extname(originalFileName)), 'attached-file');
  const fallbackFile = await ensureUniqueFilePath(
    destinationDirectory,
    `${baseName}-conversion-warning.txt`,
  );

  const content = [
    `Không thể tạo file txt/png tự động cho PDF: ${originalFileName}`,
    `Lý do: ${reason || 'Không xác định'}`,
  ].join('\n');

  await fs.writeFile(fallbackFile.filePath, content, 'utf8');

  return {
    sourceFileName: originalFileName,
    type: 'text-fallback',
    fileName: fallbackFile.fileName,
    path: fallbackFile.filePath,
  };
};

const renderPdfToImages = async ({
  pdfBuffer,
  destinationDirectory,
  outputPrefix,
  pageCount,
}) => {
  const [pdfjsLib, pdfjsWorker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ]);

  if (!globalThis.pdfjsWorker?.WorkerMessageHandler && pdfjsWorker?.WorkerMessageHandler) {
    globalThis.pdfjsWorker = pdfjsWorker;
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBuffer) });
  const documentProxy = await loadingTask.promise;
  const generatedImages = [];

  try {
    const totalPages = Math.min(pageCount, documentProxy.numPages);

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await documentProxy.getPage(pageNumber);
      const rawViewport = page.getViewport({ scale: 1 });
      const targetWidth = 1240;
      const scale = rawViewport.width > 0 ? targetWidth / rawViewport.width : 1;
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(Math.max(1, Math.floor(viewport.width)), Math.max(1, Math.floor(viewport.height)));
      const context = canvas.getContext('2d');

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      const imageFile = await ensureUniqueFilePath(destinationDirectory, `${outputPrefix}-${pageNumber}.png`);
      const imageBuffer = canvas.toBuffer('image/png');
      await fs.writeFile(imageFile.filePath, imageBuffer);

      generatedImages.push({
        page: pageNumber,
        fileName: imageFile.fileName,
        path: imageFile.filePath,
      });
    }
  } finally {
    await loadingTask.destroy();
  }

  return generatedImages;
};

const generatePdfDerivativeFiles = async ({
  pdfPath,
  destinationDirectory,
  originalFileName,
}) => {
  if (!isPdfFileName(originalFileName)) {
    return {
      generatedFiles: [],
      generationWarnings: [],
    };
  }

  const generatedFiles = [];
  const generationWarnings = [];
  const pdfBuffer = await fs.readFile(pdfPath);
  const parsedPdf = await parsePdfTextData(pdfBuffer);
  const normalizedText = normalizePdfText(parsedPdf?.text);
  const isTextBasedPdf = normalizedText.length > 0;

  if (parsedPdf.parseError) {
    generationWarnings.push({
      sourceFileName: originalFileName,
      reason: parsedPdf.parseError,
    });
  }

  if (isTextBasedPdf) {
    const txtBaseName = path.basename(originalFileName, path.extname(originalFileName));
    const txtFileCandidate = await ensureUniqueFilePath(
      destinationDirectory,
      `${sanitizePathSegment(txtBaseName, 'attached-file')}.txt`,
    );

    await fs.writeFile(txtFileCandidate.filePath, String(parsedPdf?.text ?? '').trim(), 'utf8');

    generatedFiles.push({
      sourceFileName: originalFileName,
      type: 'text',
      fileName: txtFileCandidate.fileName,
      path: txtFileCandidate.filePath,
    });

    return {
      generatedFiles,
      generationWarnings,
    };
  }

  const baseName = sanitizePathSegment(path.basename(originalFileName, path.extname(originalFileName)), 'attached-file');
  const outputPrefix = `${baseName}-page`;
  const pageCount = extractPdfPageCount(parsedPdf);

  try {
    const generatedImages = await renderPdfToImages({
      pdfBuffer,
      destinationDirectory,
      outputPrefix,
      pageCount,
    });

    generatedImages.forEach((image) => {
      generatedFiles.push({
        sourceFileName: originalFileName,
        type: 'image',
        page: image.page,
        fileName: image.fileName,
        path: image.path,
      });
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    generationWarnings.push({
      sourceFileName: originalFileName,
      reason,
    });
  }

  if (generatedFiles.length === 0) {
    const firstReason = generationWarnings[0]?.reason ?? parsedPdf.parseError ?? '';
    const fallbackFile = await createPdfFallbackTextFile({
      destinationDirectory,
      originalFileName,
      reason: firstReason,
    });
    generatedFiles.push(fallbackFile);
  }

  return {
    generatedFiles,
    generationWarnings,
  };
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

ipcMain.handle('po:cancel-download-files', async () => cancelDownloadPOFiles());

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

ipcMain.handle('order:upload-file', async (_, customer = {}) => {
  const pickerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const selection = await dialog.showOpenDialog(pickerWindow, {
    title: 'Chọn file để tải lên đơn hàng',
    properties: ['openFile'],
  });

  if (selection.canceled || !Array.isArray(selection.filePaths) || selection.filePaths.length === 0) {
    return {
      success: false,
      canceled: true,
      message: 'Đã hủy tải lên file.',
    };
  }

  const sourceFilePath = selection.filePaths[0];
  const sourceFileName = path.basename(sourceFilePath);

  const customerId = buildCustomerIdSegment(customer);
  const customerPrefix = buildCustomerNamePrefix(customer, customerId);
  const destinationDirectory = path.join(orderFileDirectory, customerId);

  await fs.mkdir(destinationDirectory, { recursive: true });

  const extension = path.extname(sourceFileName);
  const baseName = path.basename(sourceFileName, extension);
  const normalizedBaseName = sanitizePathSegment(baseName, 'uploaded-file');

  let targetFileName = `${customerPrefix}-${normalizedBaseName}${extension}`;
  let targetPath = path.join(destinationDirectory, targetFileName);
  let duplicateIndex = 1;

  while (true) {
    try {
      await fs.access(targetPath);
      targetFileName = `${customerPrefix}-${normalizedBaseName}-${duplicateIndex}${extension}`;
      targetPath = path.join(destinationDirectory, targetFileName);
      duplicateIndex += 1;
    } catch {
      break;
    }
  }

  await fs.copyFile(sourceFilePath, targetPath);

  const generatedFiles = [];
  const generationWarnings = [];

  try {
    const pdfDerivatives = await generatePdfDerivativeFiles({
      pdfPath: targetPath,
      destinationDirectory,
      originalFileName: targetFileName,
    });

    generatedFiles.push(...pdfDerivatives.generatedFiles);
    generationWarnings.push(...pdfDerivatives.generationWarnings);
  } catch (derivativeError) {
    generationWarnings.push({
      sourceFileName: targetFileName,
      reason: derivativeError instanceof Error ? derivativeError.message : String(derivativeError),
    });
  }

  return {
    success: true,
    canceled: false,
    message: 'Tải lên file thành công.',
    directory: destinationDirectory,
    customerId,
    fileName: targetFileName,
    path: targetPath,
    generatedFiles,
    generationWarnings,
  };
});

ipcMain.handle('ollama:upload-file', async () => {
  const pickerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const selection = await dialog.showOpenDialog(pickerWindow, {
    title: 'Chọn file để tải lên Ollama',
    properties: ['openFile'],
  });

  if (selection.canceled || !Array.isArray(selection.filePaths) || selection.filePaths.length === 0) {
    return {
      success: false,
      canceled: true,
      message: 'Đã hủy tải lên file.',
    };
  }

  const sourceFilePath = selection.filePaths[0];
  const sourceFileName = path.basename(sourceFilePath);
  const fileBuffer = await fs.readFile(sourceFilePath);

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), sourceFileName);

  const response = await fetch(ollamaUploadUrl, {
    method: 'POST',
    body: formData,
  });

  const payload = await getResponsePayload(response);

  if (!response.ok) {
    const errorMessage =
      typeof payload === 'string'
        ? payload
        : payload?.message ?? `Ollama upload failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return {
    success: true,
    canceled: false,
    fileName: sourceFileName,
    sourcePath: sourceFilePath,
    data: payload,
  };
});

ipcMain.handle('order:save-attached-files', async (_, options = {}) => {
  const customer = options?.customer ?? {};
  const customerId = buildCustomerIdSegment(customer, options?.customerId);
  const customerPrefix = buildCustomerNamePrefix(customer, customerId);
  const destinationDirectory = path.join(orderFileDirectory, customerId);

  await fs.mkdir(destinationDirectory, { recursive: true });

  const payloadData = options?.payload ?? null;
  const attachedFiles = collectAttachedFilesFromPayload(payloadData);

  const savedFiles = [];
  const failedFiles = [];
  const generatedFiles = [];
  const generationWarnings = [];

  for (const attachedFile of attachedFiles) {
    const sourceName = resolveAttachedFileName(attachedFile);
    const sourceBase64 = resolveAttachedFileBase64(attachedFile);

    const safeName = withCustomerPrefix(
      sanitizePathSegment(sourceName || 'attached-file.pdf', 'attached-file.pdf'),
      customerPrefix,
    );
    const fileBuffer = decodeBase64FileContent(sourceBase64);

    if (!fileBuffer) {
      failedFiles.push({
        source: sourceName || 'unknown-file',
        reason: 'Invalid or empty base64 content.',
      });
      continue;
    }

    try {
      const uniqueFile = await ensureUniqueFilePath(destinationDirectory, safeName);
      await fs.writeFile(uniqueFile.filePath, fileBuffer);

      try {
        const pdfDerivatives = await generatePdfDerivativeFiles({
          pdfPath: uniqueFile.filePath,
          destinationDirectory,
          originalFileName: uniqueFile.fileName,
        });
        generatedFiles.push(...pdfDerivatives.generatedFiles);
        generationWarnings.push(...pdfDerivatives.generationWarnings);
      } catch (derivativeError) {
        generationWarnings.push({
          sourceFileName: uniqueFile.fileName,
          reason: derivativeError instanceof Error ? derivativeError.message : String(derivativeError),
        });
      }

      savedFiles.push({
        source: sourceName || safeName,
        fileName: uniqueFile.fileName,
        path: uniqueFile.filePath,
      });
    } catch (error) {
      failedFiles.push({
        source: sourceName || safeName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const allCandidates = [...collectAttachedFileLinks(payloadData)];
  const fileCandidates = allCandidates.filter((candidate) => {
    const lowered = candidate.toLowerCase();
    return lowered.startsWith('http://')
      || lowered.startsWith('https://')
      || lowered.startsWith('/')
      || isLikelyLocalFilePath(candidate);
  });

  const headers = {};
  if (authState.token) {
    headers.Authorization = `Bearer ${authState.token}`;
  }
  headers.CustomHeader = 'thevietfresh.com';

  if (savedFiles.length === 0 && fileCandidates.length > 0) {
    for (const candidate of fileCandidates) {
      if (isLikelyLocalFilePath(candidate)) {
        try {
          const sourcePath = path.normalize(String(candidate).trim());
          const sourceStats = await fs.stat(sourcePath);

          if (!sourceStats.isFile()) {
            failedFiles.push({
              source: candidate,
              reason: 'Source path is not a file.',
            });
            continue;
          }

          const originalName = path.basename(sourcePath) || 'attached-file.pdf';
          const safeName = withCustomerPrefix(
            sanitizePathSegment(originalName, 'attached-file.pdf'),
            customerPrefix,
          );
          const uniqueFile = await ensureUniqueFilePath(destinationDirectory, safeName);

          await fs.copyFile(sourcePath, uniqueFile.filePath);

          try {
            const pdfDerivatives = await generatePdfDerivativeFiles({
              pdfPath: uniqueFile.filePath,
              destinationDirectory,
              originalFileName: uniqueFile.fileName,
            });
            generatedFiles.push(...pdfDerivatives.generatedFiles);
            generationWarnings.push(...pdfDerivatives.generationWarnings);
          } catch (derivativeError) {
            generationWarnings.push({
              sourceFileName: uniqueFile.fileName,
              reason: derivativeError instanceof Error ? derivativeError.message : String(derivativeError),
            });
          }

          savedFiles.push({
            source: candidate,
            fileName: uniqueFile.fileName,
            path: uniqueFile.filePath,
          });

          continue;
        } catch (error) {
          failedFiles.push({
            source: candidate,
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }

      const resolvedUrl = resolveAttachedFileUrl(candidate);
      if (!resolvedUrl) {
        continue;
      }

      try {
        const response = await fetch(resolvedUrl, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          failedFiles.push({
            source: candidate,
            reason: `Download failed with status ${response.status}`,
          });
          continue;
        }

        const urlBaseName = path.basename(new URL(resolvedUrl).pathname || '') || 'attached-file';
        const fallbackName = sanitizePathSegment(urlBaseName, 'attached-file');
        const suggestedName = withCustomerPrefix(
          sanitizePathSegment(extractFileNameFromResponse(response, fallbackName), fallbackName),
          customerPrefix,
        );

        const uniqueFile = await ensureUniqueFilePath(destinationDirectory, suggestedName);
        const downloadedBuffer = Buffer.from(await response.arrayBuffer());

        if (downloadedBuffer.length === 0) {
          failedFiles.push({
            source: candidate,
            reason: 'File content is empty.',
          });
          continue;
        }

        await fs.writeFile(uniqueFile.filePath, downloadedBuffer);

        try {
          const pdfDerivatives = await generatePdfDerivativeFiles({
            pdfPath: uniqueFile.filePath,
            destinationDirectory,
            originalFileName: uniqueFile.fileName,
          });
          generatedFiles.push(...pdfDerivatives.generatedFiles);
          generationWarnings.push(...pdfDerivatives.generationWarnings);
        } catch (derivativeError) {
          generationWarnings.push({
            sourceFileName: uniqueFile.fileName,
            reason: derivativeError instanceof Error ? derivativeError.message : String(derivativeError),
          });
        }

        savedFiles.push({
          source: candidate,
          fileName: uniqueFile.fileName,
          path: uniqueFile.filePath,
        });
      } catch (error) {
        failedFiles.push({
          source: candidate,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const totalCandidateCount = attachedFiles.length > 0 ? attachedFiles.length : fileCandidates.length;
  const hasApiPath = typeof readAttachedFilesPath === 'string' && readAttachedFilesPath.trim().length > 0;

  return {
    success: true,
    directory: destinationDirectory,
    snapshotPath: null,
    savedFiles,
    failedFiles,
    generatedFiles,
    generationWarnings,
    totalCandidateCount,
    usedReadAttachedFilesPath: hasApiPath,
  };
});

ipcMain.handle('order:list-downloaded-files', async (_, options = {}) => {
  const inputIds = Array.isArray(options?.customerIds) ? options.customerIds : [];
  const onlyToday = options?.onlyToday !== false;
  const today = new Date();

  const normalizedIds = [...new Set(
    inputIds.map((value) => sanitizePathSegment(value, 'unknown-id')),
  )];

  const filesByCustomerId = {};

  for (const customerId of normalizedIds) {
    const directoryPath = path.join(orderFileDirectory, customerId);

    try {
      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        if (/^attached-files-\d+\.json$/i.test(entry.name)) {
          continue;
        }

        const filePath = path.join(directoryPath, entry.name);
        const stats = await fs.stat(filePath);
        const createdAt = resolveCreatedDate(stats);

        if (onlyToday && !isSameLocalDate(createdAt, today)) {
          continue;
        }

        files.push({
          fileName: entry.name,
          createdAt: createdAt.toISOString(),
        });
      }

      files.sort((left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );

      filesByCustomerId[customerId] = files;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        filesByCustomerId[customerId] = [];
        continue;
      }

      throw error;
    }
  }

  return {
    success: true,
    onlyToday,
    filesByCustomerId,
  };
});

ipcMain.handle('order:open-file', async (_, options = {}) => {
  const customerId = sanitizePathSegment(options?.customerId, 'unknown-id');
  const fileName = typeof options?.fileName === 'string' ? options.fileName.trim() : '';

  if (!fileName) {
    throw new Error('File name is required.');
  }

  const customerDirectory = path.resolve(orderFileDirectory, customerId);
  const targetPath = path.resolve(customerDirectory, fileName);
  const relativePath = path.relative(customerDirectory, targetPath);

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
    customerId,
    fileName,
    path: targetPath,
  };
});

ipcMain.handle('order:open-directory', async (_, options = {}) => {
  const customerId = sanitizePathSegment(options?.customerId, 'unknown-id');
  const customerDirectory = path.resolve(orderFileDirectory, customerId);
  const relativePath = path.relative(path.resolve(orderFileDirectory), customerDirectory);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid customer directory.');
  }

  await fs.mkdir(customerDirectory, { recursive: true });

  const openError = await shell.openPath(customerDirectory);
  if (openError) {
    throw new Error(openError);
  }

  return {
    success: true,
    customerId,
    path: customerDirectory,
  };
});

const resolveExistingPath = async (candidates = []) => {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
    }
  }

  return '';
};

const readOrderSchemaTemplate = async () => {
  const schemaCandidates = [
    path.join(getAppPathSafe(), 'src', 'assets', 'schema.json'),
    path.join(process.cwd(), 'src', 'assets', 'schema.json'),
    path.join(getAppPathSafe(), 'assets', 'schema.json'),
  ];

  const schemaPath = await resolveExistingPath(schemaCandidates);
  if (!schemaPath) {
    return {
      schemaPath: '',
      schemaTemplate: '',
    };
  }

  return {
    schemaPath,
    schemaTemplate: await fs.readFile(schemaPath, 'utf8'),
  };
};

const loadTesseractCreateWorker = () => {
  try {
    const tesseractModule = require('tesseract.js');
    if (typeof tesseractModule?.createWorker === 'function') {
      return tesseractModule.createWorker;
    }
  } catch {
  }

  throw new Error('Không thể tải tesseract.js. Vui lòng cài lại dependencies và khởi động lại ứng dụng.');
};

const extractTextFromImageWithTesseract = async (imagePath) => {
  let worker;
  const createWorker = loadTesseractCreateWorker();

  try {
    try {
      worker = await createWorker('eng+vie');
    } catch {
      worker = await createWorker('eng');
    }

    const recognitionResult = await worker.recognize(imagePath);
    return String(recognitionResult?.data?.text ?? '');
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
      }
    }
  }
};

const composePromptWithInput = ({ promptTemplate, inputText, schemaTemplate = '' }) => {
  const marker = 'INPUT TEXT:';
  const normalizedPromptTemplate = String(promptTemplate ?? '');
  const normalizedInputText = String(inputText ?? '');
  const normalizedSchemaTemplate = String(schemaTemplate ?? '').trim();
  const promptWithSchema = normalizedSchemaTemplate
    ? `${normalizedPromptTemplate}\n\nOUTPUT JSON SCHEMA (must match):\n${normalizedSchemaTemplate}`
    : normalizedPromptTemplate;

  const markerIndex = promptWithSchema.indexOf(marker);
  if (markerIndex < 0) {
    return `${promptWithSchema}\n\n${marker}\n${normalizedInputText}`;
  }

  const beforeMarker = promptWithSchema.slice(0, markerIndex + marker.length);
  const afterMarker = promptWithSchema.slice(markerIndex + marker.length);
  const needsLeadingBreak = afterMarker.startsWith('\n') || afterMarker.startsWith('\r\n');

  return `${beforeMarker}\n${normalizedInputText}${needsLeadingBreak ? '' : '\n'}${afterMarker}`;
};

const normalizeDateLabel = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }

  const ymdMatch = raw.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    return `${day}/${month}/${year}`;
  }

  const dmyMatch = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    return `${day}/${month}/${year}`;
  }

  return raw;
};

const parseLooseNumber = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return 0;
  }

  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) {
    return 0;
  }

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;

  if (hasComma && hasDot) {
    normalized = cleaned.replace(/,/g, '');
  } else if (hasComma && !hasDot) {
    normalized = cleaned.replace(/,/g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstGroupMatch = (text, patterns = []) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return String(match[1]).trim();
    }
  }

  return '';
};

const buildOrderJsonFromOcrText = (ocrText) => {
  const text = String(ocrText ?? '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const poNumber = firstGroupMatch(text, [
    /\bpo\s*(?:number|no\.?|#)?\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
    /\bs[oố]\s*po\s*[:\-]?\s*([A-Z0-9\-\/]+)/i,
  ]);

  const orderDateLabeled = firstGroupMatch(text, [
    /(?:order\s*date|ng[aà]y\s*[đd][aặ]t)\s*[:\-]?\s*(\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})/i,
  ]);

  const deliveryDateLabeled = firstGroupMatch(text, [
    /(?:delivery\s*date|ng[aà]y\s*giao(?:\s*d[ựu]\s*ki[eế]n)?)\s*[:\-]?\s*(\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})/i,
  ]);

  const allDateMatches = [...text.matchAll(/\b(\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4})\b/g)]
    .map((match) => normalizeDateLabel(match[1]))
    .filter(Boolean);

  const orderDate = normalizeDateLabel(orderDateLabeled) || allDateMatches[0] || '';
  const deliveryDate = normalizeDateLabel(deliveryDateLabeled) || allDateMatches[1] || '';

  const subtotalLabel = firstGroupMatch(text, [
    /(?:sub\s*total|subtotal|t[aạ]m\s*t[ií]nh|th[aà]nh\s*ti[eề]n)\s*[:\-]?\s*([\d.,]+)/i,
  ]);
  const vatPercentLabel = firstGroupMatch(text, [
    /(?:vat|thu[eế]\s*vat)\s*[:\-]?\s*([\d.,]+)\s*%/i,
  ]);
  const vatAmountLabel = firstGroupMatch(text, [
    /(?:vat\s*amount|ti[eề]n\s*vat)\s*[:\-]?\s*([\d.,]+)/i,
  ]);
  const totalAmountLabel = firstGroupMatch(text, [
    /(?:grand\s*total|total\s*amount|t[oổ]ng\s*c[oộ]ng)\s*[:\-]?\s*([\d.,]+)/i,
  ]);

  const subtotal = parseLooseNumber(subtotalLabel);
  const vatPercent = parseLooseNumber(vatPercentLabel);
  const vatAmount = parseLooseNumber(vatAmountLabel);
  const totalAmount = parseLooseNumber(totalAmountLabel) || subtotal + vatAmount;

  const itemLines = lines.filter((line) => {
    const numberMatches = line.match(/\d[\d.,]*/g) ?? [];
    return numberMatches.length >= 3 && /[A-Za-z\u00C0-\u1EF9]/.test(line);
  });

  const items = itemLines.slice(0, 25).map((line, index) => {
    const numbers = line.match(/\d[\d.,]*/g) ?? [];
    const quantityRaw = numbers[numbers.length - 3] ?? '0';
    const unitPriceRaw = numbers[numbers.length - 2] ?? '0';
    const totalRaw = numbers[numbers.length - 1] ?? '0';

    let description = line;
    numbers.forEach((value) => {
      description = description.replace(value, ' ');
    });
    description = description.replace(/^\s*\d+\s*[.)-]?\s*/, '').replace(/\s+/g, ' ').trim();

    return {
      line_number: index + 1,
      description: description || `Item ${index + 1}`,
      unit: '',
      quantity: parseLooseNumber(quantityRaw),
      unit_price: parseLooseNumber(unitPriceRaw),
      total_price: parseLooseNumber(totalRaw),
      note: '',
    };
  });

  const deliveryNote = lines.find((line) =>
    /mang theo don dat hang|delivery|receiving section|giao hang/i.test(line)) ?? '';

  const currency = /\bUSD\b/i.test(text)
    ? 'USD'
    : /\bVND\b|\bVNĐ\b|\bđ\b/i.test(text)
      ? 'VND'
      : 'VND';

  return {
    purchase_order: {
      po_number: poNumber,
      order_date: orderDate,
      delivery_date: deliveryDate,
    },
    items,
    financial_summary: {
      currency,
      sub_total: subtotal,
      vat_percent: vatPercent,
      vat_amount: vatAmount,
      total_amount: totalAmount,
    },
    delivery_note: deliveryNote,
  };
};

const composeOrderPromptFromSource = async (options = {}) => {
  const customerId = sanitizePathSegment(options?.customerId, 'unknown-id');
  const fileName = typeof options?.fileName === 'string' ? options.fileName.trim() : '';
  const requestedPromptId = String(options?.promptId ?? '').trim();

  if (!fileName) {
    throw new Error('Tên file xử lý là bắt buộc.');
  }

  const isTxt = isTxtFileName(fileName);
  const isImage = isImageFileName(fileName);
  if (!isTxt && !isImage) {
    throw new Error('Chỉ hỗ trợ file txt hoặc image (.png/.jpg/.jpeg/.bmp/.tif/.tiff/.webp).');
  }

  const customerDirectory = path.resolve(orderFileDirectory, customerId);
  const sourceFilePath = path.resolve(customerDirectory, fileName);
  const sourceRelativePath = path.relative(customerDirectory, sourceFilePath);

  if (sourceRelativePath.startsWith('..') || path.isAbsolute(sourceRelativePath)) {
    throw new Error('Tên file không hợp lệ.');
  }

  await fs.access(sourceFilePath);

  const extractedText = isTxt
    ? String(await fs.readFile(sourceFilePath, 'utf8') ?? '')
    : String(await extractTextFromImageWithTesseract(sourceFilePath) ?? '');

  if (!String(extractedText).trim()) {
    throw new Error('Không trích xuất được nội dung từ file đã chọn.');
  }

  if (isImage) {
    const { schemaPath } = await readOrderSchemaTemplate();
    const parsedPayload = buildOrderJsonFromOcrText(extractedText);

    return {
      success: true,
      customerId,
      fileName,
      promptId: requestedPromptId || '1590',
      sourceType: 'image',
      sourceFilePath,
      promptPath: '',
      schemaPath,
      normalizedText: extractedText,
      composedPrompt: '',
      generatedText: JSON.stringify(parsedPayload, null, 2),
      ollamaResult: null,
    };
  }

  const promptId = requestedPromptId || '1590';
  const promptFileName = `${sanitizePathSegment(promptId, promptId)}.txt`;
  const promptCandidates = [
    path.join(getAppPathSafe(), 'src', 'prompt', promptFileName),
    path.join(process.cwd(), 'src', 'prompt', promptFileName),
    path.join(getAppPathSafe(), 'prompt', promptFileName),
  ];

  const promptPath = await resolveExistingPath(promptCandidates);
  if (!promptPath) {
    throw new Error(`Không tìm thấy file prompt: ${promptFileName}`);
  }

  const promptTemplate = await fs.readFile(promptPath, 'utf8');
  const { schemaPath, schemaTemplate } = await readOrderSchemaTemplate();
  const composedPrompt = composePromptWithInput({
    promptTemplate,
    inputText: extractedText,
    schemaTemplate,
  });

  const ownerWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  await dialog.showMessageBox(ownerWindow, {
    type: 'info',
    title: 'Composed Prompt',
    message: 'Composed prompt đã được tạo.',
    detail: composedPrompt,
    buttons: ['OK'],
    noLink: true,
  });

  const ollamaResponse = await axios.post('http://localhost:11434/api/generate', {
    model: 'llama3',
    prompt: composedPrompt,
    stream: false,
  });

  const generatedText = typeof ollamaResponse?.data?.response === 'string'
    ? ollamaResponse.data.response
    : '';

  return {
    success: true,
    customerId,
    fileName,
    promptId,
    sourceType: isTxt ? 'txt' : 'image',
    sourceFilePath,
    promptPath,
    schemaPath,
    normalizedText: extractedText,
    composedPrompt,
    generatedText,
    ollamaResult: ollamaResponse?.data ?? null,
  };
};

ipcMain.handle('order:compose-prompt-from-txt', async (_, options = {}) => {
  return composeOrderPromptFromSource(options);
});

ipcMain.handle('order:compose-prompt-from-file', async (_, options = {}) =>
  composeOrderPromptFromSource(options));

ipcMain.handle('printer:list-available', async () => listAvailableNetworkPrinters());
ipcMain.handle('printer:list-network', async () => listAvailableNetworkPrinters());

ipcMain.handle('printer:print-directory', async (_, options = {}) =>
  printFilesFromDirectory(options),
);

ipcMain.handle('printer:print-po-file', async (_, options = {}) => {
  const fileName = typeof options.fileName === 'string' ? options.fileName.trim() : '';
  const printerName = typeof options.printerName === 'string' ? options.printerName.trim() : '';
  const copies = Number.isFinite(options.copies) ? Math.max(1, Math.floor(options.copies)) : 1;
  const duplex = Boolean(options.duplex);

  if (!fileName) {
    throw new Error('File name is required.');
  }

  const rootDirectory = path.resolve(poDownloadDirectory);
  const targetPath = path.resolve(rootDirectory, fileName);
  const relativePath = path.relative(rootDirectory, targetPath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid file name.');
  }

  await fs.access(targetPath);

  return printFileWithOptions({
    filePath: targetPath,
    printerName,
    copies,
    duplex,
  });
});

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
electronApp?.whenReady?.().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
electronApp?.on?.('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    electronApp?.quit?.();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
