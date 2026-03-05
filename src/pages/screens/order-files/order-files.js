const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatSequence = (index) => String(index + 1).padStart(2, '0');

const sanitizeFileName = (value) =>
  String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-');

const getCustomerDirectoryId = (customer) =>
  sanitizeFileName(customer?.id ?? customer?.customerId ?? 'unknown-id') || 'unknown-id';

const isPdfFileName = (value) => String(value ?? '').trim().toLowerCase().endsWith('.pdf');

const isTextOrImageFileName = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized.endsWith('.txt') || normalized.endsWith('.png');
};

const getPdfGroupKey = (fileName) => {
  const normalized = String(fileName ?? '').trim();
  if (!normalized) {
    return '';
  }

  const lowered = normalized.toLowerCase();

  if (lowered.endsWith('.pdf')) {
    return lowered.slice(0, -4);
  }

  if (lowered.endsWith('-conversion-warning.txt')) {
    return lowered.slice(0, -'-conversion-warning.txt'.length);
  }

  if (lowered.endsWith('.txt')) {
    return lowered.slice(0, -4);
  }

  const pngMatch = lowered.match(/^(.*)-page-\d+\.png$/i);
  if (pngMatch?.[1]) {
    return pngMatch[1];
  }

  return '';
};

const normalizeProgressValue = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
};

const buildProgressController = (screen) => {
  const root = screen.querySelector('#order-files-progress');
  const label = screen.querySelector('#order-files-progress-label');
  const percent = screen.querySelector('#order-files-progress-percent');
  const fill = screen.querySelector('#order-files-progress-fill');

  const update = (message, value) => {
    if (!root) {
      return;
    }

    const normalized = normalizeProgressValue(value);

    if (label && typeof message === 'string' && message.trim()) {
      label.textContent = message;
    }

    if (percent) {
      percent.textContent = `${normalized}%`;
    }

    if (fill) {
      fill.style.width = `${normalized}%`;
    }
  };

  const show = (message = 'Đang tải danh sách file...', value = 0) => {
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
    update('Đang tải danh sách file...', 0);
  };

  return {
    show,
    update,
    hide,
  };
};

const buildEmptyTemplate = (message) => `
  <tr>
    <td colspan="4" class="inpo-table__empty">${escapeHtml(message)}</td>
  </tr>
`;

const buildLinkedFileButton = (fileName, customerId) => {
  const safeFileName = escapeHtml(fileName);
  const safeCustomerId = escapeHtml(customerId);

  return `
    <button
      class="order-files-related-btn"
      type="button"
      data-order-files-action="open-file"
      data-order-file-name="${safeFileName}"
      data-order-customer-id="${safeCustomerId}"
      title="Mở file ${safeFileName}"
      aria-label="Mở file ${safeFileName}"
    >
      ${safeFileName}
    </button>
  `;
};

const buildRelatedFilesTemplate = (relatedFiles, customerId) => {
  if (!Array.isArray(relatedFiles) || relatedFiles.length === 0) {
    return '<span class="order-files-related-empty">-</span>';
  }

  return `
    <div class="order-files-related-list">
      ${relatedFiles.map((fileName) => buildLinkedFileButton(fileName, customerId)).join('')}
    </div>
  `;
};

const buildFileRowTemplate = ({ fileName, relatedFiles = [] }, index, customerId) => {
  const safeFileName = escapeHtml(fileName);
  const safeCustomerId = escapeHtml(customerId);
  const relatedFilesCell = buildRelatedFilesTemplate(relatedFiles, customerId);
  const primaryTextFile = relatedFiles.find((name) => String(name ?? '').trim().toLowerCase().endsWith('.txt')) ?? '';
  const primaryImageFile = relatedFiles.find((name) => String(name ?? '').trim().toLowerCase().endsWith('.png')) ?? '';
  const safePrimaryTextFile = escapeHtml(primaryTextFile);
  const safePrimaryImageFile = escapeHtml(primaryImageFile);

  return `
    <tr>
      <td class="inpo-table__center">${formatSequence(index)}</td>
      <td>
        <button
          class="order-files-name-btn"
          type="button"
          data-order-files-action="open-file"
          data-order-file-name="${safeFileName}"
          data-order-customer-id="${safeCustomerId}"
          title="Mở file ${safeFileName}"
          aria-label="Mở file ${safeFileName}"
        >
          ${safeFileName}
        </button>
      </td>
      <td>${relatedFilesCell}</td>
      <td class="inpo-table__center">
        <div class="order-files-row-actions">
          <button
            class="order-files-action-btn"
            type="button"
            data-order-files-action="create-order"
            data-order-file-name="${safeFileName}"
            data-order-customer-id="${safeCustomerId}"
            data-order-primary-text-file="${safePrimaryTextFile}"
            data-order-primary-image-file="${safePrimaryImageFile}"
            title="Tạo đơn hàng từ file ${safeFileName}"
            aria-label="Tạo đơn hàng từ file ${safeFileName}"
          >
            <span class="material-symbols-outlined">receipt_long</span>
          </button>
        </div>
      </td>
    </tr>
  `;
};

