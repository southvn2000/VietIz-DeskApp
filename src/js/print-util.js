const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { BrowserWindow } = require('electron');

const execFileAsync = promisify(execFile);

const parsePdfDateToMs = (rawValue) => {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    return null;
  }

  const normalized = value.startsWith('D:') ? value.slice(2) : value;
  const dateMatch = normalized.match(
    /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz]|[+\-]\d{2}'?\d{2}'?)?$/,
  );

  if (!dateMatch) {
    return null;
  }

  const year = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2] ?? '01', 10);
  const day = Number.parseInt(dateMatch[3] ?? '01', 10);
  const hour = Number.parseInt(dateMatch[4] ?? '00', 10);
  const minute = Number.parseInt(dateMatch[5] ?? '00', 10);
  const second = Number.parseInt(dateMatch[6] ?? '00', 10);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }

  const offsetRaw = dateMatch[7] ?? 'Z';
  const utcMs = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second);

  if (offsetRaw.toUpperCase() === 'Z') {
    return utcMs;
  }

  const compactOffset = offsetRaw.replace(/'/g, '');
  const sign = compactOffset.startsWith('-') ? -1 : 1;
  const offsetHour = Number.parseInt(compactOffset.slice(1, 3), 10);
  const offsetMinute = Number.parseInt(compactOffset.slice(3, 5), 10);

  if (!Number.isFinite(offsetHour) || !Number.isFinite(offsetMinute)) {
    return utcMs;
  }

  const offsetMs = sign * ((offsetHour * 60 + offsetMinute) * 60 * 1000);
  return utcMs - offsetMs;
};

const extractPdfCreationDateMs = async (filePath) => {
  try {
    const buffer = await fs.readFile(filePath);
    const text = buffer.toString('latin1');
    const creationDateMatch = text.match(/\/CreationDate\s*\(([^)]+)\)/i);

    if (!creationDateMatch?.[1]) {
      return null;
    }

    return parsePdfDateToMs(creationDateMatch[1]);
  } catch {
    return null;
  }
};

const extractCreatedDateFromFileMs = async (filePath) => {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.pdf') {
    return extractPdfCreationDateMs(filePath);
  }

  return null;
};

const normalizePrinterList = (printerData) => {
  if (!printerData) {
    return [];
  }

  const printers = Array.isArray(printerData) ? printerData : [printerData];
  return printers
    .map((printer) => {
      const type = printer?.Type ?? '';
      const portName = printer?.PortName ?? '';
      const computerName = printer?.ComputerName ?? '';

      const isNetwork =
        type === 'Connection' ||
        (typeof portName === 'string' && portName.startsWith('\\')) ||
        (typeof computerName === 'string' && computerName.trim().length > 0);

      const name = printer?.Name ?? '';

      const isAvailable =
        typeof name === 'string' &&
        name.trim().length > 0 &&
        name.toLowerCase() !== 'microsoft xps document writer';

      return {
        name,
        computerName,
        type,
        portName,
        driverName: printer?.DriverName ?? '',
        status: printer?.PrinterStatus ?? null,
        isNetwork,
        isAvailable,
      };
    })
    .filter((printer) => printer.isAvailable)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
};

const listAvailableNetworkPrinters = async () => {
  if (process.platform !== 'win32') {
    return [];
  }

  const psScript = [
    'Get-Printer',
    '| Select-Object Name,ComputerName,Type,Shared,PortName,DriverName,PrinterStatus',
    '| ConvertTo-Json -Depth 3',
  ].join(' ');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    psScript,
  ]);

  if (!stdout || stdout.trim().length === 0) {
    return [];
  }

  const parsed = JSON.parse(stdout);
  return normalizePrinterList(parsed);
};

const listFilesInDirectory = async (directoryPath) => {
  if (!directoryPath) {
    throw new Error('directoryPath is required.');
  }

  await fs.mkdir(directoryPath, { recursive: true });

  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const fileEntries = entries.filter((entry) => entry.isFile());

  const resolveCreatedAtMs = (stats) => {
    const candidates = [stats?.birthtimeMs, stats?.ctimeMs, stats?.mtimeMs].filter(
      (value) => Number.isFinite(value) && value > 0,
    );

    if (candidates.length === 0) {
      return null;
    }

    return candidates[0];
  };

  const filesWithMetadata = await Promise.all(
    fileEntries.map(async (entry) => {
      const fullPath = path.join(directoryPath, entry.name);
      const stats = await fs.stat(fullPath);
      const fileCreatedAtMs = await extractCreatedDateFromFileMs(fullPath);
      const createdAtMs = fileCreatedAtMs ?? resolveCreatedAtMs(stats);

      return {
        name: entry.name,
        createdAt: createdAtMs ? new Date(createdAtMs).toISOString() : null,
        createdAtMs,
      };
    }),
  );

  return filesWithMetadata.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
  );
};

