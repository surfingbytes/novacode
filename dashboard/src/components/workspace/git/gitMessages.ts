export const gitErrorMessage = (e: unknown, fallback: string): string => {
  const msg = e as {
    response?: { data?: { error?: string } };
    message?: string;
    code?: string;
  };
  const fromApi = msg?.response?.data?.error;
  if (fromApi) return fromApi;
  if (msg?.code === 'ECONNABORTED' || /timeout/i.test(msg?.message ?? '')) {
    return 'Request timed out — try again';
  }
  if (msg?.message === 'Network Error') {
    return 'Could not reach the server — try again';
  }
  return msg?.message ?? fallback;
};

export const gitPullResultMessage = (upToDate: boolean, commitCount: number): string => {
  if (upToDate) return 'Already up to date';
  return `Pulled ${commitCount} commit${commitCount === 1 ? '' : 's'}`;
};

export const gitFetchResultMessage = (upToDate: boolean, behindCount: number, hasUpstream: boolean): string => {
  if (!hasUpstream) return 'Fetched from remote';
  if (upToDate) return 'Already up to date with remote';
  return `Fetched from remote · ${behindCount} commit${behindCount === 1 ? '' : 's'} behind`;
};