const buildPdfRowsWithRelatedFiles = (files = []) => {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const groups = new Map();

  files.forEach((item) => {
    const fileName = String(item?.fileName ?? '').trim();
    if (!fileName) {
      return;
    }

    const groupKey = getPdfGroupKey(fileName);
    if (!groupKey) {
      return;
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        pdf: null,
        relatedFiles: [],
      });
    }

    const group = groups.get(groupKey);

    if (isPdfFileName(fileName)) {
      if (!group.pdf) {
        group.pdf = {
          fileName,
          createdAt: item?.createdAt ?? null,
        };
      }
      return;
    }

    if (isTextOrImageFileName(fileName)) {
      group.relatedFiles.push(fileName);
    }
  });

  return [...groups.values()]
    .filter((group) => Boolean(group.pdf?.fileName))
    .map((group) => ({
      fileName: group.pdf.fileName,
      createdAt: group.pdf.createdAt,
      relatedFiles: group.relatedFiles,
    }));
};

const getValueByKeys = (source, keys = []) => {
  if (!source || typeof source !== 'object') {
    return undefined;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }

  const entries = Object.entries(source);
  for (const [key, value] of entries) {
    const normalized = String(key).trim().toLowerCase();
    if (keys.some((candidate) => normalized === String(candidate).trim().toLowerCase())) {
      return value;
    }
  }

  return undefined;
};

const normalizeNumericValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const normalized = String(value ?? '')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatCurrency = (value) => {
  const numeric = normalizeNumericValue(value);
  return `${numeric.toLocaleString('vi-VN')} đ`;
};

