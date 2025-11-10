<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import type { PageData, ActionData } from './$types';

	export let data: PageData;
	export let form: ActionData;

	const isAdmin = data.userRole === 'admin';

	// 組織名編集用の状態
	let isEditingName = false;
	let editedName = data.organization.name;
	let isSubmittingName = false;

	function startEditingName() {
		if (!isAdmin) return;
		isEditingName = true;
		editedName = data.organization.name;
	}

	function cancelEditingName() {
		isEditingName = false;
		editedName = data.organization.name;
	}

	// プラン名のマッピング
	const planNames: Record<string, string> = {
		free: 'フリー',
		basic: 'Basic',
		standard: 'Standard',
		premium: 'Premium'
	};

	// 役割名のマッピング
	const roleNames: Record<string, string> = {
		admin: '管理者',
		member: 'メンバー'
	};

	function formatDate(dateString: string) {
		const date = new Date(dateString);
		return date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	let showInviteSection = false;
	let generatingInvite = false;
	let inviteUrl = '';
	let copiedInvite = false;

	function toggleInviteSection() {
		showInviteSection = !showInviteSection;
		if (!showInviteSection) {
			inviteUrl = '';
		}
	}

	async function generateInvite() {
		generatingInvite = true;

		try {
			const response = await fetch('/api/invitations/create', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					organizationId: data.organization.id,
					role: 'member',
					expiresInHours: 48
				})
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || 'エラーが発生しました');
			}

			// 招待URLを生成
			inviteUrl = `${window.location.origin}/invite/${result.invitation.token}`;
		} catch (err: any) {
			alert(err.message || 'エラーが発生しました');
		} finally {
			generatingInvite = false;
		}
	}

	function copyInviteUrl() {
		navigator.clipboard.writeText(inviteUrl).then(
			() => {
				copiedInvite = true;
				setTimeout(() => {
					copiedInvite = false;
				}, 2000);
			},
			(err) => {
				console.error('コピーに失敗しました:', err);
				alert('コピーに失敗しました');
			}
		);
	}
</script>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} hasOrganization={true} pageOrganizations={[data.organization]} />

