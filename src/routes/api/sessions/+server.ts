// src/routes/api/sessions/+server.ts
import { createClient } from '@supabase/supabase-js';
import { json } from '@sveltejs/kit';

// Vercelの環境変数から読み込む
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

// 6桁のランダムな参加コードを生成するヘルパー関数
const generateJoinCode = () => {
	// ... (元のコードと同じ) ...
};

export async function POST({ request }) {
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
