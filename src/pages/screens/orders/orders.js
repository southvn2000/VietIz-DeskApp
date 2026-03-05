import {
  getClientsAttachedFiles,
  getGlobalClientsHaveConfig,
  initClientsHaveConfig,
} from '../../../js/api';

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

const formatSequence = (index) => String(index + 1).padStart(2, '0');

const encodeCustomerPayload = (customer) => encodeURIComponent(JSON.stringify(customer ?? {}));

const decodeCustomerPayload = (payload) => {
  try {
    return JSON.parse(decodeURIComponent(payload ?? ''));
  } catch {
    return null;
  }
};

const isMissingIpcHandlerError = (error) =>
  String(error instanceof Error ? error.message : error ?? '')
    .toLowerCase()
    .includes('no handler registered');

const sanitizeFileName = (value) =>
  String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-');

const getCustomerDirectoryId = (customer) =>
  sanitizeFileName(customer?.id ?? customer?.customerId ?? 'unknown-id') || 'unknown-id';

const normalizeFileType = (value) => String(value ?? '').trim().toLowerCase();

const isPdfFileName = (value) => String(value ?? '').trim().toLowerCase().endsWith('.pdf');

const normalizeNumberOfDays = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
};

const normalizeProgressValue = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const getCustomerTypeLabel = (customer) => {
  const rawType = String(customer?.clientType ?? '').trim();
  const normalizedType = rawType.toLowerCase();

  if (normalizedType === 'client') {
    return 'Khách hàng';
  }

  if (normalizedType === 'category') {
    return 'Nhóm';
  }

  return rawType || 'Không xác định';
};

const getFileTypeLabel = (customer) => String(customer?.fileType ?? '').trim() || 'Không xác định';

const buildEmailCellTemplate = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '-';
  }

  const emails = normalized
    .split(';')
    .map((email) => email.trim())
    .filter(Boolean);

  if (emails.length <= 1) {
    return `<span class="orders-email-single">${escapeHtml(emails[0] ?? normalized)}</span>`;
  }

  return `
    <div class="orders-email-list" title="${escapeHtml(emails.join('; '))}">
      ${emails.map((email) => `<div class="orders-email-line">${escapeHtml(email)}</div>`).join('')}
    </div>
  `;
};

const collectFileTypeOptions = (customers) => {
  const seenTypes = new Set();
  const options = [];

  customers.forEach((customer) => {
    const label = String(customer?.fileType ?? '').trim();
    const value = normalizeFileType(label);

    if (!value || seenTypes.has(value)) {
      return;
    }

    seenTypes.add(value);
    options.push({ value, label });
  });

  options.sort((left, right) => left.label.localeCompare(right.label, 'vi'));
  return options;
};

const populateTypeFilterOptions = (typeFilter, customers, previousValue) => {
  if (!typeFilter) {
    return;
  }

  const options = collectFileTypeOptions(customers);
  const preferredValue = 'pdf';
  const requestedValue = normalizeFileType(previousValue);

  typeFilter.innerHTML = '<option value="all">Tất cả</option>';

  options.forEach((option) => {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.label;
    typeFilter.appendChild(item);
  });

  const availableValues = new Set(['all', ...options.map((option) => option.value)]);

  if (requestedValue && availableValues.has(requestedValue)) {
    typeFilter.value = requestedValue;
    return;
  }

  if (availableValues.has(preferredValue)) {
    typeFilter.value = preferredValue;
    return;
  }

  typeFilter.value = 'all';
};

const buildDownloadedCellTemplate = (downloadedFiles = [], customerDirectoryId = '') => {
  if (!Array.isArray(downloadedFiles) || downloadedFiles.length === 0) {
    return '<span class="orders-downloaded-empty">-</span>';
  }

  const encodedCustomerDirectoryId = escapeHtml(String(customerDirectoryId ?? '').trim());
  const summaryLabel = downloadedFiles.length === 1 ? '1 file' : `${downloadedFiles.length} files`;

  return `
    <div class="orders-downloaded-files" title="${escapeHtml(downloadedFiles.join(', '))}">
      <span class="orders-downloaded-summary">${escapeHtml(summaryLabel)}</span>
      ${downloadedFiles
        .map((fileName) => {
          const safeFileName = escapeHtml(fileName);
          return `
            <div class="orders-downloaded-item">
              <span class="material-symbols-outlined orders-downloaded-icon" aria-hidden="true">description</span>
              <button
                class="orders-downloaded-link"
                type="button"
                data-order-action="open-downloaded-file"
                data-order-customer-id="${encodedCustomerDirectoryId}"
                data-order-file-name="${safeFileName}"
                title="Mở file ${safeFileName}"
                aria-label="Mở file ${safeFileName}"
              >
                ${safeFileName}
              </button>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
};

