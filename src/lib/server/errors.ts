import { json } from '@sveltejs/kit';
import { logger } from './logger';

export class AppError extends Error {
	constructor(
		public statusCode: number,
		public userMessage: string,
		public internalMessage?: string,
		public code?: string
	) {
		super(internalMessage || userMessage);
		this.name = 'AppError';
	}
}

// 標準エラーレスポンス
export const ErrorResponses = {
	// 認証
	UNAUTHORIZED: new AppError(401, '認証が必要です', 'Unauthorized access attempt'),
	INVALID_CREDENTIALS: new AppError(401, '認証に失敗しました', 'Invalid credentials'),

	// 認可
	FORBIDDEN: new AppError(403, 'この操作を実行する権限がありません', 'Forbidden'),
	NOT_ORG_MEMBER: new AppError(403, '組織のメンバーではありません', 'Not an organization member'),
	NOT_ADMIN: new AppError(403, '管理者権限が必要です', 'Admin role required'),

	// Not Found - 列挙防止のため一般的なメッセージ
	RESOURCE_NOT_FOUND: new AppError(404, 'リソースが見つかりません', 'Resource not found'),
	SESSION_NOT_FOUND: new AppError(404, 'セッションが見つかりません', 'Session not found'),
	USER_NOT_FOUND: new AppError(404, 'ユーザーが見つかりません', 'User not found'),

	// バリデーション
	INVALID_INPUT: new AppError(400, '入力内容を確認してください', 'Invalid input'),
	MISSING_REQUIRED_FIELD: new AppError(400, '必須項目が不足しています', 'Missing required field'),

	// レート制限
	RATE_LIMIT_EXCEEDED: new AppError(429, 'リクエストが多すぎます。しばらくしてから再度お試しください', 'Rate limit exceeded'),

	// サーバーエラー - 内部詳細を公開しない
	INTERNAL_ERROR: new AppError(500, 'サーバーエラーが発生しました', 'Internal server error'),
	DATABASE_ERROR: new AppError(500, 'データベースエラーが発生しました', 'Database error'),
};

// エラーハンドラーミドルウェア
export function handleError(error: unknown, requestId?: string) {
	if (error instanceof AppError) {
		logger.error('API', error.internalMessage || error.userMessage, {
			code: error.code,
			requestId,
			statusCode: error.statusCode
		});

		return json(
			{
				error: error.userMessage,
				code: error.code,
			},
			{ status: error.statusCode }
		);
	}

	// 不明なエラー - 完全な詳細をログに記録するが一般的なメッセージを返す
	logger.error('API', 'Unexpected error', { error, requestId });

	return json(
		{ error: 'サーバーエラーが発生しました' },
		{ status: 500 }
	);
}
