<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import * as m from '$lib/paraglide/messages.js';

	// 参加中の検定員リスト（details ページから抽出）
	// 主任任命・検定員/ゲスト削除のフォームと確認ダイアログを内包する自己完結コンポーネント
	interface Participant {
		user_id: string | null;
		is_guest: boolean;
		guest_name: string | null;
		guest_identifier?: string;
		profiles: { full_name?: string } | null;
		removed_at: string | null;
	}

	export let participants: Participant[];
	export let currentUserId: string;
	export let createdBy: string;
	export let chiefJudgeId: string | null;

	// ゲストユーザー削除確認ダイアログ
	let showRemoveGuestDialog = false;
	let guestToRemove: { identifier: string; name: string } | null = null;
	let removeGuestForms: { [key: string]: HTMLFormElement } = {};

	// 一般検定員削除確認ダイアログ
	let showRemoveParticipantDialog = false;
	let participantToRemove: { userId: string; name: string } | null = null;
	let removeParticipantForms: { [key: string]: HTMLFormElement } = {};

	function openRemoveGuestDialog(guestIdentifier: string, guestName: string) {
		guestToRemove = { identifier: guestIdentifier, name: guestName };
		showRemoveGuestDialog = true;
	}

	function handleRemoveGuestConfirm() {
		if (guestToRemove && removeGuestForms[guestToRemove.identifier]) {
			removeGuestForms[guestToRemove.identifier].requestSubmit();
		}
		showRemoveGuestDialog = false;
		guestToRemove = null;
	}

	function handleRemoveGuestCancel() {
		showRemoveGuestDialog = false;
		guestToRemove = null;
	}

	function openRemoveParticipantDialog(userId: string, participantName: string) {
		participantToRemove = { userId, name: participantName };
		showRemoveParticipantDialog = true;
	}

	function handleRemoveParticipantConfirm() {
		if (participantToRemove && removeParticipantForms[participantToRemove.userId]) {
			removeParticipantForms[participantToRemove.userId].requestSubmit();
		}
		showRemoveParticipantDialog = false;
		participantToRemove = null;
	}

	function handleRemoveParticipantCancel() {
		showRemoveParticipantDialog = false;
		participantToRemove = null;
	}

	// 参加者リスト更新
	let isRefreshing = false;
	function handleRefresh() {
		isRefreshing = true;
		window.location.reload();
	}
</script>

<div class="section-header-with-action">
	<h3 class="settings-title"><Icon name="judges" size={20} />{m.details_activeJudges()}</h3>
	<button
		class="refresh-btn-with-label"
		class:refreshing={isRefreshing}
		on:click={handleRefresh}
		title={m.details_refreshList()}
	>
		<Icon name="refresh" size={18} />
		<span class="refresh-label">{m.details_refreshList()}</span>
	</button>