const buildCustomerRowTemplate = (customer, index, downloadedByCustomerId = {}) => {
  const name = escapeHtml(customer?.name ?? '');
  const customerType = escapeHtml(getCustomerTypeLabel(customer));
  const fileType = escapeHtml(getFileTypeLabel(customer));
  const emailCell = buildEmailCellTemplate(customer?.email ?? '');
  const encodedCustomer = escapeHtml(encodeCustomerPayload(customer));
  const customerDirectoryId = getCustomerDirectoryId(customer);
  const downloadedFiles = Array.isArray(downloadedByCustomerId?.[customerDirectoryId])
    ? downloadedByCustomerId[customerDirectoryId]
    : [];
  const latestDownloadedFile = downloadedFiles[0] ?? '';
  const hasDownloadedFile = Boolean(latestDownloadedFile);
  const downloadedCell = buildDownloadedCellTemplate(downloadedFiles, customerDirectoryId);

  return `
    <tr>
      <td class="inpo-table__center">${formatSequence(index)}</td>      
      <td>${name}</td>     
      <td>${customerType}</td>
      <td>${fileType}</td>   
      <td class="orders-email-cell">${emailCell}</td>
      <td>${downloadedCell}</td>
      <td class="inpo-table__center">
        <div class="orders-row-actions">          
          <button
            class="inpo-row-action"
            type="button"
            data-order-action="upload"
            data-customer-payload="${encodedCustomer}"
            aria-label="Upload file đơn hàng"
            title="Upload file đơn hàng"
          >
            <span class="material-symbols-outlined">upload</span>
          </button>         
          <button
            class="inpo-row-action"
            type="button"
            data-order-action="download"
            data-customer-payload="${encodedCustomer}"
            aria-label="Tải file đơn hàng"
            title="Tải file đơn hàng"
          >
            <span class="material-symbols-outlined">download</span>
          </button>
          <button
            class="inpo-row-action"
            type="button"
            data-order-action="create-order-from-file"
            data-customer-payload="${encodedCustomer}"
            data-order-customer-id="${escapeHtml(customerDirectoryId)}"
            data-order-file-name="${escapeHtml(latestDownloadedFile)}"
            aria-label="Tạo đơn hàng từ file đã tải"
            title="${hasDownloadedFile ? `Tạo đơn hàng từ file ${escapeHtml(latestDownloadedFile)}` : 'Chưa có file đã tải để tạo đơn hàng'}"
          >
            <span class="material-symbols-outlined">receipt_long</span>
          </button>
        </div>
      </td>
    </tr>
  `;
};

const uploadOrderFile = async (customer) => {
  if (!customer) {
    return;
  }

  const result = await window.appApi.uploadOrderFile(customer);

  if (result?.canceled) {
    return;
  }

  if (result?.success) {
    const customerName = String(customer?.name ?? '').trim() || 'khách hàng';
    const uploadedFileName = String(result?.fileName ?? '').trim();
    const generatedCount = Array.isArray(result?.generatedFiles) ? result.generatedFiles.length : 0;
    const warningCount = Array.isArray(result?.generationWarnings) ? result.generationWarnings.length : 0;
    const message = uploadedFileName
      ? `Đã tải file ${uploadedFileName} cho ${customerName}.`
      : `Đã tải file cho ${customerName}.`;

    const generatedSummary = generatedCount > 0
      ? `\nĐã tạo thêm ${generatedCount} file dẫn xuất (txt/png).`
      : '';
    const warningSummary = warningCount > 0
      ? `\nCó ${warningCount} cảnh báo khi tạo file txt/png.`
      : '';

    window.alert(`${message}${generatedSummary}${warningSummary}`);
    return;
  }

  throw new Error(result?.message ?? 'Không thể tải file đơn hàng.');
};

