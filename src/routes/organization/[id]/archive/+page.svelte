<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import NavButton from '$lib/components/NavButton.svelte';

	export let data: PageData;

	const retentionDays = data.organization.plans?.archived_data_retention_days;
	const isUnlimited = retentionDays === -1;

	// モード名のマッピング
	const modeNames: Record<string, string> = {
		certification: '検定',
		tournament: '大会',
		training: '研修'
	};

	function formatDate(dateString: string) {
		const date = new Date(dateString);
		return date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function calculateDaysUntilDeletion(deletedAt: string, retentionDays: number) {
		if (retentionDays === -1) return null;
		const deleted = new Date(deletedAt);
		const expiry = new Date(deleted.getTime() + retentionDays * 24 * 60 * 60 * 1000);
		return Math.floor((expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
	}

	function getModeName(session: any) {
		if (session.is_tournament_mode || session.mode === 'tournament') {
			return modeNames.tournament;
		}
		return modeNames[session.mode] || session.mode;
	}

	let restoringSessionId: string | null = null;
	let deletingSessionId: string | null = null;
	let showDeleteConfirm = false;
	let sessionToDelete: any = null;
	let deleteConfirmStage: 'first' | 'second' = 'first';

	const isPremium = data.organization.plan_type === 'premium';

	// フィルター/検索の状態
	let searchQuery = '';
	let selectedMode: 'all' | 'certification' | 'tournament' | 'training' = 'all';
	let sortBy: 'deleted_date' | 'session_date' | 'name' = 'deleted_date';

	// フィルタリング済みセッション
	$: filteredSessions = (data.archivedSessions || [])
		.filter((session) => {
			// 検索クエリでフィルタ
			const matchesSearch =
				searchQuery === '' ||
				session.name.toLowerCase().includes(searchQuery.toLowerCase());

			// モードでフィルタ
			const sessionMode = session.is_tournament_mode ? 'tournament' : session.mode;
			const matchesMode = selectedMode === 'all' || sessionMode === selectedMode;

			return matchesSearch && matchesMode;
		})
		.sort((a, b) => {
			// ソート
			if (sortBy === 'deleted_date') {
				return new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime();
			} else if (sortBy === 'session_date') {
				return new Date(b.session_date).getTime() - new Date(a.session_date).getTime();
			} else {
				// name
				return a.name.localeCompare(b.name);
			}
		});

	async function restoreSession(sessionId: string) {
		if (restoringSessionId) return;

		if (!confirm('このセッションを復元しますか？\n\nダッシュボードに再表示されます。')) {
			return;
		}

		restoringSessionId = sessionId;

		try {
			const response = await fetch(`/api/sessions/${sessionId}`, {
				method: 'POST'
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || 'セッションの復元に失敗しました');
			}

			// 成功したらページをリロード
			location.reload();
		} catch (err: any) {
			alert(err.message || 'セッションの復元に失敗しました');
			restoringSessionId = null;
		}
	}

	function confirmPermanentDelete(session: any) {
		sessionToDelete = session;
		deleteConfirmStage = 'first';
		showDeleteConfirm = true;
	}

	function proceedToSecondConfirm() {
		deleteConfirmStage = 'second';
	}

	function cancelDelete() {
		showDeleteConfirm = false;
		sessionToDelete = null;
		deleteConfirmStage = 'first';
	}

	async function permanentlyDeleteSession() {
		if (!sessionToDelete || deletingSessionId) return;

		deletingSessionId = sessionToDelete.id;

		try {
			const response = await fetch(`/api/sessions/${sessionToDelete.id}/permanent`, {
				method: 'DELETE'
			});

			const result = await response.json();

			if (!response.ok) {
				throw new Error(result.error || 'セッションの完全削除に失敗しました');
			}

			// 成功したらページをリロード
			alert('セッションを完全に削除しました');
			location.reload();
		} catch (err: any) {
			alert(err.message || 'セッションの完全削除に失敗しました');
			deletingSessionId = null;
		}
	}
</script>

<Header
	showAppName={true}
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.hasOrganization}
	pageOrganizations={[data.organization]}
/>

<div class="container">
	<div class="page-header">
		<h1 class="page-title">セッションアーカイブ</h1>
		<p class="subtitle">削除されたセッションの履歴を管理できます</p>
	</div>

	<!-- 保持期間の表示 -->
	{#if isUnlimited}
		<div class="retention-info premium">
			<span>Premiumプラン: アーカイブは無期限で保存されます</span>
		</div>
	{:else}
		<div class="retention-info warning">
			<span>削除から{retentionDays}日経過したデータは自動的に完全削除されます</span>
		</div>
	{/if}

	<!-- フィルター/検索バー -->
	{#if data.archivedSessions && data.archivedSessions.length > 0}
		<div class="filter-section">
			<div class="search-box">
				<input
					type="text"
					class="search-input"
					placeholder="セッション名で検索..."
					bind:value={searchQuery}
				/>
			</div>

			<div class="filter-controls">
				<div class="filter-group">
					<label for="mode-filter" class="filter-label">モード:</label>
					<select id="mode-filter" class="filter-select" bind:value={selectedMode}>
						<option value="all">すべて</option>
						<option value="certification">検定</option>
						<option value="tournament">大会</option>
						<option value="training">研修</option>
					</select>
				</div>

				<div class="filter-group">
					<label for="sort-filter" class="filter-label">並び替え:</label>
					<select id="sort-filter" class="filter-select" bind:value={sortBy}>
						<option value="deleted_date">削除日（新しい順）</option>
						<option value="session_date">セッション日（新しい順）</option>
						<option value="name">名前（A-Z）</option>
					</select>
				</div>
			</div>

			<div class="result-count">
				{filteredSessions.length} 件のセッション
				{#if filteredSessions.length !== data.archivedSessions.length}
					<span class="total-count">（全 {data.archivedSessions.length} 件中）</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- アーカイブ一覧 -->
	{#if filteredSessions && filteredSessions.length > 0}
		<div class="archive-list">
			{#each filteredSessions as session}
				{@const daysUntilDeletion = calculateDaysUntilDeletion(
					session.deleted_at,
					retentionDays
				)}

				<div
					class="archive-card"
					class:expiring-soon={daysUntilDeletion !== null &&
						daysUntilDeletion <= 7 &&
						daysUntilDeletion > 0}
					class:expired={daysUntilDeletion !== null && daysUntilDeletion <= 0}
				>
					<div class="session-info">
						<div class="session-header">
							<h3 class="session-name">{session.name}</h3>
							<span class="mode-badge">{getModeName(session)}</span>
						</div>

						<div class="meta">
							<div class="meta-item">
								<span class="meta-label">セッション日:</span>
								<span class="meta-value">{formatDate(session.session_date)}</span>
							</div>
							<div class="meta-item">
								<span class="meta-label">削除日:</span>
								<span class="meta-value">{formatDate(session.deleted_at)}</span>
							</div>
							<div class="meta-item">
								<span class="meta-label">削除者:</span>
								<span class="meta-value">
									{session.deleted_by_profile?.full_name || '不明'}
								</span>
							</div>

							{#if !isUnlimited && daysUntilDeletion !== null}
								<div class="meta-item expiry">
									{#if daysUntilDeletion > 0}
										<span class="expiry-warning">あと{daysUntilDeletion}日で完全削除されます</span>
									{:else}
										<span class="expiry-warning urgent">まもなく完全削除されます</span>
									{/if}
								</div>
							{/if}
						</div>
					</div>

					<div class="actions">
						<button
							class="action-btn view-btn"
							on:click={() => goto(`/session/${session.id}/details`)}
						>
							詳細を見る
						</button>
						<button
							class="action-btn restore-btn"
							on:click={() => restoreSession(session.id)}
							disabled={restoringSessionId === session.id}
						>
							{restoringSessionId === session.id ? '復元中...' : '復元'}
						</button>
						{#if isPremium}
							<button
								class="action-btn delete-btn"
								on:click={() => confirmPermanentDelete(session)}
								disabled={deletingSessionId === session.id}
							>
								{deletingSessionId === session.id ? '削除中...' : '完全削除'}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{:else if data.archivedSessions && data.archivedSessions.length > 0}
		<!-- フィルター結果が0件の場合 -->
		<div class="empty-state">
			<p class="empty-message">検索条件に一致するセッションが見つかりません</p>
			<button
				class="reset-filter-btn"
				on:click={() => {
					searchQuery = '';
					selectedMode = 'all';
				}}
			>
				フィルターをリセット
			</button>
		</div>
	{:else}
		<!-- アーカイブが全くない場合 -->
		<div class="empty-state">
			<p class="empty-message">アーカイブされたセッションはありません</p>
		</div>
	{/if}

	<!-- ナビゲーション -->
	<div class="nav-buttons">
		<NavButton on:click={() => goto(`/organization/${data.organization.id}`)}>
			組織ページに戻る
		</NavButton>
		<NavButton on:click={() => goto('/dashboard')}>ダッシュボードに戻る</NavButton>
	</div>
</div>

<!-- 完全削除確認ダイアログ -->
{#if showDeleteConfirm && sessionToDelete}
	<div class="modal-overlay" on:click={cancelDelete}>
		<div class="modal-content" on:click|stopPropagation>
			{#if deleteConfirmStage === 'first'}
				<div class="modal-header">
					<h3 class="modal-title">完全削除の確認（1/2）</h3>
				</div>
				<div class="modal-body">
					<p class="modal-text">
						<strong>{sessionToDelete.name}</strong> を完全に削除しようとしています。
					</p>
					<div class="warning-box">
						<p class="warning-title">重要な警告</p>
						<ul class="warning-list">
							<li>このデータは完全に削除され、二度と復元できません</li>
							<li>セッションに関連するすべてのデータ（参加者、スコアなど）も削除されます</li>
							<li>この操作は取り消すことができません</li>
						</ul>
					</div>
					<p class="modal-question">本当に続行しますか？</p>
				</div>
				<div class="modal-actions">
					<button class="modal-btn cancel-btn" on:click={cancelDelete}>
						キャンセル
					</button>
					<button class="modal-btn danger-btn" on:click={proceedToSecondConfirm}>
						次へ進む
					</button>
				</div>
			{:else}
				<div class="modal-header">
					<h3 class="modal-title">最終確認（2/2）</h3>
				</div>
				<div class="modal-body">
					<p class="modal-text final-confirm">
						最後の確認です。<strong>{sessionToDelete.name}</strong> を完全に削除します。
					</p>
					<div class="danger-box">
						<p class="danger-text">
							この操作は取り消せません。データは永久に失われます。
						</p>
					</div>
				</div>
				<div class="modal-actions">
					<button class="modal-btn cancel-btn" on:click={cancelDelete}>
						キャンセル
					</button>
					<button
						class="modal-btn final-delete-btn"
						on:click={permanentlyDeleteSession}
						disabled={deletingSessionId === sessionToDelete.id}
					>
						{deletingSessionId === sessionToDelete.id ? '削除中...' : '完全削除を実行'}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<Footer />

<style>
	.container {
		padding: 80px 20px 60px;
		max-width: 900px;
		margin: 0 auto;
		min-height: calc(100vh - 140px);
	}

	.page-header {
		margin-bottom: 32px;
		text-align: center;
	}

	.page-title {
		font-size: 28px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0 0 12px 0;
	}

	.subtitle {
		font-size: 15px;
		color: var(--text-secondary);
		margin: 0;
	}

	/* 保持期間情報 */
	.retention-info {
		padding: 16px 20px;
		border-radius: 12px;
		margin-bottom: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 15px;
		font-weight: 500;
		text-align: center;
	}

	.retention-info.premium {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.retention-info.warning {
		background: #fff3cd;
		color: #856404;
		border: 2px solid #ffc107;
	}

	/* フィルター/検索セクション */
	.filter-section {
		margin-bottom: 24px;
		padding: 20px;
		background: var(--bg-secondary);
		border-radius: 12px;
		border: 1px solid var(--border-light);
	}

	.search-box {
		margin-bottom: 16px;
	}

	.search-input {
		width: 100%;
		padding: 12px 16px;
		font-size: 15px;
		border: 2px solid var(--border-light);
		border-radius: 8px;
		background: var(--bg-primary);
		color: var(--text-primary);
		transition: border-color 0.2s;
	}

	.search-input:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.search-input::placeholder {
		color: var(--text-secondary);
	}

	.filter-controls {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 16px;
	}

	.filter-group {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.filter-label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		min-width: 80px;
	}

	.filter-select {
		flex: 1;
		padding: 10px 12px;
		font-size: 14px;
		border: 2px solid var(--border-light);
		border-radius: 8px;
		background: var(--bg-primary);
		color: var(--text-primary);
		cursor: pointer;
		transition: border-color 0.2s;
	}

	.filter-select:focus {
		outline: none;
		border-color: var(--accent-primary);
	}

	.result-count {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
		text-align: center;
		padding-top: 12px;
		border-top: 1px solid var(--border-light);
	}

	.total-count {
		font-weight: 400;
		color: var(--text-secondary);
		font-size: 13px;
	}

	.reset-filter-btn {
		margin-top: 16px;
		padding: 10px 20px;
		font-size: 14px;
		font-weight: 600;
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.reset-filter-btn:hover {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.reset-filter-btn:active {
		transform: translateY(0);
	}

	/* アーカイブリスト */
	.archive-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 32px;
	}

	.archive-card {
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 16px;
		padding: 24px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
		transition: all 0.2s;
	}

	.archive-card:hover {
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
	}

	.archive-card.expiring-soon {
		border-color: #ff9800;
		background: #fff8e1;
	}

	.archive-card.expired {
		border-color: #f44336;
		background: #ffebee;
	}

	.session-info {
		margin-bottom: 20px;
	}

	.session-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}

	.session-name {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.mode-badge {
		background: var(--accent-primary);
		color: white;
		padding: 4px 12px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.meta-item {
		display: flex;
		gap: 8px;
		font-size: 14px;
	}

	.meta-label {
		color: var(--text-secondary);
		font-weight: 500;
		min-width: 80px;
	}

	.meta-value {
		color: var(--text-primary);
		font-weight: 600;
	}

	.meta-item.expiry {
		margin-top: 8px;
	}

	.expiry-warning {
		color: #ff6f00;
		font-weight: 600;
		font-size: 14px;
		padding: 8px 12px;
		background: white;
		border-radius: 6px;
		display: inline-block;
	}

	.expiry-warning.urgent {
		color: #d32f2f;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.7;
		}
	}

	/* アクションボタン */
	.actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}

	.action-btn {
		padding: 10px 20px;
		font-size: 14px;
		font-weight: 600;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.view-btn {
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 2px solid var(--border-light);
	}

	.view-btn:hover:not(:disabled) {
		background: var(--bg-tertiary);
		border-color: var(--accent-primary);
	}

	.restore-btn {
		background: var(--ios-blue);
		color: white;
	}

	.restore-btn:hover:not(:disabled) {
		background: #0051d5;
		box-shadow: 0 2px 8px rgba(0, 122, 255, 0.3);
	}

	.restore-btn:active:not(:disabled) {
		transform: scale(0.98);
	}

	.delete-btn {
		background: #dc3545;
		color: white;
	}

	.delete-btn:hover:not(:disabled) {
		background: #c82333;
		box-shadow: 0 2px 8px rgba(220, 53, 69, 0.3);
	}

	.delete-btn:active:not(:disabled) {
		transform: scale(0.98);
	}

	/* モーダルダイアログ */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 20px;
	}

	.modal-content {
		background: var(--bg-primary);
		border-radius: 16px;
		padding: 24px;
		max-width: 500px;
		width: 100%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
	}

	.modal-header {
		margin-bottom: 20px;
	}

	.modal-title {
		font-size: 20px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.modal-body {
		margin-bottom: 24px;
	}

	.modal-text {
		font-size: 15px;
		color: var(--text-primary);
		line-height: 1.6;
		margin: 0 0 16px 0;
	}

	.modal-text.final-confirm {
		font-size: 16px;
		font-weight: 600;
	}

	.modal-question {
		font-size: 15px;
		color: var(--text-primary);
		font-weight: 600;
		margin: 16px 0 0 0;
	}

	.warning-box {
		background: #fff3cd;
		border: 2px solid #ffc107;
		border-radius: 8px;
		padding: 16px;
		margin: 16px 0;
	}

	.warning-title {
		font-size: 14px;
		font-weight: 700;
		color: #856404;
		margin: 0 0 12px 0;
	}

	.warning-list {
		margin: 0;
		padding-left: 20px;
		color: #856404;
		font-size: 14px;
		line-height: 1.6;
	}

	.warning-list li {
		margin-bottom: 8px;
	}

	.danger-box {
		background: #ffebee;
		border: 2px solid #f44336;
		border-radius: 8px;
		padding: 16px;
		margin: 16px 0;
		text-align: center;
	}

	.danger-text {
		font-size: 15px;
		font-weight: 700;
		color: #c62828;
		margin: 0;
	}

	.modal-actions {
		display: flex;
		gap: 12px;
		justify-content: flex-end;
	}

	.modal-btn {
		padding: 10px 20px;
		font-size: 14px;
		font-weight: 600;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.modal-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.cancel-btn {
		background: var(--bg-secondary);
		color: var(--text-primary);
		border: 2px solid var(--border-light);
	}

	.cancel-btn:hover:not(:disabled) {
		background: var(--bg-tertiary);
		border-color: var(--accent-primary);
	}

	.danger-btn {
		background: #ff9800;
		color: white;
	}

	.danger-btn:hover:not(:disabled) {
		background: #f57c00;
		box-shadow: 0 2px 8px rgba(255, 152, 0, 0.3);
	}

	.final-delete-btn {
		background: #dc3545;
		color: white;
	}

	.final-delete-btn:hover:not(:disabled) {
		background: #c82333;
		box-shadow: 0 2px 8px rgba(220, 53, 69, 0.4);
	}

	.final-delete-btn:active:not(:disabled) {
		transform: scale(0.98);
	}

	/* 空の状態 */
	.empty-state {
		text-align: center;
		padding: 60px 20px;
	}

	.empty-message {
		font-size: 16px;
		color: var(--text-secondary);
		margin: 0;
	}

	/* ナビゲーション */
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 500px;
		margin: 0 auto;
	}

	/* レスポンシブ */
	@media (min-width: 768px) {
		.container {
			padding: 100px 40px 80px;
		}

		.page-title {
			font-size: 36px;
		}

		.subtitle {
			font-size: 17px;
		}

		.session-name {
			font-size: 22px;
		}

		.actions {
			justify-content: flex-start;
		}

		.action-btn {
			padding: 12px 24px;
			font-size: 15px;
		}

		.filter-controls {
			flex-direction: row;
			gap: 16px;
		}

		.filter-group {
			flex: 1;
		}

		.filter-label {
			min-width: 60px;
		}
	}
</style>
