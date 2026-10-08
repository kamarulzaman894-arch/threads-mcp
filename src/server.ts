import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { ThreadsClient } from './client/threads-client.js';
import { z } from 'zod';

const ApprovalSchema = z.object({
  approved: z.literal(true),
  approvedBy: z.literal('KZ'),
  approvalRef: z.string().min(1),
});

const GetProfileSchema = z.object({
  fields: z.array(z.string()).optional(),
});

const GetThreadsSchema = z.object({
  limit: z.number().min(1).max(100).optional(),
  fields: z.array(z.string()).optional(),
});

const ListMyRepliesSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  fields: z.array(z.string()).optional(),
  after: z.string().optional(),
});

const PublicProfilePostsSchema = z.object({
  username: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
  fields: z.array(z.string()).optional(),
  after: z.string().optional(),
});

const GetThreadSchema = z.object({
  threadId: z.string().min(1),
  fields: z.array(z.string()).optional(),
});

const SearchThreadsSchema = z.object({
  query: z.string().min(1),
  searchType: z.enum(['TOP', 'RECENT']).optional(),
  fields: z.array(z.string()).optional(),
  limit: z.number().min(1).max(100).optional(),
  since: z.number().optional(),
  until: z.number().optional(),
});

const GetMentionsSchema = z.object({
  limit: z.number().min(1).max(100).optional(),
  fields: z.array(z.string()).optional(),
});

const ProfileLookupSchema = z.object({
  username: z.string().min(1),
  fields: z.array(z.string()).optional(),
});