const createDownloadProgress = (screen) => {
  const root = screen.querySelector('#orders-download-progress');
  const label = screen.querySelector('#orders-download-progress-label');
  const percent = screen.querySelector('#orders-download-progress-percent');
  const fill = screen.querySelector('#orders-download-progress-fill');

  const update = (message, value) => {
    if (!root) {
      return;
    }

    const normalizedValue = normalizeProgressValue(value);

    if (label && typeof message === 'string' && message.trim()) {
      label.textContent = message;
    }

    if (percent) {
      percent.textContent = `${normalizedValue}%`;
    }

    if (fill) {
      fill.style.width = `${normalizedValue}%`;
    }
  };

  const show = (message = 'Đang tải file đính kèm...', value = 0) => {
    if (!root) {
      return;
    }

    root.classList.remove('hidden');
    root.setAttribute('aria-hidden', 'false');
    update(message, value);
  };

  const hide = () => {
    if (!root) {
      return;
    }

    root.classList.add('hidden');
    root.setAttribute('aria-hidden', 'true');
    update('Đang tải file đính kèm...', 0);
  };

  return {
    show,
    update,
    hide,
  };
};

const downloadCustomerDetails = async (customer, numberOfDays = 2, progress = null) => {
  if (!customer) {
    return;
  }

  const customerName = String(customer?.name ?? '').trim() || 'khách hàng';

  const email = String(customer?.email ?? '').trim();
  if (!email) {
    window.alert('Khách hàng chưa có email, không thể tải file đính kèm.');
    return;
  }

  progress?.show(`Đang lấy danh sách file đính kèm của ${customerName}...`, 15);

  const attachedFilesResult = await getClientsAttachedFiles({
    emails: [email],
    numberOfDays,
  });

  if (!attachedFilesResult?.success) {
    throw new Error('Không gọi được API lấy file đính kèm.');
  }

  progress?.update('Đang tải file về máy...', 55);

  const saveResult = await window.appApi.saveOrderAttachedFiles({
    customer,
    customerId: customer?.id ?? customer?.customerId,
    payload: attachedFilesResult?.data ?? null,
  });

  progress?.update('Đang hoàn tất tải file...', 90);

  const savedCount = Array.isArray(saveResult?.savedFiles) ? saveResult.savedFiles.length : 0;
  const failedCount = Array.isArray(saveResult?.failedFiles) ? saveResult.failedFiles.length : 0;
  const generatedCount = Array.isArray(saveResult?.generatedFiles) ? saveResult.generatedFiles.length : 0;
  const generationWarningCount = Array.isArray(saveResult?.generationWarnings)
    ? saveResult.generationWarnings.length
    : 0;
  const firstFailedReason =
    failedCount > 0
      ? String(saveResult?.failedFiles?.[0]?.reason ?? '').trim()
      : '';
  const firstGenerationWarning =
    generationWarningCount > 0
      ? String(saveResult?.generationWarnings?.[0]?.reason ?? '').trim()
      : '';

  if (savedCount === 0 && failedCount === 0) {
    progress?.update('Không có file để tải.', 100);
    window.alert('Không tìm thấy file đính kèm để tải về.');
    return;
  }

  if (failedCount === 0) {
    progress?.update('Tải file hoàn tất.', 100);
    const generatedSummary = generatedCount > 0
      ? `\nĐã tạo thêm ${generatedCount} file dẫn xuất (txt/png).`
      : '';
    const warningSummary = generationWarningCount > 0
      ? `\nCảnh báo xử lý PDF: ${firstGenerationWarning || `${generationWarningCount} lỗi`}`
      : '';
    window.alert(`Đã tải ${savedCount} file đính kèm vào thư mục đơn hàng.${generatedSummary}${warningSummary}`);
    return;
  }

  progress?.update('Tải file hoàn tất.', 100);
  const summaryMessage = `Tải file đính kèm hoàn tất. Thành công: ${savedCount}, thất bại: ${failedCount}.`;
  const detailMessage = firstFailedReason ? `\nLý do lỗi đầu tiên: ${firstFailedReason}` : '';
  const generatedSummary = generatedCount > 0
    ? `\nĐã tạo thêm ${generatedCount} file dẫn xuất (txt/png).`
    : '';
  const warningSummary = generationWarningCount > 0
    ? `\nCảnh báo xử lý PDF: ${firstGenerationWarning || `${generationWarningCount} lỗi`}`
    : '';
  window.alert(`${summaryMessage}${detailMessage}${generatedSummary}${warningSummary}`);
};

