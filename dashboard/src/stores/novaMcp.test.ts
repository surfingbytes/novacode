// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const { getMcpClientsMock } = vi.hoisted(() => ({ getMcpClientsMock: vi.fn() }));

vi.mock('@/classes/api', () => ({
  settingsApi: { getMcpClients: getMcpClientsMock }
}));

// stores
import { useNovaMcpStore } from '@/stores/novaMcp';

describe('novaMcp store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    getMcpClientsMock.mockReset();
  });

  it('starts unknown and fetches the builtin nova flag once', async () => {
    getMcpClientsMock.mockResolvedValue({ data: { servers: {}, builtin: { nova: { enabled: false } } } });
    const store = useNovaMcpStore();
    expect(store.bEnabled).toBeNull();

    await Promise.all([store.ensureFetched(), store.ensureFetched()]);
    await store.ensureFetched();
    expect(store.bEnabled).toBe(false);
    expect(getMcpClientsMock).toHaveBeenCalledTimes(1);
  });

  it('leaves the flag unknown when the fetch fails and retries on the next call', async () => {
    getMcpClientsMock.mockRejectedValueOnce(new Error('offline'));
    getMcpClientsMock.mockResolvedValueOnce({ data: { servers: {}, builtin: { nova: { enabled: true } } } });
    const store = useNovaMcpStore();

    await store.ensureFetched();
    expect(store.bEnabled).toBeNull();

    await store.ensureFetched();
    expect(store.bEnabled).toBe(true);
    expect(getMcpClientsMock).toHaveBeenCalledTimes(2);
  });

  it('setEnabled updates the flag without a fetch', () => {
    const store = useNovaMcpStore();
    store.setEnabled(false);
    expect(store.bEnabled).toBe(false);
    store.setEnabled(true);
    expect(store.bEnabled).toBe(true);
    expect(getMcpClientsMock).not.toHaveBeenCalled();
  });
});
