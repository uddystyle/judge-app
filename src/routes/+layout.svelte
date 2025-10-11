<script lang="ts">
	import { setContext, onMount } from 'svelte';
	import { createBrowserClient, isBrowser } from '@supabase/ssr';
	import { invalidateAll } from '$app/navigation';
	import type { LayoutData } from './$types';
	import '../app.css';

	export let data: LayoutData;

	// サーバーから渡されたURLとキーを使って、ブラウザ用のSupabaseクライアントを作成
	const supabase = createBrowserClient(data.supabaseUrl, data.supabaseAnonKey);

	// 作成したクライアントを、SvelteのContext APIを使って
	// アプリ内の全コンポーネントで利用できるように共有する
	setContext('supabase', supabase);

	// サーバーからのセッション情報と、クライアントの認証状態を同期させる
	onMount(() => {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event, session) => {
			// この処理がブラウザでのみ実行されることを保証
			if (isBrowser() && session?.expires_at !== data.session?.expires_at) {
				// サーバー側のセッション情報と異なっていたら、全データを再読み込み
				invalidateAll();
			}
		});

		return () => {
			subscription.unsubscribe();
		};
	});
</script>

<slot />