const loadTodayDownloadedFilesByCustomerId = async (customers = []) => {
  const customerIds = [...new Set(
    customers.map((customer) => getCustomerDirectoryId(customer)),
  )];

  if (customerIds.length === 0) {
    return {};
  }

  try {
    const result = await window.appApi.listOrderDownloadedFiles({
      customerIds,
      onlyToday: true,
    });

    const source = result?.filesByCustomerId ?? {};
    const normalized = {};

    customerIds.forEach((customerId) => {
      const files = Array.isArray(source?.[customerId]) ? source[customerId] : [];
      normalized[customerId] = files
        .map((item) => String(item?.fileName ?? '').trim())
        .filter((fileName) => Boolean(fileName) && isPdfFileName(fileName));
    });

    return normalized;
  } catch {
    return {};
  }
};

const wireOrdersActions = (screen, getNumberOfDays, progress, onDownloadComplete, onNavigateToOrderFiles) => {
  const tbody = screen.querySelector('#orders-customers-tbody');
  if (!tbody || tbody.dataset.actionsWired === 'true') {
    return;
  }

  tbody.dataset.actionsWired = 'true';

  tbody.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-order-action]');
    if (!actionButton) {
      return;
    }

    const actionType = actionButton.dataset.orderAction;
    actionButton.disabled = true;

    try {
      if (actionType === 'open-downloaded-file') {
        const customerId = String(actionButton.dataset.orderCustomerId ?? '').trim();
        const fileName = String(actionButton.dataset.orderFileName ?? '').trim();

        if (!customerId || !fileName) {
          return;
        }

        try {
          await window.appApi.openOrderFile({
            customerId,
            fileName,
          });
        } catch (error) {
          if (!isMissingIpcHandlerError(error)) {
            throw error;
          }

          try {
            await window.appApi.openOrderDirectory({ customerId });
            window.alert('Không mở trực tiếp được file. Đã mở thư mục đơn hàng, vui lòng chọn file cần mở.');
          } catch (fallbackError) {
            if (!isMissingIpcHandlerError(fallbackError)) {
              throw fallbackError;
            }

            throw new Error('Ứng dụng đang chạy phiên bản cũ. Vui lòng khởi động lại ứng dụng để dùng tính năng mở file.');
          }
        }

        return;
      }

      if (actionType === 'open-order-folder') {
        const customerId = String(actionButton.dataset.orderCustomerId ?? '').trim();
        if (!customerId) {
          return;
        }

        await window.appApi.openOrderDirectory({
          customerId,
        });

        return;
      }

      if (actionType === 'create-order-from-file') {
        const payload = actionButton.dataset.customerPayload;
        const customer = decodeCustomerPayload(payload);
        const customerId = String(actionButton.dataset.orderCustomerId ?? '').trim();

        if (!customer || !customerId) {
          return;
        }

        onNavigateToOrderFiles?.({
          customer,
          customerId,
        });
        return;
      }

      const payload = actionButton.dataset.customerPayload;
      const customer = decodeCustomerPayload(payload);

      if (!customer) {
        return;
      }

      if (actionType === 'upload') {
        await uploadOrderFile(customer);
        await onDownloadComplete?.();
        return;
      }

      if (actionType === 'download') {
        await downloadCustomerDetails(customer, getNumberOfDays(), progress);
        await onDownloadComplete?.();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (actionType === 'open-downloaded-file') {
        window.alert(`Không thể mở file đã tải: ${errorMessage}`);
      } else if (actionType === 'open-order-folder') {
        window.alert(`Không thể mở thư mục đơn hàng: ${errorMessage}`);
      } else if (actionType === 'create-order-from-file') {
        window.alert(`Không thể tạo đơn hàng từ file: ${errorMessage}`);
      } else {
        window.alert(`Không thể tải file đơn hàng: ${errorMessage}`);
      }
    } finally {
      if (actionType === 'download') {
        progress?.hide();
      }

      actionButton.disabled = false;
    }
  });
};

