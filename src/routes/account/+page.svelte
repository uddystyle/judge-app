<script lang="ts">
	import type { PageData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { goto } from '$app/navigation';
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { invalidateAll } from '$app/navigation';

	// サーバーから渡されたデータを受け取る
	export let data: PageData;
	// レイアウトから共有されたSupabaseクライアントを受け取る
	const supabase = getContext<SupabaseClient>('supabase');

	// フォームの入力値を保持する変数 (初期値としてサーバーから取得した氏名を設定)
	let fullName = '';
	let loading = false;
	let message = '';

	// ログアウト確認ダイアログの表示状態
	let showLogoutDialog = false;

	// dataが変更されたときにfullNameを更新
	$: {
		if (data.profile) {
			fullName = data.profile.full_name || '';
		} else {
			fullName = '';
		}
	}

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
			.eq('id', data.user.id);

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

	async function handleLogout() {
		showLogoutDialog = true;
	}

	async function confirmLogout() {
		await supabase.auth.signOut();
		goto('/login');
	}

	// Stripe Customer Portalを開く
	async function openCustomerPortal(organizationId: string) {
		portalLoading = true;
		try {
			const response = await fetch('/api/stripe/customer-portal', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					organizationId,
					returnUrl: window.location.href
				})
			});

			if (!response.ok) {
				throw new Error('Customer Portalの作成に失敗しました');
			}

			const data = await response.json();
			window.location.href = data.url;
		} catch (error) {
			console.error('Customer Portal Error:', error);
			alert('プラン管理画面の表示に失敗しました。');
		} finally {
			portalLoading = false;
		}
	}

	// プラン名の日本語表示
	function getPlanName(planType: string): string {
		switch (planType) {
			case 'free':
				return 'フリー';
			case 'basic':
				return 'Basic';
			case 'standard':
				return 'Standard';
			case 'premium':
				return 'Premium';
			default:
				return 'フリー';
		}
	}

	// プラン価格の表示
	function getPlanPrice(planType: string): string {
		switch (planType) {
			case 'free':
				return '無料';
			case 'basic':
				return '¥8,800/月';
			case 'standard':
				return '¥24,800/月';
			case 'premium':
				return '¥49,800/月';
			default:
				return '無料';
		}
	}

	// 日付のフォーマット
	function formatDate(dateString: string | null): string {
		if (!dateString) return '-';
		const date = new Date(dateString);
		return date.toLocaleDateString('ja-JP');
	}

	// 使用率の計算
	function getUsagePercentage(planLimits: any, currentUsage: any): number {
		if (!planLimits || !currentUsage) return 0;
		const limit = planLimits.max_sessions_per_month || 3;
		if (limit === -1) return 0; // 無制限の場合
		const count = currentUsage.sessions_count || 0;
		return Math.min((count / limit) * 100, 100);
	}

	// 使用状況の表示テキスト
	function getUsageText(planLimits: any, currentUsage: any): string {
		if (!planLimits || !currentUsage) return '-';
		const count = currentUsage.sessions_count || 0;
		const limit = planLimits.max_sessions_per_month || 3;
		if (limit === -1) return `${count} セッション`;
		return `${count} / ${limit} セッション`;
	}

	// メンバー使用状況の表示テキスト
	function getMembersUsageText(planLimits: any, currentUsage: any): string {
		if (!planLimits || !currentUsage) return '-';
		const count = currentUsage.members_count || 0;
		const limit = planLimits.max_organization_members || 1;
		if (limit === -1) return `${count} 人`;
		return `${count} / ${limit} 人`;
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

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={data.organizations && data.organizations.length > 0} pageOrganizations={data.organizations || []} />

<div class="container">
	<div class="instruction">アカウント設定</div>

	<!-- アカウント情報セクション -->
	<h2 class="section-title">アカウント情報</h2>
	<div class="info-card">
		<div class="info-row">
			<span class="info-label">メールアドレス</span>
			<span class="info-value">{data.user?.email || '-'}</span>
		</div>
	</div>

	<!-- プロフィール情報セクション -->
	<h2 class="section-title">プロフィール</h2>
	<div class="form-container">
		<label for="account-name" class="form-label">
			氏名
			{#if data.profile?.full_name}
				<span class="current-value">（現在: {data.profile.full_name}）</span>
			{/if}
		</label>
		<input
			type="text"
			id="account-name"
			placeholder="氏名を入力してください"
			bind:value={fullName}
		/>

		<div class="nav-buttons" style="margin-top: 0;">
			<NavButton variant="primary" on:click={handleUpdateName} disabled={loading}>
				{loading ? '更新中...' : '名前を更新'}
			</NavButton>
		</div>

		{#if message}
			<p class="message">{message}</p>
		{/if}
	</div>

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

		<NavButton on:click={() => goto('/dashboard')}>ダッシュボードに戻る</NavButton>
		<NavButton variant="danger" on:click={handleLogout}>ログアウト</NavButton>
		<NavButton variant="danger" on:click={() => goto('/account/delete')}>
			アカウントを削除
		</NavButton>
	</div>
</div>

<ConfirmDialog
	bind:isOpen={showLogoutDialog}
	title="ログアウト"
	message="ログアウトしますか？"
	confirmText="ログアウト"
	cancelText="キャンセル"
	on:confirm={confirmLogout}
/>

<Footer />

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
		margin-top: 40px;
		text-align: left;
		color: var(--primary-text);
	}
	.info-card {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 16px;
		padding: 20px;
		text-align: left;
		margin-bottom: 24px;
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		flex-wrap: wrap;
	}
	.info-label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-secondary);
	}
	.info-value {
		font-size: 15px;
		font-weight: 500;
		color: var(--text-primary);
		word-break: break-all;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 14px;
		text-align: left;
		margin-top: 20px;
	}
	.form-label {
		font-size: 15px;
		font-weight: 500;
	}
	.current-value {
		font-size: 13px;
		font-weight: 400;
		color: var(--text-secondary);
		margin-left: 8px;
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
		color: #dc3545;
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
		.section-title {
			margin-top: 48px;
		}
		.form-label {
			font-size: 18px;
		}
		.current-value {
			font-size: 15px;
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
