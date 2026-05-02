export type AccessUser = {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  mustChangePassword?: boolean;
};

export type RefreshUser = AccessUser & {
  sessionId: string;
};