const renderOrdersTable = (screen, model, selectedType = 'all', downloadedByCustomerId = {}) => {
  const tbody = screen.querySelector('#orders-customers-tbody');
  if (!tbody) {
    return;
  }

  const customers = Array.isArray(model?.customers) ? model.customers : [];
  const normalizedType = normalizeFileType(selectedType) || 'all';

  const filteredCustomers =
    normalizedType === 'all'
      ? customers
      : customers.filter((customer) => normalizeFileType(customer?.fileType) === normalizedType);

  if (filteredCustomers.length === 0) {
    tbody.innerHTML = buildEmptyRowTemplate('Không có dữ liệu khách hàng đã cấu hình.');
    return;
  }

  tbody.innerHTML = filteredCustomers
    .map((customer, index) => buildCustomerRowTemplate(customer, index, downloadedByCustomerId))
    .join('');
};

export const initOrdersScreen = (root = document, options = {}) => {
  const screen = root.querySelector('.inpo-page');
  if (!screen) {
    return;
  }

  const refreshButton = screen.querySelector('#orders-refresh-data');
  const typeFilter = screen.querySelector('#orders-type-filter');
  const numberOfDaysInput = screen.querySelector('#orders-number-of-days');
  const downloadProgress = createDownloadProgress(screen);

  const getNumberOfDays = () => normalizeNumberOfDays(numberOfDaysInput?.value);

  numberOfDaysInput?.addEventListener('change', () => {
    numberOfDaysInput.value = String(getNumberOfDays());
  });

  let currentDownloadedByCustomerId = {};

  const wait = (duration = 180) => new Promise((resolve) => setTimeout(resolve, duration));

  const loadAndRenderDownloadedFiles = async (options = {}) => {
    const {
      showProgress = false,
      progressMessage = 'Đang tải dữ liệu đơn hàng...',
    } = options;

    try {
      if (showProgress) {
        downloadProgress.show(progressMessage, 15);
      }

      currentDownloadedByCustomerId = await loadTodayDownloadedFilesByCustomerId(currentModel.customers);

      if (showProgress) {
        downloadProgress.update('Đang hiển thị danh sách đơn hàng...', 75);
      }

      const selectedType = typeFilter?.value ?? 'all';
      renderOrdersTable(screen, currentModel, selectedType, currentDownloadedByCustomerId);

      if (showProgress) {
        downloadProgress.update('Hoàn tất tải dữ liệu.', 100);
        await wait();
      }
    } finally {
      if (showProgress) {
        downloadProgress.hide();
      }
    }
  };

  const reloadOrdersData = async () =>
    loadAndRenderDownloadedFiles({
      showProgress: true,
      progressMessage: 'Đang cập nhật dữ liệu đơn hàng...',
    });

  wireOrdersActions(
    screen,
    getNumberOfDays,
    downloadProgress,
    reloadOrdersData,
    options?.onNavigateToOrderFiles,
  );

  let currentModel = { customers: [] };

  const renderFromModel = async (model, preserveFilter = true, progressMessage = '') => {
    currentModel = model && Array.isArray(model.customers) ? model : { customers: [] };

    const previousFilterValue = preserveFilter ? typeFilter?.value : null;
    populateTypeFilterOptions(typeFilter, currentModel.customers, previousFilterValue);

    await loadAndRenderDownloadedFiles({
      showProgress: true,
      progressMessage: progressMessage || 'Đang tải dữ liệu đơn hàng...',
    });
  };

  const model = getGlobalClientsHaveConfig();
  void renderFromModel(model, false, 'Đang tải dữ liệu màn hình đơn hàng...');

  typeFilter?.addEventListener('change', () => {
    renderOrdersTable(screen, currentModel, typeFilter.value, currentDownloadedByCustomerId);
  });

  refreshButton?.addEventListener('click', async () => {
    refreshButton.disabled = true;

    const label = refreshButton.querySelector('span:last-child');
    const originalLabel = label?.textContent ?? 'Làm mới dữ liệu';

    if (label) {
      label.textContent = 'Đang tải...';
    }

    try {
      const latestModel = await initClientsHaveConfig();
      await renderFromModel(latestModel, true, 'Đang làm mới dữ liệu đơn hàng...');
    } finally {
      refreshButton.disabled = false;

      if (label) {
        label.textContent = originalLabel;
      }
    }
  });
};