const SearchLocationsSchema = z.object({
  query: z.string().min(1),
  fields: z.array(z.string()).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const GetLocationSchema = z.object({
  locationId: z.string().min(1),
  fields: z.array(z.string()).optional(),
});

const CreateThreadSchema = z.object({
  text: z.string().optional(),
  imageUrl: z.string().url().optional(),
  videoUrl: z.string().url().optional(),
  replyToId: z.string().optional(),
  replyControl: z
    .enum([
      'everyone',
      'accounts_you_follow',
      'mentioned_only',
      'parent_post_author_only',
      'followers_only',
    ])
    .optional(),
  approval: ApprovalSchema,
});

const ReplyToThreadSchema = z.object({
  threadId: z.string().min(1),
  text: z.string().min(1),
  replyControl: z
    .enum([
      'everyone',
      'accounts_you_follow',
      'mentioned_only',
      'parent_post_author_only',
      'followers_only',
    ])
    .optional(),
  approval: ApprovalSchema,
});

const RepostThreadSchema = z.object({
  threadId: z.string().min(1),
  approval: ApprovalSchema,
});

const DeleteThreadSchema = z.object({
  threadId: z.string().min(1),
  approval: ApprovalSchema,
});

const ManageReplySchema = z.object({
  replyId: z.string().min(1),
  hide: z.boolean(),
  approval: ApprovalSchema,
});

const ManagePendingReplySchema = z.object({
  replyId: z.string().min(1),
  approve: z.boolean(),
  approval: ApprovalSchema,
});

const GetInsightsSchema = z.object({
  threadId: z.string().optional(),
  metrics: z.array(z.string()).min(1),
  since: z.number().optional(),
  until: z.number().optional(),
});

const GetRepliesSchema = z.object({
  threadId: z.string().min(1),
  fields: z.array(z.string()).optional(),
  reverse: z.boolean().optional(),
});

const GetConversationSchema = z.object({
  threadId: z.string().min(1),
  fields: z.array(z.string()).optional(),
  reverse: z.boolean().optional(),
});

const approvalInput = {
  type: 'object' as const,
  description:
    'Required for write actions. The host runtime must validate approvalRef against a real KZ approval; tool arguments alone cannot authorize a write.',
  properties: {
    approved: { type: 'boolean' as const, const: true },
    approvedBy: { type: 'string' as const, const: 'KZ' },
    approvalRef: { type: 'string' as const },
  },
  required: ['approved', 'approvedBy', 'approvalRef'],
};

export class ThreadsMCPServer {
  private server: Server;
  private client: ThreadsClient | null = null;

  constructor(private readonly readOnly = false) {
    this.server = new Server(
      {
        name: 'kz-threads-mcp-human-controlled',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools: Tool[] = [
        {
          name: 'threads_get_profile',
          description: 'READ: Get the authenticated Threads profile.',
          inputSchema: {
            type: 'object',
            properties: {
              fields: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        {
          name: 'threads_get_threads',
          description: 'READ: List the authenticated user\'s Threads posts.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', minimum: 1, maximum: 100 },
              fields: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        {
          name: 'threads_list_my_replies',
          description: 'READ: List replies authored by the authenticated user.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 100 },
              fields: { type: 'array', items: { type: 'string' } },
              after: { type: 'string' },
            },
          },
        },
        {
          name: 'threads_get_public_profile_posts',
          description: 'READ: List public posts for an exact username (requires Threads profile discovery permission).',
          inputSchema: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              limit: { type: 'integer', minimum: 1, maximum: 100 },
              fields: { type: 'array', items: { type: 'string' } },
              after: { type: 'string' },
            },
            required: ['username'],
          },
        },
        {
          name: 'threads_get_publishing_limit',
          description: 'READ: Retrieve remaining publishing and reply quotas without performing any write.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'threads_get_thread',
          description: 'READ: Get one Threads post by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
            },
            required: ['threadId'],
          },
        },
        {
          name: 'threads_search',
          description: 'READ: Search Threads posts by keyword.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              searchType: { type: 'string', enum: ['TOP', 'RECENT'] },
              fields: { type: 'array', items: { type: 'string' } },
              limit: { type: 'number', minimum: 1, maximum: 100 },
              since: { type: 'number' },
              until: { type: 'number' },
            },
            required: ['query'],
          },
        },
        {
          name: 'threads_get_mentions',
          description: 'READ: Get posts that mention the authenticated Threads account.',
          inputSchema: {
            type: 'object',
            properties: {
              limit: { type: 'number', minimum: 1, maximum: 100 },
              fields: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        {
          name: 'threads_profile_lookup',
          description: 'READ: Discover a Threads public profile by username.',
          inputSchema: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
            },
            required: ['username'],
          },
        },
        {
          name: 'threads_search_locations',
          description: 'READ: Search Threads locations.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
            },
            required: ['query'],
          },
        },
        {
          name: 'threads_get_location',
          description: 'READ: Retrieve one Threads location by ID.',
          inputSchema: {
            type: 'object',
            properties: {
              locationId: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
            },
            required: ['locationId'],
          },
        },
        {
          name: 'threads_get_insights',
          description: 'READ: Get post or account Threads insights.',
          inputSchema: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              metrics: { type: 'array', items: { type: 'string' } },
              since: { type: 'number' },
              until: { type: 'number' },
            },
            required: ['metrics'],
          },
        },
        {
          name: 'threads_get_replies',
          description: 'READ: Get replies to a Threads post.',
          inputSchema: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
              reverse: { type: 'boolean' },
            },
            required: ['threadId'],
          },
        },
        {
          name: 'threads_get_conversation',
          description: 'READ: Get a Threads conversation.',
          inputSchema: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              fields: { type: 'array', items: { type: 'string' } },
              reverse: { type: 'boolean' },
            },
            required: ['threadId'],
          },
        },
        {
          name: 'threads_create_thread',
          description: 'WRITE: Publish a Threads post. Requires validated KZ approval.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              imageUrl: { type: 'string' },
              videoUrl: { type: 'string' },
              replyToId: { type: 'string' },
              replyControl: {
                type: 'string',
                enum: [
                  'everyone',
                  'accounts_you_follow',
                  'mentioned_only',
                  'parent_post_author_only',
                  'followers_only',
                ],
              },
              approval: approvalInput,
            },
            required: ['approval'],
          },
        },
        {
          name: 'threads_reply_to_thread',
          description: 'WRITE: Reply to a Threads post. Requires validated KZ approval.',
          inputSchema: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              text: { type: 'string' },
              replyControl: {
                type: 'string',
                enum: [
                  'everyone',
                  'accounts_you_follow',
                  'mentioned_only',
                  'parent_post_author_only',
                  'followers_only',
                ],
              },
              approval: approvalInput,
            },
            required: ['threadId', 'text', 'approval'],
          },
        },
        {
          name: 'threads_repost_thread',
          description: 'WRITE: Repost a Threads post. Requires validated KZ approval.',
          inputSchema: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              approval: approvalInput,
            },
            required: ['threadId', 'approval'],
          },
        },
        {
          name: 'threads_delete_thread',
          description: 'WRITE: Delete an owned Threads post. Requires validated KZ approval.',
          inputSchema: {
            type: 'object',
            properties: {
              threadId: { type: 'string' },
              approval: approvalInput,
            },
            required: ['threadId', 'approval'],
          },
        },
        {
          name: 'threads_manage_reply',
          description:
            'WRITE: Hide or unhide a reply. Requires validated KZ approval.',
          inputSchema: {
            type: 'object',
            properties: {
              replyId: { type: 'string' },
              hide: { type: 'boolean' },
              approval: approvalInput,
            },
            required: ['replyId', 'hide', 'approval'],
          },
        },
        {
          name: 'threads_manage_pending_reply',
          description:
            'WRITE: Approve or ignore a pending reply. Requires validated KZ approval.',
          inputSchema: {
            type: 'object',
            properties: {
              replyId: { type: 'string' },
              approve: { type: 'boolean' },
              approval: approvalInput,
            },
            required: ['replyId', 'approve', 'approval'],
          },
        },
      ];

      return { tools: this.readOnly ? tools.filter((tool) => tool.description?.startsWith('READ:')) : tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!this.client) {
        throw new Error('Threads client not initialized. Please configure access token and user ID.');
      }

      const { name, arguments: args } = request.params;
      if (this.readOnly && !name.startsWith('threads_get_') && !['threads_search', 'threads_profile_lookup', 'threads_search_locations', 'threads_list_my_replies'].includes(name)) {
        throw new Error('READ_ONLY: write and unknown tools are disabled for remote MCP.');
      }

      try {
        switch (name) {
          case 'threads_get_profile': {
            const params = GetProfileSchema.parse(args);
            return textResult(await this.client.getProfile(params.fields));
          }
          case 'threads_get_threads': {
            const params = GetThreadsSchema.parse(args);
            return textResult(await this.client.getThreads(params));
          }
          case 'threads_list_my_replies': {
            const params = ListMyRepliesSchema.parse(args);
            return textResult(await this.client.listMyReplies(params));
          }
          case 'threads_get_public_profile_posts': {
            const params = PublicProfilePostsSchema.parse(args);
            return textResult(await this.client.getPublicProfilePosts(params.username, params));
          }
          case 'threads_get_publishing_limit': {
            return textResult(await this.client.getPublishingLimit());
          }
          case 'threads_get_thread': {
            const params = GetThreadSchema.parse(args);
            return textResult(await this.client.getThread(params.threadId, params.fields));
          }
          case 'threads_search': {
            const params = SearchThreadsSchema.parse(args);
            return textResult(
              await this.client.searchThreads(params.query, {
                searchType: params.searchType,
                fields: params.fields,
                limit: params.limit,
                since: params.since,
                until: params.until,
              })
            );
          }
          case 'threads_get_mentions': {
            const params = GetMentionsSchema.parse(args);
            return textResult(await this.client.getMentions(params));
          }
          case 'threads_profile_lookup': {
            const params = ProfileLookupSchema.parse(args);
            return textResult(
              await this.client.profileLookup(params.username, { fields: params.fields })
            );
          }
          case 'threads_search_locations': {
            const params = SearchLocationsSchema.parse(args);
            return textResult(
              await this.client.searchLocations(params.query, {
                fields: params.fields,
                latitude: params.latitude,
                longitude: params.longitude,
              })
            );
          }
          case 'threads_get_location': {
            const params = GetLocationSchema.parse(args);
            return textResult(await this.client.getLocation(params.locationId, params.fields));
          }
          case 'threads_get_insights': {
            const params = GetInsightsSchema.parse(args);
            const insights = params.threadId
              ? await this.client.getThreadInsights(params.threadId, {
                  metric: params.metrics,
                  since: params.since,
                  until: params.until,
                })
              : await this.client.getUserInsights({
                  metric: params.metrics,
                  since: params.since,
                  until: params.until,
                });
            return textResult(insights);
          }
          case 'threads_get_replies': {
            const params = GetRepliesSchema.parse(args);
            return textResult(
              await this.client.getReplies(params.threadId, {
                fields: params.fields,
                reverse: params.reverse,
              })
            );
          }
          case 'threads_get_conversation': {
            const params = GetConversationSchema.parse(args);
            return textResult(
              await this.client.getConversation(params.threadId, {
                fields: params.fields,
                reverse: params.reverse,
              })
            );
          }
          case 'threads_create_thread': {
            const params = CreateThreadSchema.parse(args);
            const { approval, ...threadParams } = params;
            return textResult(await this.client.createThread(threadParams, approval));
          }
          case 'threads_reply_to_thread': {
            const params = ReplyToThreadSchema.parse(args);
            return textResult(
              await this.client.replyToThread(
                params.threadId,
                params.text,
                params.approval,
                params.replyControl
              )
            );
          }
          case 'threads_repost_thread': {
            const params = RepostThreadSchema.parse(args);
            return textResult(await this.client.repostThread(params.threadId, params.approval));
          }
          case 'threads_delete_thread': {
            const params = DeleteThreadSchema.parse(args);
            return textResult(await this.client.deleteThread(params.threadId, params.approval));
          }
          case 'threads_manage_reply': {
            const params = ManageReplySchema.parse(args);
            return textResult(
              await this.client.manageReply(params.replyId, params.hide, params.approval)
            );
          }
          case 'threads_manage_pending_reply': {
            const params = ManagePendingReplySchema.parse(args);
            return textResult(
              await this.client.managePendingReply(
                params.replyId,
                params.approve,
                params.approval
              )
            );
          }
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new Error(`Invalid parameters: ${JSON.stringify(error.errors)}`);
        }
        throw error;
      }
    });
  }

  setClient(client: ThreadsClient) {
    this.client = client;
  }

  async connect(transport: Transport) {
    await this.server.connect(transport);
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.connect(transport);
  }
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}
