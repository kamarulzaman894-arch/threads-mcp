import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  ThreadsConfig,
  ThreadsUser,
  ThreadsMedia,
  ThreadsInsights,
  ThreadsReplies,
  ThreadsConversation,
  CreateThreadResponse,
  CreateThreadParams,
  GetMediaParams,
  GetInsightsParams,
  GetRepliesParams,
  SearchThreadsParams,
  SearchLocationsParams,
  ProfileLookupParams,
  ThreadsUserSchema,
  ThreadsMediaSchema,
  ThreadsInsightsSchema,
  ThreadsRepliesSchema,
  ThreadsConversationSchema,
  CreateThreadResponseSchema,
} from '../types/threads.js';
import {
  assertKZWriteApproval,
  type KZWriteApproval,
} from '../authority/write-approval.js';

export class ThreadsAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'ThreadsAPIError';
  }
}

export class ThreadsClient {
  private client: AxiosInstance;
  private config: ThreadsConfig;
  private baseUrl: string;

  constructor(config: ThreadsConfig) {
    this.config = {
      apiVersion: 'v1.0',
      ...config,
    };

    this.baseUrl = `https://graph.threads.net/${this.config.apiVersion}`;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use(async (config) => {
      const accessToken = this.config.tokenManager
        ? await this.config.tokenManager.getToken()
        : this.config.accessToken;

      config.params = {
        ...config.params,
        access_token: accessToken,
      };
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          throw new ThreadsAPIError(
            error.response.data ? JSON.stringify(error.response.data) : 'Unknown API error',
            error.response.status,
            error.response.data
          );
        } else if (error.request) {
          throw new ThreadsAPIError('No response received from Threads API');
        } else {
          throw new ThreadsAPIError(`Request failed: ${error.message}`);
        }
      }
    );
  }

  private async requireWriteApproval(
    action: string,
    approval: KZWriteApproval,
    targetId?: string
  ): Promise<void> {
    await assertKZWriteApproval(this.config.writeApprovalValidator, {
      action,
      approval,
      targetId,
    });
  }

  async getProfile(fields?: string[]): Promise<ThreadsUser> {
    const defaultFields = [
      'id',
      'username',
      'name',
      'threads_profile_picture_url',
      'threads_biography',
    ];
    const requestFields = fields || defaultFields;

    const response = await this.client.get(`/${this.config.userId}`, {
      params: { fields: requestFields.join(',') },
    });

    return ThreadsUserSchema.parse(response.data);
  }

  async getThreads(params?: GetMediaParams): Promise<ThreadsMedia[]> {
    const defaultFields = [
      'id',
      'media_product_type',
      'media_type',
      'media_url',
      'permalink',
      'username',
      'text',
      'timestamp',
      'shortcode',
      'thumbnail_url',
      'children',
      'is_quote_post',
    ];
    const requestFields = params?.fields || defaultFields;

    const response = await this.client.get(`/${this.config.userId}/threads`, {
      params: {
        fields: requestFields.join(','),
        limit: params?.limit || 25,
      },
    });

    if (!response.data.data) return [];
    return response.data.data.map((item: unknown) => ThreadsMediaSchema.parse(item));
  }

  // Extra read tools based on the capability map in griffinwork40/threads-mcp.
  // Implemented independently against official Meta Threads API endpoints.
  async listMyReplies(params?: {
    limit?: number;
    fields?: string[];
    after?: string;
  }): Promise<unknown> {
    const fields = params?.fields ?? ['id', 'text', 'username', 'permalink', 'timestamp'];
    const response = await this.client.get(`/${this.config.userId}/replies`, {
      params: {
        fields: fields.join(','),
        limit: params?.limit ?? 25,
        ...(params?.after ? { after: params.after } : {}),
      },
    });
    return response.data;
  }

  async getPublicProfilePosts(username: string, params?: {
    limit?: number;
    fields?: string[];
    after?: string;
  }): Promise<unknown> {
    const fields = params?.fields ?? ['id', 'text', 'username', 'permalink', 'timestamp', 'media_type'];
    const response = await this.client.get('/profile_posts', {
      params: {
        username,
        fields: fields.join(','),
        limit: params?.limit ?? 25,
        ...(params?.after ? { after: params.after } : {}),
      },
    });
    return response.data;
  }

  async getPublishingLimit(): Promise<unknown> {
    const response = await this.client.get(`/${this.config.userId}/threads_publishing_limit`, {
      params: { fields: 'quota_usage,config,reply_quota_usage,reply_config' },
    });
    return response.data;
  }

  async getThread(threadId: string, fields?: string[]): Promise<ThreadsMedia> {
    const defaultFields = [
      'id',
      'media_product_type',
      'media_type',
      'media_url',
      'permalink',
      'username',
      'text',
      'timestamp',
      'shortcode',
      'thumbnail_url',
      'children',
      'is_quote_post',
    ];
    const requestFields = fields || defaultFields;

    const response = await this.client.get(`/${threadId}`, {
      params: { fields: requestFields.join(',') },
    });

    return ThreadsMediaSchema.parse(response.data);
  }

  async searchThreads(query: string, params?: SearchThreadsParams): Promise<unknown> {
    const response = await this.client.get('/keyword_search', {
      params: {
        q: query,
        search_type: params?.searchType || 'TOP',
        ...(params?.fields && { fields: params.fields.join(',') }),
        ...(params?.limit && { limit: params.limit }),
        ...(params?.since && { since: params.since }),
        ...(params?.until && { until: params.until }),
      },
    });
    return response.data;
  }

  async getMentions(params?: GetMediaParams): Promise<unknown> {
    const response = await this.client.get(`/${this.config.userId}/mentions`, {
      params: {
        ...(params?.fields && { fields: params.fields.join(',') }),
        ...(params?.limit && { limit: params.limit }),
      },
    });
    return response.data;
  }

  async profileLookup(username: string, params?: ProfileLookupParams): Promise<unknown> {
    const response = await this.client.get('/profile_lookup', {
      params: {
        username,
        ...(params?.fields && { fields: params.fields.join(',') }),
      },
    });
    return response.data;
  }

  async searchLocations(query: string, params?: SearchLocationsParams): Promise<unknown> {
    const response = await this.client.get('/location_search', {
      params: {
        q: query,
        ...(params?.fields && { fields: params.fields.join(',') }),
        ...(params?.latitude !== undefined && { latitude: params.latitude }),
        ...(params?.longitude !== undefined && { longitude: params.longitude }),
      },
    });
    return response.data;
  }

  async getLocation(locationId: string, fields?: string[]): Promise<unknown> {
    const response = await this.client.get(`/${locationId}`, {
      params: {
        ...(fields && { fields: fields.join(',') }),
      },
    });
    return response.data;
  }

  private async publishThread(params: CreateThreadParams): Promise<CreateThreadResponse> {
    const containerParams: Record<string, string> = {
      media_type: 'TEXT',
    };

    if (params.text) containerParams.text = params.text;
    if (params.imageUrl) {
      containerParams.media_type = 'IMAGE';
      containerParams.image_url = params.imageUrl;
    }
    if (params.videoUrl) {
      containerParams.media_type = 'VIDEO';
      containerParams.video_url = params.videoUrl;
    }
    if (params.replyToId) containerParams.reply_to_id = params.replyToId;
    if (params.replyControl) containerParams.reply_control = params.replyControl;

    const containerResponse = await this.client.post(
      `/${this.config.userId}/threads`,
      null,
      { params: containerParams }
    );

    const publishResponse = await this.client.post(
      `/${this.config.userId}/threads_publish`,
      null,
      { params: { creation_id: containerResponse.data.id } }
    );

    return CreateThreadResponseSchema.parse(publishResponse.data);
  }

  async createThread(
    params: CreateThreadParams,
    approval: KZWriteApproval
  ): Promise<CreateThreadResponse> {
    await this.requireWriteApproval('threads_create_thread', approval);
    return this.publishThread(params);
  }

  async replyToThread(
    threadId: string,
    text: string,
    approval: KZWriteApproval,
    replyControl?: CreateThreadParams['replyControl']
  ): Promise<CreateThreadResponse> {
    await this.requireWriteApproval('threads_reply_to_thread', approval, threadId);
    return this.publishThread({ text, replyToId: threadId, replyControl });
  }

  async repostThread(
    threadId: string,
    approval: KZWriteApproval
  ): Promise<CreateThreadResponse> {
    await this.requireWriteApproval('threads_repost_thread', approval, threadId);

    const containerResponse = await this.client.post(`/${threadId}/repost`, null);
    const publishResponse = await this.client.post(
      `/${this.config.userId}/threads_publish`,
      null,
      { params: { creation_id: containerResponse.data.id } }
    );

    return CreateThreadResponseSchema.parse(publishResponse.data);
  }

  async deleteThread(threadId: string, approval: KZWriteApproval): Promise<unknown> {
    await this.requireWriteApproval('threads_delete_thread', approval, threadId);
    const response = await this.client.delete(`/${threadId}`);
    return response.data;
  }

  async manageReply(
    replyId: string,
    hide: boolean,
    approval: KZWriteApproval
  ): Promise<unknown> {
    await this.requireWriteApproval('threads_manage_reply', approval, replyId);
    const response = await this.client.post(`/${replyId}/manage_reply`, null, {
      params: { hide },
    });
    return response.data;
  }

  async managePendingReply(
    replyId: string,
    approve: boolean,
    approval: KZWriteApproval
  ): Promise<unknown> {
    await this.requireWriteApproval('threads_manage_pending_reply', approval, replyId);
    const response = await this.client.post(`/${replyId}/manage_pending_reply`, null, {
      params: { approve },
    });
    return response.data;
  }

  async getThreadInsights(
    threadId: string,
    params: GetInsightsParams
  ): Promise<ThreadsInsights[]> {
    const response = await this.client.get(`/${threadId}/insights`, {
      params: {
        metric: params.metric.join(','),
        ...(params.since && { since: params.since }),
        ...(params.until && { until: params.until }),
      },
    });

    if (!response.data.data) return [];
    return response.data.data.map((item: unknown) => ThreadsInsightsSchema.parse(item));
  }

  async getUserInsights(params: GetInsightsParams): Promise<ThreadsInsights[]> {
    const response = await this.client.get(`/${this.config.userId}/threads_insights`, {
      params: {
        metric: params.metric.join(','),
        ...(params.since && { since: params.since }),
        ...(params.until && { until: params.until }),
      },
    });

    if (!response.data.data) return [];
    return response.data.data.map((item: unknown) => ThreadsInsightsSchema.parse(item));
  }

  async getReplies(threadId: string, params?: GetRepliesParams): Promise<ThreadsReplies> {
    const defaultFields = ['id', 'text', 'username', 'permalink', 'timestamp'];
    const requestFields = params?.fields || defaultFields;

    const response = await this.client.get(`/${threadId}/replies`, {
      params: {
        fields: requestFields.join(','),
        ...(params?.reverse !== undefined && { reverse: params.reverse }),
      },
    });

    return ThreadsRepliesSchema.parse(response.data);
  }

  async getConversation(
    threadId: string,
    params?: GetRepliesParams
  ): Promise<ThreadsConversation> {
    const defaultFields = ['id', 'text', 'username', 'permalink', 'timestamp'];
    const requestFields = params?.fields || defaultFields;

    const response = await this.client.get(`/${threadId}/conversation`, {
      params: {
        fields: requestFields.join(','),
        ...(params?.reverse !== undefined && { reverse: params.reverse }),
      },
    });

    return ThreadsConversationSchema.parse(response.data);
  }

  async validateToken(): Promise<boolean> {
    try {
      await this.getProfile(['id']);
      return true;
    } catch {
      return false;
    }
  }
}