</div>
<div class="participants-container">
	{#if participants && participants.length > 0}
		{#each participants as p (p.user_id ?? p.guest_identifier)}
			<div class="participant-item" class:removed={p.removed_at}>
				<span class="participant-name">
					{#if p.is_guest}
						{p.guest_name}
						<span class="guest-badge">{m.details_guest()}</span>
					{:else}
						{p.profiles?.full_name || m.details_profileNotSet()}
						{#if chiefJudgeId === p.user_id}
							<span class="chief-badge">{m.details_chief()}</span>
						{/if}
						{#if p.removed_at}
							<span class="removed-badge">{m.details_removed()}</span>
						{/if}
					{/if}
				</span>

				<div class="participant-actions">
					{#if !p.is_guest && p.user_id && currentUserId === createdBy}
						<form method="POST" action="?/appointChief" use:enhance>
							<input type="hidden" name="userId" value={p.user_id} />
							<button type="submit" class="appoint-btn">
								{#if chiefJudgeId === p.user_id}
									{m.details_removeChief()}
								{:else}
									{m.details_appointChief()}
								{/if}
							</button>
						</form>

						{#if p.user_id !== currentUserId && p.user_id !== chiefJudgeId}
							<form
								bind:this={removeParticipantForms[p.user_id]}
								method="POST"
								action="?/removeParticipant"
								use:enhance
							>
								<input type="hidden" name="userId" value={p.user_id} />
								<button
									type="button"
									class="appoint-btn danger"
									on:click={() =>
										openRemoveParticipantDialog(
											p.user_id!,
											p.profiles?.full_name || m.details_profileNotSet()
										)}
								>
									<Icon name="trash" size={16} />
									{m.common_delete()}
								</button>
							</form>
						{/if}
					{/if}

					{#if p.is_guest && p.guest_identifier && currentUserId === createdBy}
						<form
							bind:this={removeGuestForms[p.guest_identifier]}
							method="POST"
							action="?/removeGuest"
							use:enhance
						>
							<input type="hidden" name="guestIdentifier" value={p.guest_identifier} />
							<button
								type="button"
								class="appoint-btn danger"
								on:click={() => openRemoveGuestDialog(p.guest_identifier!, p.guest_name || '')}
							>
								<Icon name="trash" size={16} />
								{m.common_delete()}
							</button>
						</form>
					{/if}
				</div>
			</div>
		{/each}
	{:else}
		<p>{m.details_noParticipants()}</p>
	{/if}
</div>

<!-- ゲストユーザー削除確認ダイアログ -->
<ConfirmDialog
	bind:isOpen={showRemoveGuestDialog}
	title={m.details_removeGuest()}
	message={guestToRemove ? m.details_removeGuestMessage({ name: guestToRemove.name }) : ''}
	confirmText={m.common_delete()}
	cancelText={m.common_cancel()}
	variant="danger"
	on:confirm={handleRemoveGuestConfirm}
	on:cancel={handleRemoveGuestCancel}
/>

<!-- 一般検定員削除確認ダイアログ -->
<ConfirmDialog
	bind:isOpen={showRemoveParticipantDialog}
	title={m.details_removeJudge()}
	message={participantToRemove
		? m.details_removeJudgeMessage({ name: participantToRemove.name })
		: ''}
	confirmText={m.common_delete()}
	cancelText={m.common_cancel()}
	variant="danger"
	on:confirm={handleRemoveParticipantConfirm}
	on:cancel={handleRemoveParticipantCancel}
/>

<style>
	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-align: left;
	}
	.section-header-with-action {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.section-header-with-action .settings-title {
		margin-bottom: 0;
	}
	.refresh-btn-with-label {
		background: var(--bg-primary);
		border: 2px solid var(--border-light);
		border-radius: 8px;
		padding: 8px 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		cursor: pointer;
		transition: all 0.2s ease;
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 500;
	}
	.refresh-btn-with-label:hover {
		background: var(--bg-hover);
		border-color: var(--border-medium);
	}
	.refresh-btn-with-label:active {
		transform: scale(0.98);
		opacity: 0.7;
	}
	.refresh-btn-with-label.refreshing {
		pointer-events: none;
		opacity: 0.7;
	}
	.refresh-btn-with-label.refreshing :global(svg) {
		animation: spin 1s linear infinite;
	}
	.refresh-label {
		white-space: nowrap;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.participants-container {
		background: white;
		border-radius: 12px;
		padding: 8px 16px;
	}
	.participant-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid var(--separator-gray);
	}
	.participant-item:last-child {
		border-bottom: none;
	}
	.participant-name {
		font-weight: 500;
	}
	.participant-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.chief-badge {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-success);
		margin-left: 8px;
	}
	.guest-badge {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-secondary);
		margin-left: 8px;
	}
	.removed-badge {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--bg-tertiary);
		padding: 2px 6px;
		border-radius: 4px;
		margin-left: 8px;
	}
	.participant-item.removed {
		opacity: 0.6;
	}
	.participant-item.removed .participant-name {
		color: var(--text-secondary);
	}
	.appoint-btn {
		background-color: var(--keypad-bg);
		color: var(--primary-text);
		border: none;
		border-radius: 8px;
		padding: 10px 16px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background-color 0.2s;
		min-height: 44px;
	}
	.appoint-btn:disabled {
		background-color: var(--ios-blue);
		color: white;
		cursor: default;
		opacity: 0.7;
	}
	.appoint-btn.danger {
		background-color: transparent;
		color: var(--color-error);
		border: 1.5px solid var(--color-error);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
	}
	.appoint-btn.danger:hover {
		background-color: var(--color-error-tint);
	}
	.appoint-btn.danger:active {
		background-color: var(--color-error-tint);
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.settings-title {
			font-size: 20px;
		}
		.participants-container {
			padding: 16px 24px;
		}
		.participant-item {
			padding: 16px 0;
		}
		.participant-name {
			font-size: 18px;
		}
		.appoint-btn {
			padding: 8px 16px;
			font-size: 16px;
		}
	}
</style>
