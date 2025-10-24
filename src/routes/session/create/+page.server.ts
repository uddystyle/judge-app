import { fail, redirect } from '@sveltejs/kit';
import type { Actions } from './$types';

// Helper function to generate a 6-digit random join code
const generateJoinCode = () => {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let code = '';
	for (let i = 0; i < 6; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
};

export const actions: Actions = {
	// This `create` function will be called when the form is submitted
	create: async ({ request, locals: { supabase } }) => {
		const {
			data: { user },
			error: userError
		} = await supabase.auth.getUser();

		if (userError || !user) {
			throw redirect(303, '/login');
		}

		const formData = await request.formData();
		const sessionName = formData.get('sessionName') as string;

		// Basic validation
		if (!sessionName || sessionName.trim().length === 0) {
			return fail(400, { sessionName, error: '検定名を入力してください。' });
		}

		const joinCode = generateJoinCode();

		// Insert the new session into the 'sessions' table
		const { data: sessionData, error: sessionError } = await supabase
			.from('sessions')
			.insert({
				name: sessionName,
				created_by: user.id,
				join_code: joinCode,
				is_active: true
			})
			.select()
			.single();

		if (sessionError) {
			return fail(500, {
				sessionName,
				error: 'サーバーエラー: 検定の作成に失敗しました。'
			});
		}

		// Automatically add the creator as a participant
		const { error: participantError } = await supabase.from('session_participants').insert({
			session_id: sessionData.id,
			user_id: user.id
		});

		if (participantError) {
			// In a real-world scenario, you might want to handle this more gracefully
			// (e.g., delete the session that was just created).
			return fail(500, {
				sessionName,
				error: 'サーバーエラー: 検定への参加に失敗しました。'
			});
		}

		// If successful, redirect the user back to the dashboard
		throw redirect(303, '/dashboard');
	}
};
