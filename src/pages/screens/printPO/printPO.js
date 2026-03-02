const formatDateForInput = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

const buildEmptyRowTemplate = (message) => `
  <tr>
    <td colspan="6" class="inpo-table__empty">${message}</td>
  </tr>
`;

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildFileRowTemplate = (fileName, index) => {
  const safeFileName = escapeHtml(fileName);

  return `
    <tr>
      <td class="inpo-table__checkbox-col"><input data-po-select type="checkbox" /></td>
      <td>${formatSequence(index)}</td>
      <td>
        <button class="inpo-po-link" type="button" data-open-po-file data-file-name="${safeFileName}" title="Mở file ${safeFileName}">${safeFileName}</button>
      </td>
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

const renderPOFiles = async (screen) => {
  const tbody = screen.querySelector('#inpo-po-tbody');
  if (!tbody) {
    return;
  }

  tbody.innerHTML = buildEmptyRowTemplate('Đang tải danh sách file PO...');

  try {
    const files = await window.appApi.listPODownloadFiles();

    if (!Array.isArray(files) || files.length === 0) {
      tbody.innerHTML = buildEmptyRowTemplate('Không có file PO trong thư mục tải xuống.');
      return;
    }

    tbody.innerHTML = files.map((fileName, index) => buildFileRowTemplate(fileName, index)).join('');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("No handler registered for 'po:list-files'")) {
      tbody.innerHTML = buildEmptyRowTemplate('Main process chưa nạp handler mới. Vui lòng tắt app và chạy lại npm run.');
      return;
    }

    tbody.innerHTML = buildEmptyRowTemplate('Không đọc được file PO từ thư mục tải xuống.');
  }
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

export const initPrintPOScreen = (root = document) => {
  const screen = root.querySelector('.inpo-page');
  if (!screen) {
    return;
  }

  wireOpenFileActions(screen);

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
  if (dateInput && !dateInput.value) {
    dateInput.value = formatDateForInput(new Date());
  }

  const initializeTableSelection = async () => {
    await renderPOFiles(screen);

    const masterCheckbox = screen.querySelector('#inpo-select-all');
    const rowCheckboxes = Array.from(screen.querySelectorAll('[data-po-select]'));

    if (!masterCheckbox) {
      return;
    }

    if (rowCheckboxes.length === 0) {
      masterCheckbox.checked = false;
      masterCheckbox.indeterminate = false;
      return;
    }

    const syncMasterState = () => {
      const selectedCount = rowCheckboxes.filter((checkbox) => checkbox.checked).length;
      const allChecked = selectedCount === rowCheckboxes.length;
      const noneChecked = selectedCount === 0;

      masterCheckbox.checked = allChecked;
      masterCheckbox.indeterminate = !allChecked && !noneChecked;
    };

    masterCheckbox.addEventListener('change', () => {
      rowCheckboxes.forEach((checkbox) => {
        checkbox.checked = masterCheckbox.checked;
      });

      masterCheckbox.indeterminate = false;
    });

    rowCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', syncMasterState);
    });

    syncMasterState();
  };

  void initializeTableSelection();
};
