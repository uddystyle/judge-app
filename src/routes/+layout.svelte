<script lang="ts">
	import { setContext } from 'svelte';
	import { createBrowserClient } from '@supabase/ssr';
	import type { LayoutData } from './$types';
	import '../app.css';

	export let data: LayoutData;

	// サーバーから渡されたURLとキーを使って、ブラウザ用のSupabaseクライアントを作成
	const supabase = createBrowserClient(data.supabaseUrl, data.supabaseAnonKey);

	// 作成したクライアントを、SvelteのContext APIを使って
	// アプリ内の全コンポーネントで利用できるように共有する
	setContext('supabase', supabase);
</script>

<slot />
