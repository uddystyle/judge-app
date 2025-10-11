<script lang="ts">
	import { getContext } from 'svelte'; // getContextをインポート
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { goto } from '$app/navigation';
	import NavButton from '$lib/components/NavButton.svelte';

	// レイアウトから共有されたSupabaseクライアントを受け取る
	const supabase = getContext<SupabaseClient>('supabase');

	let email = '';
	let password = '';
	let errorMessage = '';
	let loading = false;

	async function handleLogin() {
		// ... （この関数の中身は変更なし） ...
		loading = true;
		errorMessage = '';
		try {
			const { error } = await supabase.auth.signInWithPassword({
				email: email,
				password: password
			});

			if (error) {
				throw new Error('メールアドレスまたはパスワードが正しくありません。');
			}
			await goto('/dashboard');
		} catch (error: any) {
			errorMessage = error.message;
		} finally {
			loading = false;
		}
	}
</script>
