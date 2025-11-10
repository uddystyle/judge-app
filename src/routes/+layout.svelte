<script lang="ts">
	import { setContext, onMount } from 'svelte';
	import { createBrowserClient, isBrowser } from '@supabase/ssr';
	import { invalidateAll } from '$app/navigation';
	import { navigating } from '$app/stores';
	import type { LayoutData } from './$types';
	import '../app.css';
	import { userProfile } from '$lib/stores';

	export let data: LayoutData;
	$: ({ profile } = data);

	$: if (profile) {
		userProfile.set(profile);
	}

	// サーバーから渡されたURLとキーを使って、ブラウザ用のSupabaseクライアントを作成
	const supabase = createBrowserClient(data.supabaseUrl, data.supabaseAnonKey);

	// 作成したクライアントを、SvelteのContext APIを使って
	// アプリ内の全コンポーネントで利用できるように共有する
	setContext('supabase', supabase);

	// サーバーからのセッション情報と、クライアントの認証状態を同期させる
	onMount(() => {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event, _session) => {
			// 認証状態が変更されたら、サーバー側のデータを再読み込みして同期する
			// onAuthStateChangeから返されるsessionパラメータは使用しない（セキュリティ警告を回避）
			if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
				invalidateAll();
			}
		});

		return () => {
			subscription.unsubscribe();
		};
	});
</script>

<!-- ページ遷移中のローディングインジケーター -->
{#if $navigating}
	<div class="loading-bar">
		<div class="loading-bar-progress"></div>
	</div>
{/if}

<slot />

<style>
	.loading-bar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: rgba(0, 122, 255, 0.1);
		z-index: 9999;
		overflow: hidden;
	}

	.loading-bar-progress {
		height: 100%;
		background: var(--ios-blue, #007aff);
		animation: loading 1s ease-in-out infinite;
		transform-origin: left;
	}

	@keyframes loading {
		0% {
			transform: translateX(-100%) scaleX(0.3);
		}
		50% {
			transform: translateX(0%) scaleX(0.5);
		}
		100% {
			transform: translateX(100%) scaleX(0.3);
		}
	}
</style>
