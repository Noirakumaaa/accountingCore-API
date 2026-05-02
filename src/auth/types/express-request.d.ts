import type { AccessUser } from './auth-user.js';

declare global {
  namespace Express {
    interface User extends AccessUser {
      sessionId?: string;
    }
  }
}

export {};
