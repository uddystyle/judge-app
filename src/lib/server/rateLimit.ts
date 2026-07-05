import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { logger } from '$lib/server/logger';

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
export const rateLimiters =
	isRedisAvailable && redis
		? {
				// 認証系: 15分で5回まで
				auth: new Ratelimit({
					redis,
					limiter: Ratelimit.slidingWindow(5, '15 m'),
					analytics: true,
					prefix: 'ratelimit:auth'
				}),

				// 参加コードの「失敗」専用: 10分で20回まで（IP単位）
				// 会場では多数の参加者が同一NAT IPを共有するため、join成功は一切制限せず、
				// 誤コード（404）だけを計上する。正しいコードでの一斉joinは無制限になり誤発火しない。
				// コード空間は36^8≈2.8e12のため、この緩い閾値でも総当たりは非現実的。
				joinFail: new Ratelimit({
					redis,
					limiter: Ratelimit.slidingWindow(20, '10 m'),
					analytics: true,
					prefix: 'ratelimit:joinfail'
				}),

				// API: 1分で60回まで
				api: new Ratelimit({
					redis,
					limiter: Ratelimit.slidingWindow(60, '1 m'),
					analytics: true,
					prefix: 'ratelimit:api'
				}),

				// 高負荷操作: 1時間で10回まで
				expensive: new Ratelimit({
					redis,
					limiter: Ratelimit.slidingWindow(10, '1 h'),
					analytics: true,
					prefix: 'ratelimit:expensive'
				})
			}
		: null;

// クライアント識別用ヘルパー
// 【セキュリティ改善】UA変更による回避を防ぐため、IPのみを使用
export function getClientIdentifier(request: Request, userId?: string): string {
	// 認証済みユーザーはuserIdを優先（最も確実な識別子）
	if (userId) {
		return `user:${userId}`;
	}

	// 【セキュリティ】詐称耐性のあるクライアントIP取得（Vercel）
	// x-forwarded-for の「先頭(左端)」はクライアントが prepend できるため詐称可能
	// （`attacker-ip, real-client-ip` のように偽値を左に挿入できる）。
	// Vercel はエッジで実接続元IPを x-real-ip に設定し、x-forwarded-for の「末尾(右端)」にも付与する。
	// よって x-real-ip を優先し、無い場合のみ x-forwarded-for の右端ホップ（Vercel付与=クライアント制御不可）を使う。
	const realIp = request.headers.get('x-real-ip');
	const forwardedFor = request.headers.get('x-forwarded-for');

	let ip = 'unknown';
	if (realIp) {
		ip = realIp.trim();
	} else if (forwardedFor) {
		const hops = forwardedFor.split(',');
		ip = hops[hops.length - 1].trim(); // 右端 = プラットフォームが付与した実接続元IP
	}

	// 匿名ユーザーはIPのみ
	// User-Agentは含めない（簡単に変更可能で回避耐性が低い）
	return `ip:${ip}`;
}

/**
 * レート制限の判定結果。
 * 判別可能なユニオンにすることで、呼び出し側で `if (!result.success)` と分岐したときに
 * `result.response` が必ず Response であることを TypeScript に認識させる。
 */
export type RateLimitResult = { success: true } | { success: false; response: Response };

// レート制限チェック（Redis未設定の場合は常に成功）
// Fail-safe ポリシー: fail-open（障害時は通す）
// Redis/Upstashの一時的な障害でサービス全体が停止しないようにする
export async function checkRateLimit(
	request: Request,
	limiter: Ratelimit | null | undefined,
	userId?: string
): Promise<RateLimitResult> {
	// Redis未設定またはlimiterがnull/undefinedの場合は常に成功
	if (!isRateLimitEnabled || !limiter) {
		return { success: true };
	}

	// userIdを getClientIdentifier に渡す（userId優先の識別子生成）
	const identifier = getClientIdentifier(request, userId);

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
							'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString()
						}
					}
				)
			};
		}

		return { success: true };
	} catch (error) {
		// Fail-open: Upstash/Redisの障害時でもリクエストを通す
		// これにより、レート制限サービスの障害がアプリケーション全体の停止を引き起こさない
		logger.error('[RateLimit] レート制限チェック失敗（Upstash障害の可能性）:', error);
		logger.error('[RateLimit] Fail-open: リクエストを許可します');

		// TODO: 本番環境では監視アラートを送信
		// 例: Sentry.captureException(error)

		return { success: true };
	}
}
