/**
 * Audit and notifications talk to the database. Tests of OTHER modules must not wait on a connection, so both are replaced
 * with recording stubs here. Tests of these two modules use jest.requireActual.
 */
jest.mock('../src/services/auditService', () => ({ audit: jest.fn(async () => undefined), listAudit: jest.fn(), getAudit: jest.fn() }));
jest.mock('../src/services/notifier', () => {
  const stub = () => jest.fn(async () => undefined);
  return {
    notify: new Proxy({}, { get: (t: any, k: string) => (t[k] ??= stub()) }),
    notificationService: { list: jest.fn(), unreadCount: jest.fn(), markRead: jest.fn(), markAllRead: jest.fn() },
    deliver: jest.fn(), usersByRoles: jest.fn(), usersByPermission: jest.fn(), usersBySuppliers: jest.fn(),
  };
});