const extractJsonPayload = (content) => {
  const raw = String(content ?? '').trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
  }

  const fencedMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/```\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
    }
  }

  const firstObjectStart = raw.indexOf('{');
  const lastObjectEnd = raw.lastIndexOf('}');
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    const objectSegment = raw.slice(firstObjectStart, lastObjectEnd + 1);
    try {
      return JSON.parse(objectSegment);
    } catch {
    }
  }

  return null;
};

const normalizeLookupKey = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const getValueByKeysLoose = (source, keys = []) => {
  const directValue = getValueByKeys(source, keys);
  if (directValue !== undefined) {
    return directValue;
  }

  if (!source || typeof source !== 'object') {
    return undefined;
  }

  const normalizedCandidates = new Set(keys.map((key) => normalizeLookupKey(key)).filter(Boolean));
  if (normalizedCandidates.size === 0) {
    return undefined;
  }

  for (const [key, value] of Object.entries(source)) {
    if (normalizedCandidates.has(normalizeLookupKey(key))) {
      return value;
    }
  }

  return undefined;
};

const getOrderMetaValue = (payload, keys = []) => {
  const metaContainers = [
    payload,
    payload?.purchase_order,
    payload?.purchaseOrder,
    payload?.order,
    payload?.header,
  ].filter((item) => item && typeof item === 'object');

  for (const container of metaContainers) {
    const value = getValueByKeysLoose(container, keys);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
};

const updateOrderMetaFromJson = (screen, payload, fallbackCustomerName = '') => {
  const customerInput = screen.querySelector('#order-meta-customer');
  const deliveryDateInput = screen.querySelector('#order-meta-delivery-date');
  const poNumberInput = screen.querySelector('#order-meta-po-number');
  const notesInput = screen.querySelector('#order-meta-notes');

  if (customerInput) {
    const customerName = getOrderMetaValue(payload, ['customer_name', 'customer', 'khach_hang', 'ten_khach_hang', 'customer_name_full']);
    customerInput.value = String(customerName ?? '').trim() || fallbackCustomerName;
  }

  if (deliveryDateInput) {
    const deliveryDate = getOrderMetaValue(payload, [
      'delivery_date',
      'deliveryDate',
      'delivery date',
      'ngay_giao_du_tinh',
      'ngay giao du tinh',
      'ngay_giao',
    ]);
    deliveryDateInput.value = String(deliveryDate ?? '').trim();
  }

  if (poNumberInput) {
    const poNumber = getOrderMetaValue(payload, [
      'po_number',
      'poNumber',
      'po number',
      'so_po',
      'so po',
      'po_no',
      'pono',
    ]);
    poNumberInput.value = String(poNumber ?? '').trim();
  }

  if (notesInput) {
    const deliveryNote = getOrderMetaValue(payload, ['delivery_note', 'delivery note', 'notes', 'ghi_chu']);
    notesInput.value = String(deliveryNote ?? '').trim();
  }
};

const renderOrderDetailItems = (screen, payload) => {
  const tbody = screen.querySelector('#order-detail-tbody');
  if (!tbody) {
    return;
  }

  const items = Array.isArray(getValueByKeys(payload, ['items', 'item_list']))
    ? getValueByKeys(payload, ['items', 'item_list'])
    : [];

  if (!Array.isArray(items) || items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td class="inpo-table__center">01</td>
        <td class="order-detail-table__muted">Chưa có dữ liệu sản phẩm</td>
        <td class="order-detail-table__muted">-</td>
        <td class="order-detail-table__muted">-</td>
        <td class="order-detail-table__muted">0</td>
        <td class="order-detail-table__muted">0 đ</td>
        <td class="order-detail-table__muted">0 đ</td>
      </tr>
      <tr>
        <td colspan="6" class="order-detail-table__total-label">TỔNG CỘNG</td>
        <td class="order-detail-table__total-value">0 đ</td>
      </tr>
    `;
    return;
  }

  let totalValue = 0;

  const rows = items.map((item, index) => {
    const productDetail = String(getValueByKeys(item, ['product_detail', 'product_name', 'name', 'description']) ?? '').trim() || '-';
    const sku = String(getValueByKeys(item, ['sku', 'product_code', 'code']) ?? '').trim() || '-';
    const unit = String(getValueByKeys(item, ['unit', 'unit_measure', 'uom']) ?? '').trim() || '-';
    const quantity = normalizeNumericValue(getValueByKeys(item, ['quantity', 'qty', 'so_luong']));
    const price = normalizeNumericValue(getValueByKeys(item, ['price', 'unit_price', 'gia']));
    const lineTotalRaw = getValueByKeys(item, ['total', 'line_total', 'amount']);
    const lineTotal = lineTotalRaw !== undefined
      ? normalizeNumericValue(lineTotalRaw)
      : quantity * price;

    totalValue += lineTotal;

    return `
      <tr>
        <td class="inpo-table__center">${formatSequence(index)}</td>
        <td>${escapeHtml(productDetail)}</td>
        <td>${escapeHtml(sku)}</td>
        <td>${escapeHtml(unit)}</td>
        <td>${escapeHtml(String(quantity))}</td>
        <td>${escapeHtml(formatCurrency(price))}</td>
        <td>${escapeHtml(formatCurrency(lineTotal))}</td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = `
    ${rows}
    <tr>
      <td colspan="6" class="order-detail-table__total-label">TỔNG CỘNG</td>
      <td class="order-detail-table__total-value">${escapeHtml(formatCurrency(totalValue))}</td>
    </tr>
  `;
};

const renderFileTable = (screen, files, customerId) => {
  const tbody = screen.querySelector('#order-files-tbody');
  if (!tbody) {
    return;
  }

  const pdfRows = buildPdfRowsWithRelatedFiles(files);

  if (pdfRows.length === 0) {
    tbody.innerHTML = buildEmptyTemplate('Không có file PDF trong ngày.');
    return;
  }

  tbody.innerHTML = pdfRows
    .map((item, index) =>
      buildFileRowTemplate(
        {
          fileName: item.fileName,
          createdAt: item.createdAt,
          relatedFiles: item.relatedFiles,
        },
        index,
        customerId,
      ))
    .join('');
};

const wireTableActions = (screen, progress, fallbackCustomerName = '') => {
  const tbody = screen.querySelector('#order-files-tbody');
  if (!tbody || tbody.dataset.actionsWired === 'true') {
    return;
  }

  tbody.dataset.actionsWired = 'true';

  tbody.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-order-files-action]');
    if (!actionButton) {
      return;
    }

    const actionType = actionButton.dataset.orderFilesAction;

    if (actionType === 'create-order') {
      const fileName = String(actionButton.dataset.orderFileName ?? '').trim();
      const customerId = String(actionButton.dataset.orderCustomerId ?? '').trim();
      const txtFileName = String(actionButton.dataset.orderPrimaryTextFile ?? '').trim();
      const imageFileName = String(actionButton.dataset.orderPrimaryImageFile ?? '').trim();
      const sourceFileName = txtFileName || imageFileName;
      const isImageSource = /\.(png|jpg|jpeg|bmp|tif|tiff|webp)$/i.test(sourceFileName);

      if (!fileName) {
        return;
      }

      if (!customerId || !sourceFileName) {
        window.alert('Không tìm thấy file txt/image để xử lý. Vui lòng kiểm tra file liên quan trước khi tạo đơn hàng.');
        return;
      }

      actionButton.disabled = true;

      try {
        progress?.show(
          isImageSource
            ? 'Đang OCR ảnh và chuyển đổi dữ liệu JSON...'
            : 'Đang gửi yêu cầu đến Ollama...',
          15,
        );

        const composeFromFile = window.appApi.composeOrderPromptFromFile ?? window.appApi.composeOrderPromptFromTxt;
        const result = await composeFromFile({
          customerId,
          fileName: sourceFileName,
          promptId: '1590',
        });

        progress?.update(
          isImageSource
            ? 'Đang đọc dữ liệu JSON từ OCR...'
            : 'Đang đọc dữ liệu trả về...',
          75,
        );

        const content = String(result?.generatedText ?? '').trim();
        if (!content) {
          window.alert(
            isImageSource
              ? 'Không trích xuất được JSON từ ảnh. Vui lòng kiểm tra chất lượng ảnh đầu vào.'
              : 'Ollama không trả về nội dung. Vui lòng kiểm tra model hoặc endpoint.',
          );
          return;
        }

        const parsedPayload = extractJsonPayload(content);
        if (!parsedPayload || typeof parsedPayload !== 'object') {
          window.alert(
            isImageSource
              ? 'Nội dung OCR không phải JSON hợp lệ để cập nhật form/tables.'
              : 'Nội dung Ollama không phải JSON hợp lệ để cập nhật form/tables.',
          );
          return;
        }

        window.alert(JSON.stringify(parsedPayload, null, 2));

        updateOrderMetaFromJson(screen, parsedPayload, fallbackCustomerName);
        renderOrderDetailItems(screen, parsedPayload);
        progress?.update('Đã cập nhật dữ liệu đơn hàng.', 100);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        window.alert(`Không thể xử lý file dữ liệu: ${errorMessage}`);
      } finally {
        setTimeout(() => {
          progress?.hide();
        }, 200);
        actionButton.disabled = false;
      }

      return;
    }

    if (actionType === 'open-file') {
      const customerId = String(actionButton.dataset.orderCustomerId ?? '').trim();
      const fileName = String(actionButton.dataset.orderFileName ?? '').trim();

      if (!customerId || !fileName) {
        return;
      }

      actionButton.disabled = true;
      try {
        await window.appApi.openOrderFile({ customerId, fileName });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        window.alert(`Không thể mở file: ${errorMessage}`);
      } finally {
        actionButton.disabled = false;
      }
    }
  });
};

export const initOrderFilesScreen = async (root = document, options = {}) => {
  const screen = root.querySelector('.order-files-page');
  if (!screen) {
    return;
  }

  const customer = options?.customer ?? {};
  const customerId = String(options?.customerId ?? '').trim() || getCustomerDirectoryId(customer);
  const customerName = String(customer?.name ?? '').trim();
  const progress = buildProgressController(screen);

  const customerInput = screen.querySelector('#order-meta-customer');
  if (customerInput) {
    customerInput.value = customerName;
  }

  renderOrderDetailItems(screen, {});

  wireTableActions(screen, progress, customerName);

  const backButton = screen.querySelector('#order-files-back');
  backButton?.addEventListener('click', () => {
    options?.onBack?.();
  });

  try {
    progress.show('Đang tải danh sách file trong ngày...', 20);

    const response = await window.appApi.listOrderDownloadedFiles({
      customerIds: [customerId],
      onlyToday: true,
    });

    progress.update('Đang hiển thị danh sách file...', 75);

    const files = Array.isArray(response?.filesByCustomerId?.[customerId])
      ? response.filesByCustomerId[customerId]
      : [];

    renderFileTable(screen, files, customerId);
    progress.update('Hoàn tất tải dữ liệu.', 100);
  } catch (error) {
    renderFileTable(screen, [], customerId);
    const errorMessage = error instanceof Error ? error.message : String(error);
    window.alert(`Không thể tải danh sách file: ${errorMessage}`);
  } finally {
    setTimeout(() => {
      progress.hide();
    }, 200);
  }
};
