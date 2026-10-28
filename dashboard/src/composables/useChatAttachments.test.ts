// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/classes/api', () => ({
  sessionsApi: {
    uploadImage: vi.fn(),
    imageUrl: (sessionId: string, filename: string) => `/img/${sessionId}/${filename}`
  },
  apiErrorMessage: (_err: unknown, fallback: string) => fallback
}));

// classes
import { sessionsApi } from '@/classes/api';

// composables
import { useChatAttachments } from './useChatAttachments';

async function waitFor(check: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !check(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('useChatAttachments', () => {
  beforeEach(() => {
    vi.mocked(sessionsApi.uploadImage).mockReset();
  });

  it('previews PNGs locally and server-converted images from the server', async () => {
    vi.mocked(sessionsApi.uploadImage)
      .mockResolvedValueOnce({ data: { filename: 'a.png', path: '/up/a.png' } } as never)
      .mockResolvedValueOnce({ data: { filename: 'b.jpg', path: '/up/b.jpg' } } as never);
    const onUploadError = vi.fn();
    const attachments = useChatAttachments({ sessionId: () => 's1', onUploadError });

    attachments.onUploadFiles([new File(['png'], 'a.png', { type: 'image/png' })]);
    await waitFor(() => attachments.pendingImages.value.length === 1);
    attachments.onUploadFiles([new File(['heic'], 'b.heic', { type: 'image/heic' })]);
    await waitFor(() => attachments.pendingImages.value.length === 2);

    const [png, heic] = attachments.pendingImages.value;
    expect(png.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(png.isImage).toBe(true);
    expect(heic.dataUrl).toBe('/img/s1/b.jpg');
    expect(heic.displayName).toBe('b.heic');
    expect(attachments.bUploadingImage.value).toBe(false);
    expect(onUploadError).not.toHaveBeenCalled();
  });

  it('reports upload failures through onUploadError', async () => {
    vi.mocked(sessionsApi.uploadImage).mockRejectedValueOnce(new Error('boom'));
    const onUploadError = vi.fn();
    const attachments = useChatAttachments({ sessionId: () => 's1', onUploadError });

    attachments.uploadAttachmentFile(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    await waitFor(() => onUploadError.mock.calls.length > 0);

    expect(onUploadError).toHaveBeenCalledWith('Failed to upload file');
    expect(attachments.pendingImages.value).toEqual([]);
    expect(attachments.bUploadingImage.value).toBe(false);
  });
});
