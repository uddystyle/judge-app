<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import type { PageData, ActionData } from './$types';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime.js';

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
	$: roleNames = {
		admin: m.org_admin(),
		member: m.org_member()
	} as Record<string, string>;

	function formatDate(dateString: string) {
		const locale = getLocale();
		const date = new Date(dateString);
		return date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}

	let showInviteSection = false;
	let generatingInvite = false;
	let inviteUrl = '';
	let copiedInvite = false;
	let copiedInviteCode = false;

	// メンバー削除用の状態
	let showDeleteConfirm = false;
	let memberToDelete: any = null;
	let deletingMember = false;

	function copyInviteCode() {
		navigator.clipboard.writeText(data.organization.invite_code).then(
			() => {
				copiedInviteCode = true;
				setTimeout(() => {
					copiedInviteCode = false;
				}, 2000);
			},
			(err) => {
				console.error('コピーに失敗しました:', err);
				alert('コピーに失敗しました');
			}
		);
	}

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

	function confirmDeleteMember(member: any) {
		memberToDelete = member;
		showDeleteConfirm = true;
	}

	function cancelDeleteMember() {
		showDeleteConfirm = false;
		memberToDelete = null;
	}

	async function deleteMember() {
		if (!memberToDelete) return;

		deletingMember = true;

		try {
			const response = await fetch(
				`/api/organization/${data.organization.id}/members/${memberToDelete.id}`,
				{
					method: 'DELETE'
				}
			);

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || 'メンバーの削除に失敗しました');
			}

			// 成功したらページをリロード
			showDeleteConfirm = false;
			memberToDelete = null;
			location.reload();
		} catch (err: any) {
			alert(err.message || 'メンバーの削除に失敗しました');
		} finally {
			deletingMember = false;
		}
	}
</script>

