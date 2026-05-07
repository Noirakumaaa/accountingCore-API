const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
]);

const parseBoolean = (value?: string): boolean | undefined => {
  if (!value) return undefined;

  switch (value.trim().toLowerCase()) {
    case 'true':
    case '1':
    case 'yes':
    case 'on':
      return true;
    case 'false':
    case '0':
    case 'no':
    case 'off':
      return false;
    default:
      return undefined;
  }
};

export const isLocalHostname = (value?: string): boolean => {
  if (!value?.trim()) return false;
  return LOCAL_HOSTNAMES.has(value.trim().toLowerCase());
};

export const isLocalUrl = (value?: string): boolean => {
  if (!value?.trim()) return false;

  try {
    const url = new URL(value);
    return isLocalHostname(url.hostname);
  } catch {
    return false;
  }
};

export const getAppMode = (): 'development' | 'staging' | 'production' => {
  const normalized = process.env.APP_ENV?.trim().toLowerCase();

  if (
    normalized === 'development' ||
    normalized === 'staging' ||
    normalized === 'production'
  ) {
    return normalized;
  }

  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === 'production') return 'production';
  if (nodeEnv === 'staging') return 'staging';
  return 'development';
};

export const isProductionMode = (): boolean => getAppMode() === 'production';

export const shouldUseSecureCookies = (): boolean => {
  const cookieSecure = parseBoolean(process.env.COOKIE_SECURE);
  if (typeof cookieSecure === 'boolean') {
    return cookieSecure;
  }

  if (!isProductionMode()) {
    return false;
  }

  return !(
    isLocalUrl(process.env.FRONTEND_URL) || isLocalUrl(process.env.BACKEND_URL)
  );
};
