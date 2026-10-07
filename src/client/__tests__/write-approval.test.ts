import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ThreadsClient } from '../threads-client.js';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('ThreadsClient write approval enforcement', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
  });

  const approval = {
    approved: true as const,
    approvedBy: 'KZ' as const,
    approvalRef: 'kz-approved-001',
  };

  it('blocks publish when host approval validator is not configured', async () => {
    const client = new ThreadsClient({
      accessToken: 'token',
      userId: 'user-1',
    });

    await expect(
      client.createThread({ text: 'Approved text' }, approval)
    ).rejects.toThrow('approvalRef was not validated');

    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('publishes only after host validates KZ approval', async () => {
    const validator = {
      validate: vi.fn().mockResolvedValue(true),
    };

    const client = new ThreadsClient({
      accessToken: 'token',
      userId: 'user-1',
      writeApprovalValidator: validator,
    });

    mockAxiosInstance.post
      .mockResolvedValueOnce({ data: { id: 'container-1' } })
      .mockResolvedValueOnce({ data: { id: 'thread-1' } });

    const result = await client.createThread({ text: 'Approved text' }, approval);

    expect(result).toEqual({ id: 'thread-1' });
    expect(validator.validate).toHaveBeenCalledWith({
      action: 'threads_create_thread',
      approval,
      targetId: undefined,
    });
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
  });

  it('blocks delete before making API request when approval is rejected', async () => {
    const validator = {
      validate: vi.fn().mockResolvedValue(false),
    };

    const client = new ThreadsClient({
      accessToken: 'token',
      userId: 'user-1',
      writeApprovalValidator: validator,
    });

    await expect(client.deleteThread('thread-1', approval)).rejects.toThrow(
      'approvalRef was not validated'
    );

    expect(mockAxiosInstance.delete).not.toHaveBeenCalled();
  });
});
