<script lang="ts">
	// 組織の課金状態の表示。
	//
	// ⚠️ これまで UI は plan_type しか出しておらず、「支払われている premium」と
	// 「支払いが滞っている premium」をユーザーが区別できなかった。
	// とくに past_due はアプリ側では上位プランの権限を維持する猶予期間として扱うため、
	// 当人は気づかないまま使い続け、猶予が切れた瞬間に free へ落ちる。
	// 気づいて対処する機会を作るのがこの表示の目的。
	//
	// 表示ポリシーは SyncStatusBadge と揃える:
	// **正常時（active / trialing かつ解約予定なし）は何も出さない。**
	// 対処が必要なときだけ出して、平常時のノイズを増やさない。

	export let billing: {
		status: string;
		cancelAtPeriodEnd: boolean;
		currentPeriodEnd: string | null;
	} | null = null;

	/** 支払い方法を直す導線。管理者のみ渡される想定 */
	export let onManage: (() => void) | null = null;

	function formatDate(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
	}

	// 対処が必要な状態だけを拾う。
	// active / trialing は正常。canceled は既に free へ降格済みで、表示する意味が無い。
	type Level = 'error' | 'warning';
	interface Notice {
		level: Level;
		label: string;
		text: string;
		showManage: boolean;
	}

	function buildNotice(
		b: { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: string | null } | null
	): Notice | null {
		if (!b) return null;

		switch (b.status) {
			case 'past_due':
				return {
					level: 'error',
					label: 'お支払いの確認ができません',
					text: `お支払い方法をご確認ください。このままではご利用中のプランが停止されます。`,
					showManage: true
				};
			case 'unpaid':
				return {
					level: 'error',
					label: 'お支払いが完了していません',
					text: 'お支払い方法を更新すると、ご利用を再開できます。',
					showManage: true
				};
			case 'incomplete':
				return {
					level: 'warning',
					label: 'お手続きが完了していません',
					text: 'お支払いの確認中です。完了しない場合はお支払い方法をご確認ください。',
					showManage: true
				};
			case 'incomplete_expired':
				return {
					level: 'error',
					label: 'お手続きが期限切れです',
					text: 'お手数ですが、あらためてプランをお申し込みください。',
					showManage: false
				};
			case 'paused':
				return {
					level: 'warning',
					label: 'お支払いが一時停止中です',
					text: 'ご利用を再開するにはお支払いを再開してください。',
					showManage: true
				};
		}

		// 支払いは正常だが解約が予約されている場合
		if (b.cancelAtPeriodEnd) {
			const until = formatDate(b.currentPeriodEnd);
			return {
				level: 'warning',
				label: '解約予定',
				text: until
					? `${until}まではこのままご利用いただけます。それ以降はフリープランになります。`
					: '現在の請求期間の終了後、フリープランになります。',
				showManage: true
			};
		}

		return null;
	}

	$: notice = buildNotice(billing);
</script>

{#if notice}
	<div class="billing-status" role="status">
		<span class="badge {notice.level}">{notice.label}</span>
		<span class="text">{notice.text}</span>
		{#if notice.showManage && onManage}
			<button type="button" class="manage" on:click={onManage}>お支払い方法を確認</button>
		{/if}
	</div>
{/if}

<style>
	.billing-status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
		margin: 8px 0;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--bg-secondary);
		font-size: 13px;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 10px;
		border-radius: 999px;
		font-weight: 600;
		font-size: 12px;
		white-space: nowrap;
	}
	.badge.error {
		background: var(--color-error-tint);
		color: var(--color-error);
	}
	.badge.warning {
		background: var(--color-warning-tint);
		color: var(--color-warning);
	}
	.text {
		color: var(--text-secondary);
		line-height: 1.5;
	}
	.manage {
		padding: 4px 12px;
		border: 1px solid var(--separator-gray);
		border-radius: 999px;
		background: transparent;
		color: var(--text-primary);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.manage:hover {
		background: var(--bg-primary);
	}
</style>
