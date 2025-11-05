<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
	// レイアウトから共有されたSupabaseクライアントを受け取る
	const supabase = getContext<SupabaseClient>('supabase');

	// フォームの入力値を保持する変数 (初期値としてサーバーから取得した氏名を設定)
	let fullName = data.profile?.full_name || '';
	let loading = false;
	let message = '';

	let newPassword = '';
	let confirmPassword = '';
	let passwordLoading = false;
	let passwordMessage = '';

	let portalLoading = false;

	// 「名前を更新」ボタンが押されたときの処理
	async function handleUpdateName() {
		if (!data.user) {
			message = 'エラー: ユーザー情報が見つかりません。';
			return;
		}
		loading = true;
		message = '';

		// profilesテーブルのfull_nameを更新
		const { error } = await supabase
			.from('profiles')
			.update({ full_name: fullName })
			.eq('id', data.user.id); // +layout.server.tsから渡されたユーザー情報を使う

		if (error) {
			message = 'エラー: 名前の更新に失敗しました。' + error.message;
		} else {
			message = '名前を更新しました。';
			await invalidateAll();
		}
		loading = false;
	}

	async function handleUpdatePassword() {
		// Basic validation
		if (newPassword.length < 6) {
			passwordMessage = 'エラー: パスワードは6文字以上で入力してください。';
			return;
		}
		if (newPassword !== confirmPassword) {
			passwordMessage = 'エラー: パスワードが一致しません。';
			return;
		}

		passwordLoading = true;
		passwordMessage = '';

		// Update the user's password in Supabase Auth
		const { error } = await supabase.auth.updateUser({
			password: newPassword
		});

		if (error) {
			passwordMessage = 'エラー: パスワードの更新に失敗しました。' + error.message;
		} else {
			passwordMessage = 'パスワードを更新しました。';
			// Clear input fields on success
			newPassword = '';
			confirmPassword = '';
		}
		passwordLoading = false;
	}

	async function handleManageBilling() {
		portalLoading = true;

		try {
			// Customer Portal Session作成APIを呼び出し
			const response = await fetch('/api/stripe/create-portal-session', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					returnUrl: window.location.href
				})
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.message || 'エラーが発生しました');
			}

			// Stripe Customer Portalページにリダイレクト
			window.location.href = result.url;
		} catch (err: any) {
			console.error('Portal error:', err);
			alert('エラーが発生しました。もう一度お試しください。');
			portalLoading = false;
		}
	}

	async function handleLogout() {
		// Supabaseからログアウトを実行
		await supabase.auth.signOut();

		// ログアウト後、ログインページへ移動
		goto('/login');
	}

	// プラン名の日本語表示
	function getPlanName(planType: string): string {
		switch (planType) {
			case 'free':
				return 'フリープラン';
			case 'standard':
				return 'スタンダードプラン';
			case 'pro':
				return 'プロプラン';
			default:
				return 'フリープラン';
		}
	}

	// 請求間隔の日本語表示
	function getBillingIntervalName(interval: string): string {
		return interval === 'month' ? '月額' : '年額';
	}

	// 日付のフォーマット
	function formatDate(dateString: string | null): string {
		if (!dateString) return '-';
		const date = new Date(dateString);
		return date.toLocaleDateString('ja-JP');
	}

	// 使用率の計算
	function getUsagePercentage(): number {
		const limit = data.planLimits?.max_sessions_per_month || 3;
		if (limit === -1) return 0; // 無制限の場合
		const count = data.currentUsage?.sessions_count || 0;
		return Math.min((count / limit) * 100, 100);
	}

	// 使用状況の表示テキスト
	function getUsageText(): string {
		const count = data.currentUsage?.sessions_count || 0;
		const limit = data.planLimits?.max_sessions_per_month || 3;
		if (limit === -1) return `${count} セッション`;
		return `${count} / ${limit} セッション`;
	}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<Header showAppName={true} pageUser={data.user} />

