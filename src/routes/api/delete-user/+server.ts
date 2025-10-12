import { createClient } from '@supabase/supabase-js';
import { json, error as svelteError } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export async function POST({ request }) {
	// Initialize the Supabase Admin Client
	const supabaseUrl = env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!supabaseUrl || !serviceRoleKey) {
		throw svelteError(500, 'サーバー設定エラー: Supabase環境変数が設定されていません。');
	}

	const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

	const { userToken } = await request.json();
	if (!userToken) {
		throw svelteError(401, '認証トークンが必要です。');
	}

	// Get the user object from the provided token
	const {
		data: { user },
		error: userError
	} = await supabaseAdmin.auth.getUser(userToken);

	if (userError || !user) {
		throw svelteError(404, 'ユーザーが見つかりません。');
	}

	// Use the admin client to delete the user by their ID
	const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);

	if (deleteError) {
		console.error('Supabase delete user error:', deleteError.message);
		throw svelteError(500, 'アカウントの削除に失敗しました。');
	}

	return json({ success: true, message: 'アカウントが正常に削除されました。' });
}
