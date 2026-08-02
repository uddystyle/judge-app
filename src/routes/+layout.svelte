<script lang="ts">
	import { setContext, onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { navigating } from '$app/stores';
	import { supabase } from '$lib/supabaseClient';
	import { startOfflineSync } from '$lib/offline/syncStatus';
	import { setCurrentSyncIdentity } from '$lib/offline/scoreQueue';
	import '../app.css';

	// ブラウザ用Supabaseクライアントは $lib/supabaseClient の1箇所でのみ生成する
	// （@supabase/ssr の createBrowserClient はブラウザではシングルトンを返すため、
	//   生成箇所を分散させると同一インスタンスでも構造が分かりにくくなる）
	// SvelteのContext APIでアプリ内の全コンポーネントに共有する
	setContext('supabase', supabase);

	// ページ遷移時に自動的にページトップにスクロール
	$: if ($navigating) {
		// 遷移開始時は何もしない（ローディングバーを表示）
	} else {
		// 遷移完了時にページトップにスクロール
		if (typeof window !== 'undefined') {
			window.scrollTo(0, 0);
		}
	}

	// オフライン採点の自動同期をアプリ全体で常駐させる。
	// 採点画面を離れた後（status/complete/ダッシュボード等）に回線が復帰しても
	// pending の採点が送信されるようにする（バッジ表示は採点画面のみ）
	onMount(() => {
		let stopSync: (() => void) | null = null;
		let cancelled = false;

		async function updateIdentityAndStartSync() {
			const {
				data: { user }
			} = await supabase.auth.getUser();
			if (cancelled) return;
			const guestIdentifier =
				user?.user_metadata?.is_guest === true &&
				typeof user.user_metadata.guest_identifier === 'string'
					? user.user_metadata.guest_identifier
					: null;
			setCurrentSyncIdentity(
				guestIdentifier
					? { owner_type: 'guest', judge_id: null, guest_identifier: guestIdentifier }
					: user?.id
						? { owner_type: 'auth', judge_id: user.id, guest_identifier: null }
						: null
			);
			stopSync ??= startOfflineSync();
		}

		void updateIdentityAndStartSync();
		return () => {
			cancelled = true;
			stopSync?.();
		};
	});

	// サーバーからのセッション情報と、クライアントの認証状態を同期させる
	onMount(() => {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((event, _session) => {
			// 認証状態が変更されたら、サーバー側のデータを再読み込みして同期する
			// onAuthStateChangeから返されるsessionパラメータは使用しない（セキュリティ警告を回避）

			// ゲストユーザーの場合はSIGNED_OUTイベントを無視
			const isGuestUser =
				typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('guest');

			if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
				const guestIdentifier =
					_session?.user?.user_metadata?.is_guest === true &&
					typeof _session.user.user_metadata.guest_identifier === 'string'
						? _session.user.user_metadata.guest_identifier
						: null;
				setCurrentSyncIdentity(
					guestIdentifier
						? { owner_type: 'guest', judge_id: null, guest_identifier: guestIdentifier }
						: _session?.user?.id
							? { owner_type: 'auth', judge_id: _session.user.id, guest_identifier: null }
							: null
				);
				invalidateAll();
			} else if (event === 'SIGNED_OUT' && !isGuestUser) {
				setCurrentSyncIdentity(null);
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