<div class="container">
	<div class="instruction">アカウント設定</div>

	<!-- サブスクリプション情報セクション -->
	<div class="subscription-section">
		<h2 class="section-title">プラン・使用状況</h2>

		<div class="subscription-card">
			<div class="plan-info">
				<div class="plan-name-row">
					<span class="plan-name">{getPlanName(data.subscription.plan_type)}</span>
					{#if data.subscription.plan_type !== 'free'}
						<span class="billing-interval">
							({getBillingIntervalName(data.subscription.billing_interval)})
						</span>
					{/if}
				</div>

				{#if data.subscription.plan_type !== 'free' && data.subscription.current_period_end}
					<div class="renewal-date">
						次回更新日: {formatDate(data.subscription.current_period_end)}
					</div>
				{/if}

				{#if data.subscription.cancel_at_period_end}
					<div class="cancel-notice">
						このサブスクリプションは期間終了時にキャンセルされます
					</div>
				{/if}
			</div>

			<div class="usage-info">
				<h3 class="usage-title">今月の使用状況</h3>
				<div class="usage-bar-container">
					<div class="usage-bar">
						<div
							class="usage-bar-fill"
							style="width: {getUsagePercentage()}%"
							class:warning={getUsagePercentage() > 80}
						></div>
					</div>
					<div class="usage-text">{getUsageText()}</div>
				</div>
			</div>

			<div class="subscription-actions">
				{#if data.subscription.plan_type === 'free'}
					<NavButton variant="primary" on:click={() => goto('/pricing')}>
						プランをアップグレード
					</NavButton>
				{:else}
					<NavButton on:click={handleManageBilling} disabled={portalLoading}>
						{portalLoading ? '処理中...' : 'プラン・支払い方法を管理'}
					</NavButton>
				{/if}
				<NavButton on:click={() => goto('/pricing')}>料金プランを見る</NavButton>
			</div>
		</div>
	</div>

	<hr class="divider" />

	<!-- プロフィール情報セクション -->
	<h2 class="section-title">プロフィール</h2>
	<div class="form-container">
		<label for="account-name" class="form-label">氏名</label>
		<input type="text" id="account-name" placeholder="氏名" bind:value={fullName} />

		<div class="nav-buttons" style="margin-top: 0;">
			<NavButton variant="primary" on:click={handleUpdateName} disabled={loading}>
				{loading ? '更新中...' : '名前を更新'}
			</NavButton>
		</div>

		{#if message}
			<p class="message">{message}</p>
		{/if}
	</div>

	<hr class="divider" />

	<div class="form-container">
		<label for="account-password" class="form-label">新しいパスワード</label>
		<input
			type="password"
			id="account-password"
			placeholder="新しいパスワード (6文字以上)"
			bind:value={newPassword}
		/>
		<input
			type="password"
			id="account-password-confirm"
			placeholder="新しいパスワード (確認)"
			bind:value={confirmPassword}
		/>
		<div class="nav-buttons" style="margin-top: 0;">
			<NavButton variant="primary" on:click={handleUpdatePassword} disabled={passwordLoading}>
				{passwordLoading ? '更新中...' : 'パスワードを更新'}
			</NavButton>
		</div>
		{#if passwordMessage}
			<p class="message">{passwordMessage}</p>
		{/if}
	</div>

	<div class="nav-buttons">
		<hr class="divider" />

		<NavButton on:click={() => goto('/dashboard')}>セッション選択画面に戻る</NavButton>
		<NavButton variant="danger" on:click={handleLogout}>ログアウト</NavButton>
		<NavButton variant="danger" on:click={() => goto('/account/delete')}>
			アカウントを削除
		</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 600px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
	}
	.section-title {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 16px;
		text-align: left;
		color: var(--primary-text);
	}
	.subscription-section {
		margin-bottom: 24px;
	}
	.subscription-card {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 16px;
		padding: 24px;
		text-align: left;
	}
	.plan-info {
		margin-bottom: 24px;
		padding-bottom: 24px;
		border-bottom: 1px solid var(--separator-gray);
	}
	.plan-name-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.plan-name {
		font-size: 20px;
		font-weight: 700;
		color: var(--ios-blue);
	}
	.billing-interval {
		font-size: 14px;
		color: var(--secondary-text);
	}
	.renewal-date {
		font-size: 14px;
		color: var(--secondary-text);
		margin-top: 8px;
	}
	.cancel-notice {
		font-size: 14px;
		color: var(--ios-red);
		margin-top: 8px;
		font-weight: 600;
	}
	.usage-info {
		margin-bottom: 24px;
	}
	.usage-title {
		font-size: 16px;
		font-weight: 600;
		margin-bottom: 12px;
		color: var(--primary-text);
	}
	.usage-bar-container {
		width: 100%;
	}
	.usage-bar {
		width: 100%;
		height: 8px;
		background: #f0f0f0;
		border-radius: 4px;
		overflow: hidden;
		margin-bottom: 8px;
	}
	.usage-bar-fill {
		height: 100%;
		background: var(--ios-blue);
		transition: width 0.3s ease;
	}
	.usage-bar-fill.warning {
		background: var(--primary-orange);
	}
	.usage-text {
		font-size: 14px;
		color: var(--primary-text);
		font-weight: 600;
	}
	.subscription-actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 14px;
		text-align: left;
	}
	.form-label {
		font-size: 15px;
		font-weight: 500;
	}
	.form-container input {
		background: #fff;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		padding: 15px;
		font-size: 16px;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.message {
		text-align: center;
		margin-top: 1rem;
		color: var(--ios-red);
	}
	.divider {
		border: none;
		border: 1px solid var(--separator-gray);
		margin: 24px 0;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 600px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.form-label {
			font-size: 18px;
		}
		.form-container input {
			padding: 18px;
			font-size: 18px;
		}
		.message {
			font-size: 16px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
