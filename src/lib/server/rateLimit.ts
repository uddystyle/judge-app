import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

// 環境変数の存在確認
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// Redis接続が利用可能かチェック
const isRedisAvailable = !!(REDIS_URL && REDIS_TOKEN);

// Redis が利用可能な場合のみ初期化
let redis: Redis | null = null;
if (isRedisAvailable) {
  redis = Redis.fromEnv();
}

// レート制限が有効かどうか
export const isRateLimitEnabled = isRedisAvailable;

// エンドポイントタイプ別のレート制限（Redis利用可能な場合のみ）
export const rateLimiters = isRedisAvailable && redis ? {
  // 認証系: 15分で5回まで
  auth: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'),
    analytics: true,
    prefix: 'ratelimit:auth',
  }),

  // API: 1分で60回まで
  api: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    analytics: true,
    prefix: 'ratelimit:api',
  }),

  // 高負荷操作: 1時間で10回まで
  expensive: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 h'),
    analytics: true,
    prefix: 'ratelimit:expensive',
  }),
} : null;

// クライアント識別用ヘルパー
export function getClientIdentifier(request: Request): string {
  const ip = request.headers.get('x-forwarded-for') ||
             request.headers.get('x-real-ip') ||
             'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return `${ip}:${userAgent.substring(0, 50)}`;
}

// レート制限チェック（Redis未設定の場合は常に成功）
// Fail-safe ポリシー: fail-open（障害時は通す）
// Redis/Upstashの一時的な障害でサービス全体が停止しないようにする
export async function checkRateLimit(
  request: Request,
  limiter: Ratelimit | null | undefined,
  userId?: string
): Promise<{ success: boolean; response?: Response }> {
  // Redis未設定またはlimiterがnull/undefinedの場合は常に成功
  if (!isRateLimitEnabled || !limiter) {
    return { success: true };
  }

  const identifier = userId || getClientIdentifier(request);

  try {
    const { success, limit, reset, remaining } = await limiter.limit(identifier);

    if (!success) {
      return {
        success: false,
        response: new Response(
          JSON.stringify({
            error: 'リクエストが多すぎます。しばらくしてから再度お試しください。',
            retryAfter: Math.ceil((reset - Date.now()) / 1000)
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': new Date(reset).toISOString(),
              'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
            },
          }
        ),
      };
    }

    return { success: true };
  } catch (error) {
    // Fail-open: Upstash/Redisの障害時でもリクエストを通す
    // これにより、レート制限サービスの障害がアプリケーション全体の停止を引き起こさない
    console.error('[RateLimit] レート制限チェック失敗（Upstash障害の可能性）:', error);
    console.error('[RateLimit] Fail-open: リクエストを許可します');

    // TODO: 本番環境では監視アラートを送信
    // 例: Sentry.captureException(error)

    return { success: true };
  }
}
