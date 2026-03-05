const formatDateForInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDisplayDateFromKey = (dateKey) => {
  const parsedKey = parseInputDateToLocalDateKey(dateKey);
  if (!parsedKey) {
    return '';
  }

  const [year, month, day] = parsedKey.split('-');
  return `${day}/${month}/${year}`;
};

const parseInputDateToLocalDateKey = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }

  const candidate = new Date(year, month - 1, day);
  const isValidDate =
    candidate.getFullYear() === year &&
    candidate.getMonth() === month - 1 &&
    candidate.getDate() === day;

  if (!isValidDate) {
    return null;
  }

  return getLocalDateKey(candidate);
};

const resetPrinterOptions = (selectElement, placeholderText) => {
  selectElement.innerHTML = '';

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholderText;
  selectElement.appendChild(placeholderOption);
};

const fillPrinterOptions = (selectElement, printers) => {
  const uniquePrinterNames = [...new Set(printers.map((printer) => printer?.name).filter(Boolean))];

  uniquePrinterNames.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    selectElement.appendChild(option);
  });
};

const formatSequence = (index) => String(index + 1).padStart(2, '0');
const BULK_PROGRESS_AUTO_HIDE_MS = 10_000;
const BULK_PRINT_REQUEST_DELAY_MS = 800;

const sleep = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const buildEmptyRowTemplate = (message) => `
  <tr>
    <td colspan="7" class="inpo-table__empty">${message}</td>
  </tr>
`;

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatDateTime = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};

const getLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatCreatedDate = (value) => {
  if (value === null || value === undefined || value === '') {
    return '--';
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return '--';
  }

  return formatDateTime(parsedDate);
};

const normalizeFileRecord = (record) => {
  if (typeof record === 'string') {
    return {
      name: record,
      createdAt: null,
    };
  }

  if (record && typeof record === 'object') {
    const fallbackTimestamp = Number.isFinite(record.createdAtMs) ? record.createdAtMs : null;

    return {
      name: String(record.name ?? '').trim(),
      createdAt: record.createdAt ?? fallbackTimestamp,
    };
  }

  return {
    name: '',
    createdAt: null,
  };
};

const buildFileRowTemplate = (record, index) => {
  const fileName = String(record?.name ?? '').trim();
  const safeFileName = escapeHtml(fileName);
  const createdDateLabel = escapeHtml(formatCreatedDate(record?.createdAt));

  return `
    <tr>
      <td class="inpo-table__checkbox-col"><input data-po-select type="checkbox" /></td>
      <td class="inpo-table__center">${formatSequence(index)}</td>
      <td>
        <button class="inpo-po-link" type="button" data-open-po-file data-file-name="${safeFileName}" title="Mở file ${safeFileName}">${safeFileName}</button>
      </td>
      <td class="inpo-table__center">${createdDateLabel}</td>
      <td class="inpo-table__center"><input type="checkbox" checked /></td>
      <td class="inpo-table__center"><input class="inpo-copy-input" type="number" value="1" min="1" /></td>
      <td class="inpo-table__center">
        <button class="inpo-row-action" type="button" aria-label="In ${safeFileName}">
          <span class="material-symbols-outlined">print</span>
        </button>
      </td>
    </tr>
  `;
};

const filterFilesByDate = (files, selectedDate) => {
  const dateKey = parseInputDateToLocalDateKey(selectedDate);
  if (!dateKey) {
    return dateKey === '' ? files : [];
  }

  return files.filter((record) => {
    if (record?.createdAt === null || record?.createdAt === undefined || record?.createdAt === '') {
      return false;
    }

    const parsedDate = new Date(record.createdAt);
    if (Number.isNaN(parsedDate.getTime())) {
      return false;
    }

    return getLocalDateKey(parsedDate) === dateKey;
  });
};

const fetchPOFiles = async () => {
  const files = await window.appApi.listPODownloadFiles();

  return Array.isArray(files)
    ? files
        .map((record) => normalizeFileRecord(record))
        .filter((record) => record.name.length > 0)
    : [];
};

const extractFileNameFromPath = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  const segments = normalized.split(/[/\\]+/);
  return segments[segments.length - 1] ?? '';
};

const getDownloadedCount = (downloadResult) => {
  if (Number.isFinite(downloadResult?.downloadedCount) && downloadResult.downloadedCount >= 0) {
    return downloadResult.downloadedCount;
  }

  const files = Array.isArray(downloadResult?.files) ? downloadResult.files : [];
  const uniqueNames = new Set(
    files
      .map((value) => extractFileNameFromPath(value).toLowerCase())
      .filter((name) => name.length > 0),
  );

  return uniqueNames.size;
};