<Header
	showAppName={true}
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.hasOrganization}
/>

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
						{isSubmittingName ? `${m.common_save()}...` : m.common_save()}
					</button>
					<button
						type="button"
						class="cancel-btn"
						on:click={cancelEditingName}
						disabled={isSubmittingName}
					>
						{m.common_cancel()}
					</button>
				</div>
			</form>
		{:else}
			<!-- 表示モード -->
			<div class="name-display">
				<h1 class="page-title">{data.organization.name}</h1>
				{#if isAdmin}
					<button class="edit-name-btn" on:click={startEditingName} title={m.common_edit()}>
						<Icon name="edit" size={16} />
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
			<div class="info-row">
				<span class="info-label">招待コード</span>
				<div class="info-value-with-action">
					<span class="invite-code-display">{data.organization.invite_code}</span>
					<button class="copy-code-btn" on:click={copyInviteCode}>
						{copiedInviteCode ? '✓ コピー済' : 'コピー'}
					</button>
				</div>
			</div>
			{#if isAdmin}
				<div class="info-row">
					<span class="info-label">あなたの役割</span>
					<span class="info-value admin-badge">{m.org_admin()}</span>
				</div>
			{:else}
				<div class="info-row">
					<span class="info-label">あなたの役割</span>
					<span class="info-value">{m.org_member()}</span>
				</div>
			{/if}
		</div>

		<!-- プラン管理ボタン -->
		<div class="plan-actions">
			<NavButton on:click={() => goto(`/pricing?org=${data.organization.id}`)}>
				プランの詳細を確認
			</NavButton>
			{#if isAdmin}
				<NavButton
					variant="primary"
					on:click={() => goto(`/organization/${data.organization.id}/change-plan`)}
				>
					プランを変更
				</NavButton>
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
					<div class="member-actions">
						<div class="member-meta">
							<span class="joined-date">参加: {formatDate(member.joined_at)}</span>
						</div>
						{#if isAdmin && member.user_id !== data.user.id}
							<button
								class="delete-member-btn"
								on:click={() => confirmDeleteMember(member)}
								title={m.common_delete()}
							>
								<Icon name="trash" size={16} />
								{m.common_delete()}
							</button>
						{/if}
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
					<Icon name="invite" size={18} />
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
						<p class="help-text">
							招待URLが生成されました。下記のURLをコピーして共有してください。
						</p>
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
					<button
						class="danger-btn"
						on:click={() => goto(`/organization/${data.organization.id}/delete`)}
					>
						<Icon name="trash" size={16} />
						組織を削除
					</button>
				</div>
			</div>
		</div>

		<hr class="divider" />
	{/if}

	<!-- 管理者向けリンク -->
	{#if isAdmin}
		<div class="admin-links-section">
			<h3 class="admin-section-title">管理機能</h3>
			<div class="admin-links">
				<a href="/organization/{data.organization.id}/archive" class="admin-link">
					<span class="admin-link-text">セッションアーカイブ</span>
				</a>
				<a href="/organization/{data.organization.id}/members/archive" class="admin-link">
					<span class="admin-link-text">削除されたメンバー</span>
				</a>
			</div>
		</div>

		<hr class="divider" />
	{/if}

	<!-- ナビゲーションボタン -->
	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>{m.nav_dashboard()}</NavButton>
	</div>
</div>

<!-- メンバー削除確認ダイアログ -->
<ConfirmDialog
	bind:isOpen={showDeleteConfirm}
	title="メンバーを削除しますか？"
	message={`「${memberToDelete?.profiles?.full_name || '名前未設定'}」を組織から削除します。\n\n※ 過去のセッションデータは保持され、「退会済み」として表示されます。`}
	confirmText={m.common_delete()}
	variant="danger"
	on:confirm={deleteMember}
	on:cancel={cancelDeleteMember}
/>

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
	.info-value-with-action {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.invite-code-display {
		font-family: 'Courier New', monospace;
		font-size: 18px;
		font-weight: 700;
		color: var(--text-primary);
		letter-spacing: 0.15em;
		background: var(--bg-secondary);
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--border-light);
	}
	.copy-code-btn {
		padding: 6px 14px;
		font-size: 13px;
		font-weight: 600;
		background: var(--ios-blue);
		color: white;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}
	.copy-code-btn:hover {
		opacity: 0.9;
		transform: translateY(-1px);
	}
	.copy-code-btn:active {
		transform: translateY(0);
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
	.member-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.member-meta {
		display: flex;
		align-items: center;
	}
	.delete-member-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 13px;
		font-weight: 600;
		background: transparent;
		color: var(--color-error);
		border: 1px solid var(--color-error);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}
	.delete-member-btn:hover {
		background: var(--color-error);
		color: white;
		box-shadow: 0 2px 6px rgba(220, 53, 69, 0.3);
	}
	.delete-member-btn:active {
		transform: scale(0.96);
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
		opacity: 0.9;
		transform: translateY(-1px);
	}
	.copy-invite-btn:active {
		transform: translateY(0);
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

	/* 管理者向けリンク */
	.admin-links-section {
		margin-bottom: 24px;
	}

	.admin-section-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 16px 0;
		text-align: center;
	}

	.admin-links {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 600px;
		margin: 0 auto;
	}

	.admin-link {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px 20px;
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 12px;
		text-decoration: none;
		transition: all 0.2s;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.admin-link:hover {
		border-color: var(--accent-primary);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		transform: translateY(-1px);
	}

	.admin-link-text {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.plan-actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 20px;
	}

	.plan-actions :global(button) {
		min-height: 48px;
		height: auto;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 500px;
		margin: 0 auto;
	}
	.danger-title {
		color: var(--color-error);
	}
	.danger-section {
		background: var(--color-error-tint);
		border: 2px solid var(--color-error);
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
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		background: var(--color-error);
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
		background: var(--color-error);
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
		background: var(--color-success-tint);
		color: var(--color-success);
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		font-size: 14px;
		font-weight: 600;
	}

	.error-notification {
		background: var(--color-error-tint);
		color: var(--color-error);
		padding: 12px 16px;
		border-radius: 8px;
		margin-bottom: 16px;
		font-size: 14px;
		font-weight: 600;
	}

	/* 名前編集のキャンセルボタン */
	.cancel-btn {
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 2px solid var(--border-light);
	}
	.cancel-btn:hover:not(:disabled) {
		background: var(--bg-tertiary);
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
		.plan-actions {
			flex-direction: row;
		}
	}
</style>