<div class="container">
	<div class="page-header">
		{#if form?.success}
			<div class="success-notification">{form.message}</div>
		{/if}
		{#if form?.error}
			<div class="error-notification">{form.error}</div>
		{/if}

		{#if isEditingName}
			<!-- 編集モード -->
			<form
				method="POST"
				action="?/updateName"
				class="name-edit-form"
				use:enhance={() => {
					isSubmittingName = true;
					return async ({ update, result }) => {
						await update();
						isSubmittingName = false;
						if (result.type === 'success') {
							isEditingName = false;
						}
					};
				}}
			>
				<input
					type="text"
					name="name"
					bind:value={editedName}
					class="name-input"
					placeholder="組織名を入力"
					required
					minlength="2"
					maxlength="100"
					disabled={isSubmittingName}
				/>
				<div class="name-edit-buttons">
					<button type="submit" class="save-btn" disabled={isSubmittingName}>
						{isSubmittingName ? '保存中...' : '保存'}
					</button>
					<button type="button" class="cancel-btn" on:click={cancelEditingName} disabled={isSubmittingName}>
						キャンセル
					</button>
				</div>
			</form>
		{:else}
			<!-- 表示モード -->
			<div class="name-display">
				<h1 class="page-title">{data.organization.name}</h1>
				{#if isAdmin}
					<button class="edit-name-btn" on:click={startEditingName} title="組織名を編集">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
							<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
						</svg>
					</button>
				{/if}
			</div>
		{/if}

		<div class="plan-info">
			<span class="plan-badge">{planNames[data.organization.plan_type] || 'フリー'}</span>
			<span class="member-limit">
				{#if data.organization.max_members === -1}
					メンバー: 無制限
				{:else}
					メンバー: {data.organization.max_members}名まで
				{/if}
			</span>
		</div>
	</div>

	<!-- 組織情報セクション -->
	<div class="section">
		<h2 class="section-title">組織情報</h2>
		<div class="info-card">
			<div class="info-row">
				<span class="info-label">作成日</span>
				<span class="info-value">{formatDate(data.organization.created_at)}</span>
			</div>
			<div class="info-row">
				<span class="info-label">プラン</span>
				<span class="info-value">{planNames[data.organization.plan_type] || 'フリー'}</span>
			</div>
			<div class="info-row">
				<span class="info-label">現在のメンバー数</span>
				<span class="info-value">{data.members.length}名</span>
			</div>
			{#if isAdmin}
				<div class="info-row">
					<span class="info-label">あなたの役割</span>
					<span class="info-value admin-badge">管理者</span>
				</div>
			{:else}
				<div class="info-row">
					<span class="info-label">あなたの役割</span>
					<span class="info-value">メンバー</span>
				</div>
			{/if}
		</div>
	</div>

	<hr class="divider" />

	<!-- メンバー一覧セクション -->
	<div class="section">
		<h2 class="section-title">メンバー一覧</h2>
		<div class="members-list">
			{#each data.members as member}
				<div class="member-card">
					<div class="member-info">
						<div class="member-name">{member.profiles?.full_name || '名前未設定'}</div>
						<span class="role-badge" class:admin={member.role === 'admin'}>
							{roleNames[member.role]}
						</span>
					</div>
					<div class="member-meta">
						<span class="joined-date">参加: {formatDate(member.joined_at)}</span>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<hr class="divider" />

	<!-- 管理者向け招待セクション -->
	{#if isAdmin}
		<div class="section">
			<h2 class="section-title">メンバーの招待</h2>
			<div class="nav-buttons">
				<NavButton variant="primary" on:click={toggleInviteSection}>
					{showInviteSection ? '招待セクションを閉じる' : 'メンバーを招待'}
				</NavButton>
			</div>

			{#if showInviteSection}
				<div class="invite-section">
					{#if !inviteUrl}
						<p class="help-text">
							招待URLを生成して、メンバーを組織に招待できます。<br />
							招待URLの有効期限は48時間です。
						</p>
						<div class="nav-buttons" style="margin-top: 20px;">
							<NavButton on:click={generateInvite} disabled={generatingInvite}>
								{generatingInvite ? '生成中...' : '招待URLを生成'}
							</NavButton>
						</div>
					{:else}
						<p class="help-text">招待URLが生成されました。下記のURLをコピーして共有してください。</p>
						<div class="invite-url-container">
							<input type="text" class="invite-url-input" value={inviteUrl} readonly />
							<button class="copy-invite-btn" on:click={copyInviteUrl}>
								{copiedInvite ? '✓ コピー済' : 'コピー'}
							</button>
						</div>
						<p class="expire-text">有効期限: 48時間</p>
					{/if}
				</div>
			{/if}
		</div>

		<hr class="divider" />
	{/if}

	<!-- 管理者向け削除セクション -->
	{#if isAdmin}
		<div class="section">
			<h2 class="section-title danger-title">危険なゾーン</h2>
			<div class="danger-section">
				<p class="danger-text">
					組織を削除すると、すべてのデータが失われます。この操作は取り消せません。
				</p>
				<div class="nav-buttons" style="margin-top: 16px;">
					<button class="danger-btn" on:click={() => goto(`/organization/${data.organization.id}/delete`)}>
						組織を削除
					</button>
				</div>
			</div>
		</div>

		<hr class="divider" />
	{/if}

	<!-- ナビゲーションボタン -->
	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>ダッシュボードに戻る</NavButton>
	</div>
</div>

<Footer />

<style>
	.container {
		padding: 50px 20px 60px;
		max-width: 900px;
		margin: 0 auto;
		min-height: calc(100vh - 80px);
	}
	.page-header {
		margin-bottom: 40px;
	}
	.page-title {
		font-size: 32px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}
	.plan-info {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 16px;
		flex-wrap: wrap;
		margin-top: 16px;
	}
	.plan-badge {
		background: var(--accent-primary);
		color: white;
		padding: 8px 16px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
	}
	.member-limit {
		font-size: 16px;
		color: var(--text-secondary);
		font-weight: 500;
	}
	.section {
		margin-bottom: 40px;
	}
	.section-title {
		font-size: 20px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 20px;
	}
	.info-card {
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 16px;
		padding: 24px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
	}
	.info-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--separator-gray);
	}
	.info-row:last-child {
		border-bottom: none;
	}
	.info-label {
		font-size: 14px;
		color: var(--text-secondary);
		font-weight: 500;
	}
	.info-value {
		font-size: 16px;
		color: var(--text-primary);
		font-weight: 600;
	}
	.admin-badge {
		background: var(--accent-primary);
		color: white;
		padding: 4px 12px;
		border-radius: 6px;
		font-size: 14px;
	}
	.members-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.member-card {
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 12px;
		padding: 16px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
		transition: all 0.2s;
	}
	.member-card:hover {
		border-color: var(--accent-primary);
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.15);
	}
	.member-info {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.member-name {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.member-meta {
		display: flex;
		align-items: center;
	}
	.role-badge {
		background: var(--ios-blue);
		color: white;
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}
	.role-badge.admin {
		background: var(--accent-primary);
	}
	.joined-date {
		font-size: 11px;
		color: var(--text-muted);
	}
	.invite-section {
		margin-top: 20px;
		padding: 24px;
		background: var(--bg-secondary);
		border-radius: 12px;
		border: 2px solid var(--border-light);
	}
	.help-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin: 0;
		text-align: center;
		line-height: 1.6;
	}
	.invite-url-container {
		display: flex;
		gap: 8px;
		margin: 20px 0;
	}
	.invite-url-input {
		flex: 1;
		padding: 12px;
		font-size: 14px;
		border: 2px solid var(--border-light);
		border-radius: 8px;
		background: white;
		color: var(--text-primary);
		font-family: monospace;
	}
	.copy-invite-btn {
		padding: 12px 20px;
		font-size: 14px;
		font-weight: 600;
		background: var(--ios-blue);
		color: white;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}
	.copy-invite-btn:hover {
		background: #0051d5;
		box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
	}
	.copy-invite-btn:active {
		transform: scale(0.98);
	}
	.expire-text {
		font-size: 12px;
		color: var(--text-muted);
		text-align: center;
		margin: 8px 0 0 0;
	}
	.divider {
		border: none;
		border-top: 1px solid var(--separator-gray);
		margin: 32px 0;
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 500px;
		margin: 0 auto;
	}
	.danger-title {
		color: #dc3545;
	}
	.danger-section {
		background: #fff5f5;
		border: 2px solid #dc3545;
		border-radius: 12px;
		padding: 24px;
		text-align: center;
	}
	.danger-text {
		font-size: 14px;
		color: var(--text-secondary);
		margin: 0;
		line-height: 1.6;
	}
	.danger-btn {
		width: 100%;
		background: #dc3545;
		color: white;
		border: none;
		border-radius: 12px;
		padding: 14px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.danger-btn:hover {
		background: #d32f2f;
		box-shadow: 0 4px 16px rgba(255, 59, 48, 0.3);
	}
	.danger-btn:active {
		transform: scale(0.98);
	}

	/* 組織名インライン編集用スタイル */
	.name-display {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.edit-name-btn {
		background: transparent;
		border: none;
		color: var(--ios-blue);
		padding: 8px;
		border-radius: 6px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
		opacity: 0.7;
	}

	.edit-name-btn:hover {
		opacity: 1;
		background: rgba(0, 122, 255, 0.1);
	}

	.name-edit-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		width: 100%;
		max-width: 500px;
		margin-bottom: 16px;
	}

	.name-input {
		width: 100%;
		padding: 12px 16px;
		border: 2px solid var(--separator-gray);
		border-radius: 10px;
		font-size: 24px;
		font-weight: 700;
		font-family: inherit;
		background: white;
		transition: all 0.2s;
	}

	.name-input:focus {
		outline: none;
		border-color: var(--ios-blue);
	}

	.name-input:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.name-edit-buttons {
		display: flex;
		gap: 8px;
	}

	.save-btn {
		padding: 10px 20px;
		background: var(--ios-blue);
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.save-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.save-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.cancel-btn {
		padding: 10px 20px;
		background: white;
		color: var(--secondary-text);
		border: 2px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.cancel-btn:hover:not(:disabled) {
		background: var(--bg-secondary);
	}

	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.success-notification {
		background: #e8f5e9;
		color: #2d7a3e;
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		font-size: 14px;
		font-weight: 600;
	}

	.error-notification {
		background: #fee;
		color: #c33;
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		font-size: 14px;
		font-weight: 600;
	}

	@media (min-width: 768px) {
		.container {
			padding: 60px 40px 80px;
		}
		.page-title {
			font-size: 36px;
		}
		.member-card {
			padding: 20px;
		}
	}
</style>