const renderPOFiles = ({ screen, files, selectedDate = '' }) => {
  const tbody = screen.querySelector('#inpo-po-tbody');
  if (!tbody) {
    return;
  }

  if (!Array.isArray(files) || files.length === 0) {
    tbody.innerHTML = buildEmptyRowTemplate('Không có file PO trong thư mục tải xuống.');
    return;
  }

  const filteredFiles = filterFilesByDate(files, selectedDate);
  if (filteredFiles.length === 0) {
    tbody.innerHTML = buildEmptyRowTemplate('Không có file PO theo ngày đã chọn.');
    return;
  }

  tbody.innerHTML = filteredFiles.map((record, index) => buildFileRowTemplate(record, index)).join('');
};

const wireOpenFileActions = (screen) => {
  const tbody = screen.querySelector('#inpo-po-tbody');
  if (!tbody) {
    return;
  }

  tbody.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-open-po-file]');
    if (!trigger) {
      return;
    }

    const fileName = trigger.dataset.fileName;
    if (!fileName) {
      return;
    }

    const button = trigger;
    button.disabled = true;

    try {
      await window.appApi.openPOFile(fileName);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      window.alert(`Không thể mở file: ${errorMessage}`);
    } finally {
      button.disabled = false;
    }
  });
};

const wireRowPrintActions = (screen) => {
  const tbody = screen.querySelector('#inpo-po-tbody');
  const printerSelect = screen.querySelector('#inpo-printer-select');

  if (!tbody || !printerSelect) {
    return;
  }

  tbody.addEventListener('click', async (event) => {
    const printButton = event.target.closest('.inpo-row-action');
    if (!printButton) {
      return;
    }

    const selectedPrinter = printerSelect.value?.trim();
    if (!selectedPrinter) {
      window.alert('Vui lòng chọn máy in trước khi in PO.');
      return;
    }

    const row = printButton.closest('tr');
    if (!row) {
      return;
    }

    const fileButton = row.querySelector('[data-open-po-file]');
    const fileName = fileButton?.dataset?.fileName?.trim();
    if (!fileName) {
      window.alert('Không xác định được file PO để in.');
      return;
    }

    const duplexCheckbox = row.querySelector('td:nth-child(5) input[type="checkbox"]');
    const copiesInput = row.querySelector('.inpo-copy-input');

    const duplex = Boolean(duplexCheckbox?.checked);
    const copiesValue = Number.parseInt(copiesInput?.value ?? '1', 10);
    const copies = Number.isFinite(copiesValue) && copiesValue > 0 ? copiesValue : 1;

    printButton.disabled = true;

    try {
      await window.appApi.printPOFile({
        fileName,
        printerName: selectedPrinter,
        copies,
        duplex,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      window.alert(`Không thể in file ${fileName}: ${errorMessage}`);
    } finally {
      printButton.disabled = false;
    }
  });
};

const getRowPrintPayload = (row) => {
  const fileButton = row.querySelector('[data-open-po-file]');
  const fileName = fileButton?.dataset?.fileName?.trim();

  const duplexCheckbox = row.querySelector('td:nth-child(5) input[type="checkbox"]');
  const copiesInput = row.querySelector('.inpo-copy-input');

  const duplex = Boolean(duplexCheckbox?.checked);
  const copiesValue = Number.parseInt(copiesInput?.value ?? '1', 10);
  const copies = Number.isFinite(copiesValue) && copiesValue > 0 ? copiesValue : 1;

  return {
    fileName,
    duplex,
    copies,
  };
};

const wireBulkPrintActions = (screen) => {
  const printerSelect = screen.querySelector('#inpo-printer-select');
  const bulkPrintButton = screen.querySelector('.inpo-page__actions .inpo-btn--primary');
  const progressSection = screen.querySelector('#inpo-bulk-progress');
  const progressCount = screen.querySelector('#inpo-bulk-progress-count');
  const progressBar = screen.querySelector('#inpo-bulk-progress-bar');
  const progressStatus = screen.querySelector('#inpo-bulk-progress-status');
  const progressTrack = screen.querySelector('.inpo-progress__track');

  if (!printerSelect || !bulkPrintButton) {
    return;
  }

  let progressAutoHideTimer = null;

  const clearProgressAutoHideTimer = () => {
    if (progressAutoHideTimer) {
      clearTimeout(progressAutoHideTimer);
      progressAutoHideTimer = null;
    }
  };

  const scheduleProgressAutoHide = () => {
    if (!progressSection) {
      return;
    }

    clearProgressAutoHideTimer();
    progressAutoHideTimer = setTimeout(() => {
      progressSection.hidden = true;
      progressAutoHideTimer = null;
    }, BULK_PROGRESS_AUTO_HIDE_MS);
  };

  const updateProgress = ({ current, total, status }) => {
    const safeTotal = Math.max(0, total);
    const safeCurrent = Math.min(Math.max(0, current), safeTotal);
    const percent = safeTotal > 0 ? Math.round((safeCurrent / safeTotal) * 100) : 0;

    if (progressSection) {
      progressSection.hidden = false;
    }

    if (progressCount) {
      progressCount.textContent = `${safeCurrent}/${safeTotal}`;
    }

    if (progressBar) {
      progressBar.style.width = `${percent}%`;
    }

    if (progressTrack) {
      progressTrack.setAttribute('aria-valuenow', String(percent));
    }

    if (progressStatus && status) {
      progressStatus.textContent = status;
    }
  };

  bulkPrintButton.addEventListener('click', async () => {
    const selectedPrinter = printerSelect.value?.trim();
    if (!selectedPrinter) {
      window.alert('Vui lòng chọn máy in trước khi in hàng loạt.');
      return;
    }

    const selectedRows = Array.from(screen.querySelectorAll('#inpo-po-tbody tr')).filter((row) => {
      const checkbox = row.querySelector('[data-po-select]');
      return Boolean(checkbox?.checked);
    });

    if (selectedRows.length === 0) {
      window.alert('Vui lòng chọn ít nhất 1 file PO để in hàng loạt.');
      return;
    }

    clearProgressAutoHideTimer();

    updateProgress({
      current: 0,
      total: selectedRows.length,
      status: 'Bắt đầu in hàng loạt...',
    });

    bulkPrintButton.disabled = true;

    const failedFiles = [];
    let printedCount = 0;
    let processedCount = 0;

    try {
      for (const row of selectedRows) {
        const { fileName, duplex, copies } = getRowPrintPayload(row);

        if (!fileName) {
          failedFiles.push({
            fileName: '(Không xác định)',
            reason: 'Không xác định được tên file PO.',
          });
          processedCount += 1;
          updateProgress({
            current: processedCount,
            total: selectedRows.length,
            status: `Đang in ${processedCount}/${selectedRows.length}...`,
          });
          continue;
        }

        try {
          await window.appApi.printPOFile({
            fileName,
            printerName: selectedPrinter,
            copies,
            duplex,
          });
          printedCount += 1;
        } catch (error) {
          failedFiles.push({
            fileName,
            reason: error instanceof Error ? error.message : String(error),
          });
        }

        processedCount += 1;
        updateProgress({
          current: processedCount,
          total: selectedRows.length,
          status: `Đang in ${processedCount}/${selectedRows.length}...`,
        });

        if (processedCount < selectedRows.length) {
          await sleep(BULK_PRINT_REQUEST_DELAY_MS);
        }
      }

      if (failedFiles.length === 0) {
        updateProgress({
          current: selectedRows.length,
          total: selectedRows.length,
          status: `Hoàn tất: Đã in thành công ${printedCount}/${selectedRows.length} file.`,
        });
        window.alert(`Đã in thành công ${printedCount} file PO.`);
        return;
      }

      updateProgress({
        current: selectedRows.length,
        total: selectedRows.length,
        status: `Hoàn tất có lỗi: Thành công ${printedCount}/${selectedRows.length}, thất bại ${failedFiles.length}.`,
      });

      const failureDetails = failedFiles
        .map((item) => `- ${item.fileName}: ${item.reason}`)
        .join('\n');

      window.alert(
        `In hàng loạt hoàn tất.\n` +
          `Thành công: ${printedCount}/${selectedRows.length}\n` +
          `Thất bại: ${failedFiles.length}\n\n` +
          `${failureDetails}`,
      );
    } finally {
      bulkPrintButton.disabled = false;
      scheduleProgressAutoHide();
    }
  });
};

export const initPrintPOScreen = (root = document) => {
  const screen = root.querySelector('.inpo-page');
  if (!screen) {
    return;
  }

  wireOpenFileActions(screen);
  wireRowPrintActions(screen);
  wireBulkPrintActions(screen);

  const printerSelect = screen.querySelector('#inpo-printer-select');
  const refreshPrintersButton = screen.querySelector('#inpo-refresh-printers');

  const loadPrinters = async () => {
    if (!printerSelect) {
      return;
    }

    const currentValue = printerSelect.value;

    if (refreshPrintersButton) {
      refreshPrintersButton.disabled = true;
    }

    resetPrinterOptions(printerSelect, '-- Đang tải máy in... --');

    try {
      const printers = await window.appApi.listAvailablePrinters();

      if (!Array.isArray(printers) || printers.length === 0) {
        resetPrinterOptions(printerSelect, '-- Không tìm thấy máy in khả dụng --');
        return;
      }

      resetPrinterOptions(printerSelect, '-- Chọn máy in khả dụng --');
      fillPrinterOptions(printerSelect, printers);

      if (currentValue && [...printerSelect.options].some((option) => option.value === currentValue)) {
        printerSelect.value = currentValue;
      }
    } catch {
      resetPrinterOptions(printerSelect, '-- Không tải được danh sách máy in --');
    } finally {
      if (refreshPrintersButton) {
        refreshPrintersButton.disabled = false;
      }
    }
  };

  void loadPrinters();

  refreshPrintersButton?.addEventListener('click', () => {
    void loadPrinters();
  });

  const dateInput = screen.querySelector('#inpo-order-date');
  const datePickerInput = screen.querySelector('#inpo-order-date-picker');
  const datePickerTrigger = screen.querySelector('#inpo-order-date-trigger');
  const downloadPOButton = screen.querySelector('#inpo-download-po');
  const stopDownloadButton = screen.querySelector('#inpo-stop-download');
  const downloadLockStatus = screen.querySelector('#inpo-download-lock-status');

  const masterCheckbox = screen.querySelector('#inpo-select-all');
  const tbody = screen.querySelector('#inpo-po-tbody');
  let cachedFiles = [];
  let selectedDateKey = '';
  let isDownloadingPOFiles = false;
  let controlStatesBeforeDownload = [];

  const setStopDownloadButtonVisible = (isVisible) => {
    if (!stopDownloadButton) {
      return;
    }

    stopDownloadButton.hidden = !isVisible;
    stopDownloadButton.style.display = isVisible ? '' : 'none';
  };

  setStopDownloadButtonVisible(false);

  if (downloadLockStatus) {
    downloadLockStatus.hidden = true;
  }

  const setDownloadLockState = (isLocked) => {
    const controls = Array.from(screen.querySelectorAll('button, input, select, textarea'));

    if (isLocked) {
      screen.classList.add('inpo-page--locked');

      if (downloadLockStatus) {
        downloadLockStatus.hidden = false;
      }

      controlStatesBeforeDownload = controls.map((control) => ({
        control,
        disabled: Boolean(control.disabled),
      }));

      controls.forEach((control) => {
        control.disabled = true;
      });

      if (stopDownloadButton) {
        setStopDownloadButtonVisible(true);
        stopDownloadButton.disabled = false;
      }

      return;
    }

    screen.classList.remove('inpo-page--locked');

    if (downloadLockStatus) {
      downloadLockStatus.hidden = true;
    }

    controlStatesBeforeDownload.forEach(({ control, disabled }) => {
      if (!control || !control.isConnected) {
        return;
      }

      control.disabled = disabled;
    });

    controlStatesBeforeDownload = [];

    if (stopDownloadButton) {
      setStopDownloadButtonVisible(false);
      stopDownloadButton.disabled = false;
    }
  };

  stopDownloadButton?.addEventListener('click', async () => {
    if (!isDownloadingPOFiles) {
      return;
    }

    const iconElement = stopDownloadButton.querySelector('.material-symbols-outlined');
    const labelElement = stopDownloadButton.querySelector('span:last-child');
    const originalIcon = iconElement?.textContent ?? 'stop_circle';
    const originalLabel = labelElement?.textContent ?? 'Dừng tải';

    stopDownloadButton.disabled = true;

    if (iconElement) {
      iconElement.textContent = 'hourglass_top';
    }

    if (labelElement) {
      labelElement.textContent = 'Đang dừng...';
    }

    try {
      await window.appApi.cancelDownloadPOFiles();
    } catch {
      stopDownloadButton.disabled = false;

      if (iconElement) {
        iconElement.textContent = originalIcon;
      }

      if (labelElement) {
        labelElement.textContent = originalLabel;
      }
    }
  });

  const applySelectedDate = (dateValue) => {
    const parsedDateKey = parseInputDateToLocalDateKey(dateValue);
    if (parsedDateKey === null) {
      return;
    }

    selectedDateKey = parsedDateKey;

    if (datePickerInput && parsedDateKey) {
      datePickerInput.value = parsedDateKey;
    }

    if (dateInput) {
      dateInput.value = parsedDateKey ? formatDisplayDateFromKey(parsedDateKey) : '';
    }
  };

  const openDatePicker = () => {
    if (!datePickerInput) {
      return;
    }

    if (typeof datePickerInput.showPicker === 'function') {
      datePickerInput.showPicker();
      return;
    }

    datePickerInput.focus();
    datePickerInput.click();
  };

  if (datePickerInput && !datePickerInput.value) {
    datePickerInput.value = formatDateForInput(new Date());
  }

  applySelectedDate(datePickerInput?.value ?? formatDateForInput(new Date()));

  const syncMasterState = () => {
    if (!masterCheckbox) {
      return;
    }

    const rowCheckboxes = Array.from(screen.querySelectorAll('#inpo-po-tbody [data-po-select]'));

    if (rowCheckboxes.length === 0) {
      masterCheckbox.checked = false;
      masterCheckbox.indeterminate = false;
      return;
    }

    const selectedCount = rowCheckboxes.filter((checkbox) => checkbox.checked).length;
    const allChecked = selectedCount === rowCheckboxes.length;
    const noneChecked = selectedCount === 0;

    masterCheckbox.checked = allChecked;
    masterCheckbox.indeterminate = !allChecked && !noneChecked;
  };

  const renderWithCurrentFilter = () => {
    renderPOFiles({
      screen,
      files: cachedFiles,
      selectedDate: selectedDateKey,
    });
    syncMasterState();
  };

  masterCheckbox?.addEventListener('change', () => {
    const rowCheckboxes = Array.from(screen.querySelectorAll('#inpo-po-tbody [data-po-select]'));
    rowCheckboxes.forEach((checkbox) => {
      checkbox.checked = masterCheckbox.checked;
    });

    masterCheckbox.indeterminate = false;
  });

  tbody?.addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-po-select]');
    if (!checkbox) {
      return;
    }

    syncMasterState();
  });

  datePickerInput?.addEventListener('change', () => {
    applySelectedDate(datePickerInput.value);
    renderWithCurrentFilter();
  });

  datePickerTrigger?.addEventListener('click', () => {
    openDatePicker();
  });

  dateInput?.addEventListener('click', () => {
    openDatePicker();
  });

  const initializePOFiles = async () => {
    if (tbody) {
      tbody.innerHTML = buildEmptyRowTemplate('Đang tải danh sách file PO...');
    }

    try {
      cachedFiles = await fetchPOFiles();
      renderWithCurrentFilter();
    } catch (error) {
      if (!tbody) {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("No handler registered for 'po:list-files'")) {
        tbody.innerHTML = buildEmptyRowTemplate('Main process chưa nạp handler mới. Vui lòng tắt app và chạy lại npm run.');
      } else {
        tbody.innerHTML = buildEmptyRowTemplate('Không đọc được file PO từ thư mục tải xuống.');
      }

      syncMasterState();
    }
  };

  downloadPOButton?.addEventListener('click', async () => {
    if (isDownloadingPOFiles) {
      return;
    }

    const iconElement = downloadPOButton.querySelector('.material-symbols-outlined');
    const labelElement = downloadPOButton.querySelector('span:last-child');
    const originalIcon = iconElement?.textContent ?? 'file_download';
    const originalLabel = labelElement?.textContent ?? 'Download PO';

    isDownloadingPOFiles = true;
    setDownloadLockState(true);

    if (iconElement) {
      iconElement.textContent = 'downloading';
    }

    if (labelElement) {
      labelElement.textContent = 'Đang tải...';
    }

    try {
      const downloadResult = await window.appApi.downloadPOFiles();
      cachedFiles = await fetchPOFiles();
      renderWithCurrentFilter();

      const downloadedCount = getDownloadedCount(downloadResult);
      const resultMessage = downloadResult?.canceled
        ? downloadedCount > 0
          ? `Đã dừng tải. Đã tải ${downloadedCount} file PO trước khi dừng.`
          : 'Đã dừng tải PO.'
        : downloadedCount > 0
          ? `Đã tải ${downloadedCount} file PO vào thư mục.`
          : downloadResult?.message ?? 'Không có file PO mới để tải.';

      window.alert(resultMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      window.alert(`Không thể tải file PO: ${errorMessage}`);
    } finally {
      isDownloadingPOFiles = false;
      setDownloadLockState(false);

      if (iconElement) {
        iconElement.textContent = originalIcon;
      }

      if (labelElement) {
        labelElement.textContent = originalLabel;
      }
    }
  });

  void initializePOFiles();
};
