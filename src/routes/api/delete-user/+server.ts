import { createClient } from '@supabase/supabase-js';
import { json, error as svelteError } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_SERVICE_ROLE_KEY } from '$env/static/public';

export async function POST({ request }) {
	// Initialize the Supabase Admin Client
	const supabaseAdmin = createClient(PUBLIC_SUPABASE_URL!, PUBLIC_SUPABASE_SERVICE_ROLE_KEY!);

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
