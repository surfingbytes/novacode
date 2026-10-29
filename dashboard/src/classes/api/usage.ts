import { http } from './http';

// types
import type { UsageOverview } from '@/@types/index';

// ---------------------------------- Usage ----------------------------------
export const usageApi = {
  overview: (params: { from?: string; to?: string }): ReturnType<typeof http.get<UsageOverview>> =>
    http.get<UsageOverview>('/usage/overview', { params })
};
