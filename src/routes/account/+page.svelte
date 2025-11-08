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
	let fullName = '';
	let loading = false;
	let message = '';

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
		// Supabaseからログアウトを実行
		await supabase.auth.signOut();

		// ログアウト後、ログインページへ移動
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

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} />

<div class="container">
	<div class="instruction">アカウント設定</div>

	<!-- 組織・プラン情報セクション -->
	<div class="subscription-section">
		<h2 class="section-title">組織・プラン情報</h2>

		{#if !data.organizations || data.organizations.length === 0}
			<!-- 組織未作成の場合 -->
			<div class="no-organization-card">
				<div class="warning-icon">⚠️</div>
				<h3 class="warning-title">組織が作成されていません</h3>
				<p class="warning-message">
					TENTOでは、すべてのセッションは組織に属します。<br />
					まずは組織を作成してください。
				</p>
				<div class="subscription-actions">
					<NavButton variant="primary" on:click={() => goto('/onboarding/create-organization')}>
						組織を作成する
					</NavButton>
				</div>
			</div>
		{:else}
			<!-- 複数組織を表示 -->
			{#each data.organizations as org}
				<div class="subscription-card">
					<div class="organization-info">
						<h3 class="org-name">{org.name}</h3>
						<div class="org-details">
							<span class="org-role" class:admin={org.userRole === 'admin'}>
								{org.userRole === 'admin' ? '管理者' : 'メンバー'}
							</span>
							<span class="org-date">作成日: {formatDate(org.created_at)}</span>
						</div>
					</div>

					<div class="plan-info">
						<div class="plan-name-row">
							<span class="plan-name">{getPlanName(org.plan_type)}プラン</span>
							<span class="plan-price">{getPlanPrice(org.plan_type)}</span>
						</div>
					</div>

					<div class="usage-info">
						<h3 class="usage-title">今月の使用状況</h3>

						<div class="usage-item">
							<span class="usage-label">セッション作成:</span>
							<div class="usage-bar-container">
								<div class="usage-bar">
									<div
										class="usage-bar-fill"
										style="width: {getUsagePercentage(org.planLimits, org.currentUsage)}%"
										class:warning={getUsagePercentage(org.planLimits, org.currentUsage) > 80}
									></div>
								</div>
								<div class="usage-text">{getUsageText(org.planLimits, org.currentUsage)}</div>
							</div>
						</div>

						<div class="usage-item">
							<span class="usage-label">組織メンバー:</span>
							<div class="usage-text-only">
								{getMembersUsageText(org.planLimits, org.currentUsage)}
							</div>
						</div>
					</div>

					<div class="subscription-actions">
						<NavButton on:click={() => goto(`/organization/${org.id}`)}>
							組織詳細を見る
						</NavButton>
						{#if org.userRole === 'admin'}
							{#if org.plan_type === 'free'}
								<NavButton variant="primary" on:click={() => goto(`/organization/${org.id}/upgrade`)}>
									プランをアップグレード
								</NavButton>
							{:else}
								<NavButton
									variant="primary"
									on:click={() => openCustomerPortal(org.id)}
									disabled={portalLoading}
								>
									{portalLoading ? '読み込み中...' : 'プランを管理'}
								</NavButton>
							{/if}
						{/if}
					</div>
				</div>
			{/each}

			<!-- 新しい組織を作成 -->
			<div class="create-org-card">
				<p class="create-org-text">複数の組織を作成・管理できます</p>
				<NavButton variant="primary" on:click={() => goto('/onboarding/create-organization')}>
					新しい組織を作成
				</NavButton>
			</div>
		{/if}
	</div>

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
	.subscription-section {
		margin-bottom: 24px;
	}
	.subscription-section .section-title {
		margin-top: 0;
	}
	.subscription-card {
		background: white;
		border: 2px solid var(--separator-gray);
		border-radius: 16px;
		padding: 24px;
		text-align: left;
		margin-bottom: 16px;
	}
	.no-organization-card {
		background: #fff8e1;
		border: 2px solid #ff9800;
		border-radius: 16px;
		padding: 32px 24px;
		text-align: center;
	}
	.warning-icon {
		font-size: 48px;
		margin-bottom: 16px;
	}
	.warning-title {
		font-size: 20px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 12px;
	}
	.warning-message {
		font-size: 15px;
		color: var(--secondary-text);
		line-height: 1.6;
		margin-bottom: 24px;
	}
	.organization-info {
		margin-bottom: 20px;
		padding-bottom: 20px;
		border-bottom: 1px solid var(--separator-gray);
	}
	.org-name {
		font-size: 22px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 8px;
	}
	.org-details {
		display: flex;
		gap: 16px;
		font-size: 14px;
		color: var(--secondary-text);
		flex-wrap: wrap;
	}
	.org-role {
		padding: 4px 12px;
		background: var(--ios-blue);
		color: white;
		border-radius: 12px;
		font-weight: 600;
		font-size: 13px;
	}
	.org-role.admin {
		background: var(--primary-orange);
	}
	.org-date {
		display: flex;
		align-items: center;
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
	.plan-price {
		font-size: 16px;
		font-weight: 600;
		color: var(--primary-orange);
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
	.usage-item {
		margin-bottom: 16px;
	}
	.usage-label {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: var(--primary-text);
		margin-bottom: 8px;
	}
	.usage-text-only {
		font-size: 16px;
		font-weight: 600;
		color: var(--ios-blue);
	}
	.subscription-actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.create-org-card {
		background: var(--bg-beige);
		border: 2px dashed var(--separator-gray);
		border-radius: 16px;
		padding: 24px;
		text-align: center;
	}
	.create-org-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin-bottom: 16px;
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
		.section-title {
			margin-top: 48px;
		}
		.subscription-section .section-title {
			margin-top: 0;
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
