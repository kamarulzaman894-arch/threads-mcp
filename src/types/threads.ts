import { z } from 'zod';
import type { KZWriteApprovalValidator } from '../authority/write-approval.js';

// Threads API Response Types
export const ThreadsUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  name: z.string().optional(),
  threads_profile_picture_url: z.string().optional(),
  threads_biography: z.string().optional(),
});

export const ThreadsMediaSchema = z.object({
  id: z.string(),
  // The caller may request only a subset of fields. Do not require fields
  // that were not requested from the Threads API.
  media_product_type: z.string().optional(),
  media_type: z.enum(['TEXT', 'TEXT_POST', 'IMAGE', 'VIDEO', 'CAROUSEL_ALBUM']).optional(),
  media_url: z.string().optional(),
  permalink: z.string().optional(),
  username: z.string().optional(),
  text: z.string().optional(),
  timestamp: z.string().optional(),
  shortcode: z.string().optional(),
  thumbnail_url: z.string().optional(),
  children: z
    .object({
      data: z.array(
        z.object({
          id: z.string(),
        })
      ),
    })
    .optional(),
  is_quote_post: z.boolean().optional(),
});

export const ThreadsInsightsSchema = z.object({
  name: z.string(),
  period: z.string(),
  // Post insights commonly expose values[]. Account-level totals instead
  // expose total_value.value (e.g. followers_count or engagement totals).
  // Preserve both shapes; absence of values is not evidence of zero.
  values: z.array(
    z.object({
      value: z.number(),
      end_time: z.string().optional(),
    })
  ).optional(),
  total_value: z.object({
    value: z.union([z.number(), z.record(z.unknown())]),
  }).passthrough().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  id: z.string().optional(),
});

export const ThreadsRepliesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      text: z.string().optional(),
      username: z.string().optional(),
      permalink: z.string().optional(),
      timestamp: z.string().optional(),
    })
  ),
  paging: z
    .object({
      cursors: z.object({
        before: z.string().optional(),
        after: z.string().optional(),
      }),
    })
    .optional(),
});

export const ThreadsConversationSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      text: z.string().optional(),
      username: z.string().optional(),
      permalink: z.string().optional(),
      timestamp: z.string().optional(),
    })
  ),
  paging: z
    .object({
      cursors: z.object({
        before: z.string().optional(),
        after: z.string().optional(),
      }),
    })
    .optional(),
});

export const CreateThreadResponseSchema = z.object({
  id: z.string(),
});

export type ThreadsUser = z.infer<typeof ThreadsUserSchema>;
export type ThreadsMedia = z.infer<typeof ThreadsMediaSchema>;
export type ThreadsInsights = z.infer<typeof ThreadsInsightsSchema>;
export type ThreadsReplies = z.infer<typeof ThreadsRepliesSchema>;
export type ThreadsConversation = z.infer<typeof ThreadsConversationSchema>;
export type CreateThreadResponse = z.infer<typeof CreateThreadResponseSchema>;

// Client Configuration
export interface ThreadsConfig {
  accessToken: string;
  userId: string;
  apiVersion?: string;
  /**
   * Optional token manager for automatic token refresh
   * When provided, the client will automatically refresh tokens as needed
   */
  tokenManager?: {
    getToken: () => Promise<string>;
    getUserId: () => string;
  };
  /**
   * Required by all mutating methods. If omitted, write actions are denied.
   */
  writeApprovalValidator?: KZWriteApprovalValidator;
}

// Export for external use
export type { ThreadsConfig as ThreadsClientConfig };

// API Parameters
export interface CreateThreadParams {
  text?: string;
  imageUrl?: string;
  videoUrl?: string;
  replyToId?: string;
  replyControl?:
    | 'everyone'
    | 'accounts_you_follow'
    | 'mentioned_only'
    | 'parent_post_author_only'
    | 'followers_only';
}

export interface GetMediaParams {
  fields?: string[];
  limit?: number;
}

export interface GetInsightsParams {
  metric: string[];
  since?: number;
  until?: number;
}

export interface GetRepliesParams {
  fields?: string[];
  reverse?: boolean;
}


export interface SearchThreadsParams {
  searchType?: 'TOP' | 'RECENT';
  fields?: string[];
  limit?: number;
  since?: number;
  until?: number;
}

export interface SearchLocationsParams {
  fields?: string[];
  latitude?: number;
  longitude?: number;
}

export interface ProfileLookupParams {
  fields?: string[];
}

/** A cursor is valid only with the same since/until/depth/includeOwn settings. */
export interface ProfileCommentsParams {
  limit?: number;
  since?: number;
  until?: number;
  includeOwn?: boolean;
  depth?: 'top' | 'all';
  after?: string;
}

export interface PendingRepliesParams {
  threadId: string;
  fields?: string[];
  limit?: number;
  after?: string;
}
