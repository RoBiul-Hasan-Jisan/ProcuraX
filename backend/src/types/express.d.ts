import type { Permission, RoleName } from '../utils/permissions';

export interface AuthContext {
  uid: string;
  email?: string;
  name?: string;
  emailVerified?: boolean;
}

export interface UserContext {
  id: string;
  firebaseUid: string;
  email: string;
  displayName: string;
  role: RoleName | null;
  status: 'pending' | 'active' | 'suspended';
  departmentId: string | null;
  supplierId: string | null;
  permissions: Permission[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: AuthContext;
      user?: UserContext;
    }
  }
}

export {};
