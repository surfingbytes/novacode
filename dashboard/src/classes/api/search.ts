import { http } from './http';

// types
import type { SearchResponse } from '@novacode/shared';

// ---------------------------------- Search ----------------------------------
export const searchApi = {
  query: async (query: string, signal?: AbortSignal): Promise<SearchResponse> => {
    const response = await http.get<SearchResponse>('/search', { params: { query }, signal });
    return response.data;
  }
};