const escapePowerShellSingleQuoted = (value) => value.replace(/'/g, "''");

const printFile = async (filePath, printerName) => {
  if (process.platform !== 'win32') {
    throw new Error('Printing local files is only supported on Windows.');
  }

  const escapedFilePath = escapePowerShellSingleQuoted(filePath);
  const hasPrinterName = typeof printerName === 'string' && printerName.trim().length > 0;

  const command = hasPrinterName
    ? `Start-Process -FilePath '${escapedFilePath}' -Verb PrintTo -ArgumentList '\"${escapePowerShellSingleQuoted(printerName.trim())}\"' -WindowStyle Hidden -Wait`
    : `Start-Process -FilePath '${escapedFilePath}' -Verb Print -WindowStyle Hidden -Wait`;

  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command]);
};

const printFileWithOptions = async ({
  filePath,
  printerName,
  copies = 1,
  duplex = true,
}) => {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('filePath is required.');
  }

  await fs.access(filePath);

  const printWindow = new BrowserWindow({
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      plugins: true,
    },
  });

  const fileUrl = pathToFileURL(filePath).toString();

  try {
    await printWindow.loadURL(fileUrl);

    const isPdfFile = path.extname(filePath).toLowerCase() === '.pdf';
    if (isPdfFile) {
      await new Promise((resolve) => {
        setTimeout(resolve, 450);
      });
    }

    await new Promise((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: typeof printerName === 'string' ? printerName.trim() : '',
          copies: Math.max(1, Number.parseInt(copies, 10) || 1),
          duplexMode: duplex ? 'longEdge' : 'simplex',
        },
        (success, failureReason) => {
          if (!success) {
            reject(new Error(failureReason || 'Print failed.'));
            return;
          }

          resolve();
        },
      );
    });

    return {
      success: true,
      filePath,
      printerName: typeof printerName === 'string' ? printerName.trim() : '',
      copies: Math.max(1, Number.parseInt(copies, 10) || 1),
      duplex: Boolean(duplex),
    };
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
};

const getUniqueDestinationPath = async (targetDirectory, fileName) => {
  const parsedName = path.parse(fileName);
  let attempt = 0;

  while (true) {
    const suffix = attempt === 0 ? '' : `_${attempt}`;
    const candidateName = `${parsedName.name}${suffix}${parsedName.ext}`;
    const candidatePath = path.join(targetDirectory, candidateName);

    try {
      await fs.access(candidatePath);
      attempt += 1;
    } catch {
      return candidatePath;
    }
  }
};

const moveFileToDirectory = async (sourcePath, targetDirectory, fileName) => {
  const destinationPath = await getUniqueDestinationPath(targetDirectory, fileName);

  try {
    await fs.rename(sourcePath, destinationPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }

    await fs.copyFile(sourcePath, destinationPath);
    await fs.unlink(sourcePath);
  }

  return destinationPath;
};

const printFilesFromDirectory = async ({
  sourceDirectory,
  processedDirectory,
  printerName,
}) => {
  if (!sourceDirectory || !processedDirectory) {
    throw new Error('sourceDirectory and processedDirectory are required.');
  }

  await fs.mkdir(processedDirectory, { recursive: true });

  const printedFiles = [];
  const failedFiles = [];

  while (true) {
    const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

    if (files.length === 0) {
      break;
    }

    let movedThisPass = 0;

    for (const fileName of files) {
      const sourcePath = path.join(sourceDirectory, fileName);

      try {
        await printFile(sourcePath, printerName);
        const movedPath = await moveFileToDirectory(sourcePath, processedDirectory, fileName);
        printedFiles.push(movedPath);
        movedThisPass += 1;
      } catch (error) {
        failedFiles.push({
          file: sourcePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (movedThisPass === 0) {
      break;
    }
  }

  const remainingEntries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  const remainingFiles = remainingEntries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(sourceDirectory, entry.name));

  return {
    success: remainingFiles.length === 0,
    message:
      remainingFiles.length === 0
        ? 'All files were printed and moved.'
        : 'Stopped with unprocessed files remaining in source directory.',
    printedCount: printedFiles.length,
    failedCount: failedFiles.length,
    printedFiles,
    failedFiles,
    remainingFiles,
    sourceDirectory,
    processedDirectory,
  };
};

module.exports = {
  listAvailableNetworkPrinters,
  listFilesInDirectory,
  printFilesFromDirectory,
  printFileWithOptions,
};
