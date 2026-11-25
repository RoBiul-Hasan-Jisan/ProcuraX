import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request facts that services need but should not have to be passed through every call (audit trail). */
export interface RequestStore { requestId: string; ip: string | null; userAgent: string | null }
export const requestStore = new AsyncLocalStorage<RequestStore>();
export const currentRequest = (): RequestStore | undefined => requestStore.getStore();
