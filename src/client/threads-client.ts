import { sanitizeMetaResponse } from '../utils/sanitize-meta-response.js';
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
  ProfileCommentsParams,
  PendingRepliesParams,
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
            error.response.data ? JSON.stringify(sanitizeMetaResponse(error.response.data)) : 'Unknown API error',
            error.response.status,
            sanitizeMetaResponse(error.response.data)
          );
        } else if (error.request) {
          throw new ThreadsAPIError('No response received from Threads API');
        } else {
          throw new ThreadsAPIError(`Request failed: ${sanitizeMetaResponse(error.message)}`);
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

  private isPublicDiscoveryScopeRejection(error: unknown): boolean {
    if (!(error instanceof ThreadsAPIError)) return false;
    const details = error.response as
      | { error?: { code?: number; error_subcode?: number } }
      | undefined;
    return details?.error?.code === 10 && details.error.error_subcode === 4279067;
  }

  private async isAuthenticatedOwnerUsername(username: string): Promise<boolean> {
    const owner = await this.getProfile(['id', 'username']);
    return owner.username.toLowerCase() === username.trim().replace(/^@/, '').toLowerCase();
  }

  async getPublicProfilePosts(username: string, params?: {
    limit?: number;
    fields?: string[];
    after?: string;
  }): Promise<unknown> {
    const fields = params?.fields ?? ['id', 'text', 'username', 'permalink', 'timestamp', 'media_type'];
    try {
      const response = await this.client.get('/profile_posts', {
        params: {
          username,
          fields: fields.join(','),
          limit: params?.limit ?? 25,
          ...(params?.after ? { after: params.after } : {}),
        },
      });
      return response.data;
    } catch (error) {
      if (!this.isPublicDiscoveryScopeRejection(error) ||
          !(await this.isAuthenticatedOwnerUsername(username))) throw error;
      // Only the authenticated owner's matching username can use this route.
      // Preserve the original page shape/cursor and expose data provenance.
      const response = await this.client.get(`/${this.config.userId}/threads`, {
        params: {
          fields: fields.join(','),
          limit: params?.limit ?? 25,
          ...(params?.after ? { after: params.after } : {}),
        },
      });
      return { ...response.data, _source: 'authenticated_owner' };
    }
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
    const fields = params?.fields ?? ['username', 'name'];
    try {
      const response = await this.client.get('/profile_lookup', {
        params: {
          username,
          fields: fields.join(','),
        },
      });
      return response.data;
    } catch (error) {
      if (!this.isPublicDiscoveryScopeRejection(error) ||
          !(await this.isAuthenticatedOwnerUsername(username))) throw error;
      // Never substitute authenticated data for another person's profile.
      const owner = await this.getProfile([...new Set(['id', 'username', ...fields])]);
      const data = owner as unknown as Record<string, unknown>;
      return {
        ...Object.fromEntries(fields.filter((field) => field in data)
          .map((field) => [field, data[field]])),
        _source: 'authenticated_owner',
      };
    }
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


  /** Bounded, owned-account read; one post page of at most 10 posts per call. */
  async getProfileComments(params: ProfileCommentsParams = {}): Promise<unknown> {
    const limit = params.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be 1..100');
    if (params.since !== undefined && params.until !== undefined && params.since > params.until)
      throw new Error('since must not exceed until');
    const scope = {
      since: params.since ?? null, until: params.until ?? null,
      depth: params.depth ?? 'top', includeOwn: params.includeOwn ?? false
    };
    type Position = { postsAfter?: string; postIndex: number; replyAfter?: string };
    let position: Position = { postIndex: 0 };
    if (params.after) {
      try {
        if (params.after.length > 4096) throw Error('too long');
        const parsed = JSON.parse(Buffer.from(params.after,'base64url').toString('utf8'));
        if (parsed.v !== 1 || !Number.isInteger(parsed.postIndex) ||
          parsed.postIndex < 0 || parsed.postIndex > 9 ||
          (parsed.postsAfter !== undefined && typeof parsed.postsAfter !== 'string') ||
          (parsed.replyAfter !== undefined && typeof parsed.replyAfter !== 'string') ||
          JSON.stringify(parsed.scope) !== JSON.stringify(scope)) throw Error('invalid');
        position = parsed;
      } catch { throw Error('Invalid comments cursor'); }
    }
    const encode = (p:Position) => Buffer.from(JSON.stringify({v:1,scope,...p}),'utf8').toString('base64url');
    const own = params.includeOwn ? null : await this.getProfile(['id','username']);
    const page = await this.client.get('/'+this.config.userId+'/threads', {
      params: {fields:'id,permalink',limit:10,...(position.postsAfter?{after:position.postsAfter}:{})}
    });
    const posts = (page.data?.data || []) as Array<{id:string;permalink?:string}>;
    if(position.postsAfter && posts.length===0) {
      return {data:[],meta:{next:null,truncated:false,scanned_posts:0,returned:0}};
    }
    if (position.postIndex >= posts.length && posts.length > 0)
      throw Error('Post paging cursor changed; restart scan');
    const data:Array<Record<string,unknown>>=[];
    let next:string|null=null;
    let scanned=0;
    for(let i=position.postIndex;i<posts.length;i++){
      const post=posts[i];
      if(!post?.id)continue;
      scanned++;
      const remaining=limit-data.length;
      const requestLimit=Math.min(25,Math.max(1,remaining));
      const reply=await this.client.get('/'+post.id+'/'+(scope.depth==='all'?'conversation':'replies'),{
        params:{
          fields:'id,text,username,timestamp,permalink,is_reply_owned_by_me',
          limit:requestLimit,
          ...(i===position.postIndex&&position.replyAfter?{after:position.replyAfter}:{})
        }
      });
      const items=(reply.data?.data||[]) as Array<Record<string,unknown>>;
      if(items.length>requestLimit)throw Error('Meta exceeded requested reply page size');
      for(const item of items){
        if(item.id===post.id || (!scope.includeOwn &&
          (item.is_reply_owned_by_me===true ||
          (typeof item.username==='string' && item.username.toLowerCase()===own?.username.toLowerCase()))))continue;
        const stamp=typeof item.timestamp==='string'?Date.parse(item.timestamp)/1000:NaN;
        if(params.since!==undefined && !(stamp>=params.since))continue;
        if(params.until!==undefined && !(stamp<=params.until))continue;
        data.push({...item,post:{id:post.id,permalink:post.permalink}});
      }
      // Meta's Threads API can return only paging.cursors, without paging.next.
      // Treat a non-empty page plus a new cursor as potentially resumable.
      // A final empty page clears that post and allows the scan to advance.
      const replyAfter=reply.data?.paging?.cursors?.after;
      if(reply.data?.paging?.next && !replyAfter)
        throw Error('Meta reply page advertised next without a cursor');
      if(items.length>0 && replyAfter){
        if(replyAfter===position.replyAfter && i===position.postIndex)
          throw Error('Meta reply cursor did not advance');
        next=encode({postsAfter:position.postsAfter,postIndex:i,replyAfter});
        break;
      }
      if(data.length>=limit){
        if(i+1<posts.length)next=encode({postsAfter:position.postsAfter,postIndex:i+1});
        break;
      }
    }
    // Threads media pages likewise may expose cursors without a next URL.
    // An extra empty continuation page is preferable to silently missing posts.
    const postsAfter=page.data?.paging?.cursors?.after;
    if(!next && page.data?.paging?.next && !postsAfter)
      throw Error('Meta post page advertised next without a cursor');
    if(!next && posts.length>0 && postsAfter){
      if(postsAfter===position.postsAfter) throw Error('Meta post cursor did not advance');
      next=encode({postsAfter,postIndex:0});
    }
    return {data:sanitizeMetaResponse(data),meta:{next,truncated:!!next,scanned_posts:scanned,returned:data.length}};
  }

  /** Returns only a single owned post's pending reply queue. */
  async getPendingReplies(params: PendingRepliesParams):Promise<unknown>{
    const result=await this.client.get('/'+params.threadId+'/pending_replies',{
      params:{
        fields:(params.fields||['id','text','username','timestamp','permalink']).join(','),
        approval_status:'pending',
        ...(params.limit!==undefined?{limit:params.limit}:{}),
        ...(params.after?{after:params.after}:{})
      }
    });
    return sanitizeMetaResponse(result.data);
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


  // Additional Griffin-inspired capabilities. All creations and publication
  // require a real host-side approval validator (the default is deny-all).
  async getContainerStatus(containerId: string): Promise<unknown> {
    const response = await this.client.get(`/${containerId}`, {
      params: { fields: 'id,status,error_message' },
    });
    return response.data;
  }

  async createVideoContainer(params: {
    videoUrl: string;
    text?: string;
    altText?: string;
  }, approval: KZWriteApproval): Promise<CreateThreadResponse> {
    await this.requireWriteApproval('threads_create_video_container', approval);
    const response = await this.client.post(
      `/${this.config.userId}/threads`, null,
      { params: {
        media_type: 'VIDEO',
        video_url: params.videoUrl,
        ...(params.text ? { text: params.text } : {}),
        ...(params.altText ? { alt_text: params.altText } : {}),
      } }
    );
    return CreateThreadResponseSchema.parse(response.data);
  }

  async createCarouselContainer(params: {
    items: Array<{ type: 'IMAGE' | 'VIDEO'; url: string; altText?: string }>;
    text?: string;
  }, approval: KZWriteApproval): Promise<CreateThreadResponse> {
    await this.requireWriteApproval('threads_create_carousel_post', approval);
    // The MCP input schema also checks this; enforce again at client boundary.
    if (params.items.length < 2 || params.items.length > 20) {
      throw new Error('Carousel must contain 2 to 20 media items.');
    }
    const ids: string[] = [];
    for (const item of params.items) {
      const child = await this.client.post(
        `/${this.config.userId}/threads`, null,
        { params: {
          media_type: item.type,
          ...(item.type === 'IMAGE' ? { image_url: item.url } : { video_url: item.url }),
          is_carousel_item: true,
          ...(item.altText ? { alt_text: item.altText } : {}),
        } }
      );
      ids.push(CreateThreadResponseSchema.parse(child.data).id);
    }
    const response = await this.client.post(
      `/${this.config.userId}/threads`, null,
      { params: {
        media_type: 'CAROUSEL',
        children: ids.join(','),
        ...(params.text ? { text: params.text } : {}),
      } }
    );
    // Deliberately return an unpublished container. The author must separately
    // validate every VIDEO child's readiness before publishing.
    return CreateThreadResponseSchema.parse(response.data);
  }

  async publishContainer(containerId: string, approval: KZWriteApproval): Promise<CreateThreadResponse> {
    await this.requireWriteApproval('threads_publish_container', approval, containerId);
    const response = await this.client.post(
      `/${this.config.userId}/threads_publish`, null,
      { params: { creation_id: containerId } }
    );
    return CreateThreadResponseSchema.parse(response.data);
  }

  async quoteThread(params: {
    threadId: string;
    text: string;
  }, approval: KZWriteApproval): Promise<CreateThreadResponse> {
    await this.requireWriteApproval('threads_quote_thread', approval, params.threadId);
    const response = await this.client.post(
      `/${this.config.userId}/threads`, null,
      { params: {
        media_type: 'TEXT',
        text: params.text,
        quote_post_id: params.threadId,
      } }
    );
    // Create a draft container only; a second, separately approved publish call is required.
    return CreateThreadResponseSchema.parse(response.data);
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
