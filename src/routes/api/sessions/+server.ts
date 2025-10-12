// src/routes/api/sessions/+server.ts
import { createClient } from '@supabase/supabase-js';
import { json, error as svelteError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// 6桁のランダムな参加コードを生成するヘルパー関数
const generateJoinCode = () => {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let code = '';
	for (let i = 0; i < 6; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
};

export async function POST({ request }) {
	// Initialize Supabase client inside the request handler
	const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !serviceRoleKey) {
		throw svelteError(500, 'サーバー設定エラー: Supabase環境変数が設定されていません。');
	}

	const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

	const { sessionName, userToken } = await request.json();

	if (!sessionName || !userToken) {
		return json({ error: '必須データが不足しています。' }, { status: 400 });
	}

	// ユーザー情報をトークンから取得
	const {
		data: { user }
	} = await supabaseAdmin.auth.getUser(userToken);
	if (!user) {
		return json({ error: '認証されていません。' }, { status: 401 });
	}

	const joinCode = generateJoinCode();

	// sessionsテーブルに新しいセッションを作成
	const { data: sessionData, error: sessionError } = await supabaseAdmin
		.from('sessions')
		.insert({
			name: sessionName,
			created_by: user.id,
			join_code: joinCode
		})
		.select()
		.single();

	if (sessionError) {
		return json({ error: sessionError.message }, { status: 500 });
	}

	// 作成者を自動的に参加者として追加
	await supabaseAdmin.from('session_participants').insert({
		session_id: sessionData.id,
		user_id: user.id
	});

	return json(sessionData, { status: 200 });
}
