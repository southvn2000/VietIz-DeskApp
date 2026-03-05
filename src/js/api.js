const getClientsHaveConfigPath = '/mobile/rest/get-clients-have-config';
const getClientsAttachedFilesPath = '/mobile/rest/get-clients-attached-files';

const mobileCustomerGlobalKey = '__mobileCustomerModel';
let mobileCustomerModelCache = null;

const normalizeCustomer = (customer) => ({
	id: customer?.id ?? null,
	customerId: customer?.customerId ?? null,
	name: customer?.name ?? '',
	email: customer?.email ?? '',
	phone: customer?.phone ?? '',
	clientType: customer?.clientType ?? '',
	fileName:  '',
	fileType: customer?.fileType ?? '',
});

const emptyClientsModel = {
	updateDate: '',
	customers: [],
};

const isNotAuthenticatedError = (error) => {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return message.includes('Not authenticated. Please sign in first.');
};

const normalizeEmailList = (emails) =>
	Array.isArray(emails)
		? [...new Set(emails.map((email) => String(email ?? '').trim()).filter(Boolean))]
		: [];

const buildAttachedFilesRequestPayload = ({ emails = [], numberOfDays = 2 } = {}) => {
	const normalizedDays = Number.parseInt(numberOfDays, 10);

	return {
		emails: normalizeEmailList(emails),
		numberOfDays:
			Number.isFinite(normalizedDays) && normalizedDays >= 0
				? normalizedDays
				: 2,
	};
};

export const getClientsHaveConfig = async () => {
	const session = await window.appApi.getSession();
	if (!session?.isAuthenticated) {
		return emptyClientsModel;
	}

	let response;
	try {
		response = await window.appApi.callProtectedApi({
			method: 'GET',
			path: getClientsHaveConfigPath,
		});
	} catch (error) {
		if (isNotAuthenticatedError(error)) {
			return emptyClientsModel;
		}

		throw error;
	}

	const payload = response?.data ?? {};

	return {
		updateDate: payload?.updateDate ?? '',
		customers: Array.isArray(payload?.customers)
			? payload.customers.map(normalizeCustomer)
			: [],
	};
};

export const getClientsAttachedFiles = async (request = {}) => {
	const session = await window.appApi.getSession();
	if (!session?.isAuthenticated) {
		return {
			success: false,
			data: null,
		};
	}

	let response;
	try {
		response = await window.appApi.callProtectedApi({
			method: 'POST',
			path: getClientsAttachedFilesPath,
			headers: {
				'Content-Type': 'application/json',
			},
			body: buildAttachedFilesRequestPayload(request),
		});
	} catch (error) {
		if (isNotAuthenticatedError(error)) {
			return {
				success: false,
				data: null,
			};
		}

		throw error;
	}

	return {
		success: true,
		data: response?.data ?? null,
	};
};

export const initClientsHaveConfig = async () => {
	const model = await getClientsHaveConfig();
	mobileCustomerModelCache = model;
	window[mobileCustomerGlobalKey] = model;
	return model;
};

export const getGlobalClientsHaveConfig = () =>
	mobileCustomerModelCache ?? window[mobileCustomerGlobalKey] ?? null;

export const uploadFileToOllama = async () => {
	const result = await window.appApi.uploadFileToOllama();

	if (result?.canceled) {
		return {
			success: false,
			canceled: true,
			data: null,
		};
	}

	return {
		success: Boolean(result?.success),
		canceled: false,
		data: result?.data ?? null,
		fileName: result?.fileName ?? '',
		sourcePath: result?.sourcePath ?? '',
	};
};

export default {
	getClientsHaveConfig,
	getClientsAttachedFiles,
	initClientsHaveConfig,
	getGlobalClientsHaveConfig,
	uploadFileToOllama,
};
