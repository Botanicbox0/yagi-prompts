/**
 * The slice of `web-push` 3.6.7 that lib/notify/push.ts uses. The package ships no types, and
 * docs/PLATFORM-2.0.md §13-11 allows `web-push` itself and nothing beyond it (so no @types package).
 */
declare module 'web-push' {
  export interface PushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  export interface VapidDetails {
    subject: string;
    publicKey: string;
    privateKey: string;
  }

  export interface RequestOptions {
    vapidDetails?: VapidDetails;
    TTL?: number;
    urgency?: 'very-low' | 'low' | 'normal' | 'high';
    topic?: string;
    timeout?: number;
    headers?: Record<string, string>;
    contentEncoding?: 'aesgcm' | 'aes128gcm';
  }

  export interface SendResult {
    statusCode: number;
    body: string;
    headers: Record<string, string | string[] | undefined>;
  }

  export class WebPushError extends Error {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
    endpoint: string;
  }

  export function sendNotification(subscription: PushSubscription, payload?: string | Buffer | null, options?: RequestOptions): Promise<SendResult>;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };

  const webPush: {
    sendNotification: typeof sendNotification;
    generateVAPIDKeys: typeof generateVAPIDKeys;
    WebPushError: typeof WebPushError;
  };
  export default webPush;
}
