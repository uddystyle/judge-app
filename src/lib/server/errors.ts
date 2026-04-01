import { json } from '@sveltejs/kit';
import { logger } from './logger';
import * as m from '$lib/paraglide/messages.js';

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

// 標準エラーレスポンス（リクエストのlocaleに応じたメッセージを返す）
export const ErrorResponses = {
	// 認証
	UNAUTHORIZED: () => new AppError(401, m.error_unauthorized(), 'Unauthorized access attempt'),
	INVALID_CREDENTIALS: () => new AppError(401, m.error_invalidCredentials(), 'Invalid credentials'),

	// 認可
	FORBIDDEN: () => new AppError(403, m.error_forbidden(), 'Forbidden'),
	NOT_ORG_MEMBER: () => new AppError(403, m.error_notOrgMember(), 'Not an organization member'),
	NOT_ADMIN: () => new AppError(403, m.error_notAdmin(), 'Admin role required'),

	// Not Found - 列挙防止のため一般的なメッセージ
	RESOURCE_NOT_FOUND: () => new AppError(404, m.error_resourceNotFound(), 'Resource not found'),
	SESSION_NOT_FOUND: () => new AppError(404, m.error_sessionNotFound(), 'Session not found'),
	USER_NOT_FOUND: () => new AppError(404, m.error_userNotFound(), 'User not found'),

	// バリデーション
	INVALID_INPUT: () => new AppError(400, m.error_invalidInput(), 'Invalid input'),
	MISSING_REQUIRED_FIELD: () => new AppError(400, m.error_missingRequiredField(), 'Missing required field'),

	// レート制限
	RATE_LIMIT_EXCEEDED: () => new AppError(429, m.error_rateLimitExceeded(), 'Rate limit exceeded'),

	// サーバーエラー - 内部詳細を公開しない
	INTERNAL_ERROR: () => new AppError(500, m.error_internalError(), 'Internal server error'),
	DATABASE_ERROR: () => new AppError(500, m.error_databaseError(), 'Database error'),
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
		{ error: m.error_internalError() },
		{ status: 500 }
	);
}
