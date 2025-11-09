<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';

	export let data: PageData;
	export let form: ActionData;

	$: sessionId = $page.params.id;

	let eventName = '';

	let editingEventId: number | null = null;
	let editEventName = '';

	function startEdit(event: any) {
		editingEventId = event.id;
		editEventName = event.event_name;
	}

	function cancelEdit() {
		editingEventId = null;
		editEventName = '';
	}

	function clearForm() {
		eventName = '';
	}
</script>

<Header />

<div class="container">
	<div class="instruction">種目設定</div>

	{#if form?.success}
		<div class="success-message">{form.message}</div>
	{/if}

	{#if form?.error}
		<div class="error-message">{form.error}</div>
	{/if}

	<!-- 登録済み種目一覧 -->
	{#if data.events.length > 0}
		<div class="events-section">
			<h3>登録済み種目</h3>
			<div class="events-list">
				{#each data.events as event, index}
					<div class="event-item">
						{#if editingEventId === event.id}
							<!-- 編集モード -->
							<form method="POST" action="?/updateEvent" use:enhance class="edit-form">
								<input type="hidden" name="eventId" value={event.id} />
								<div class="edit-inputs">
									<input
										type="text"
										name="eventName"
										placeholder="種目名"
										bind:value={editEventName}
										required
									/>
								</div>
								<div class="edit-actions">
									<button type="submit" class="save-btn">保存</button>
									<button type="button" class="cancel-btn" on:click={cancelEdit}>
										キャンセル
									</button>
								</div>
							</form>
						{:else}
							<!-- 表示モード -->
							<div class="event-info">
								<span class="event-number">{index + 1}.</span>
								<span class="event-text">{event.event_name}</span>
							</div>
							<div class="event-actions">
								<button class="edit-btn" on:click={() => startEdit(event)}>編集</button>
								<form method="POST" action="?/deleteEvent" use:enhance style="display: inline;">
									<input type="hidden" name="eventId" value={event.id} />
									<button
										type="submit"
										class="delete-btn"
										on:click={(e) => {
											if (!confirm('この種目を削除しますか？')) {
												e.preventDefault();
											}
										}}
									>
										削除
									</button>
								</form>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- 新しい種目を追加 -->
	<div class="add-section">
		<h3>新しい種目を追加</h3>
		<form method="POST" action="?/addEvent" use:enhance on:submit={clearForm}>
			<div class="add-form">
				<input
					type="text"
					name="eventName"
					placeholder="種目名 (例: 大回転)"
					bind:value={eventName}
					required
				/>
				<button type="submit" class="add-btn">追加</button>
			</div>
		</form>
	</div>

	<div class="nav-buttons">
		<NavButton on:click={() => goto(`/session/${sessionId}/tournament-setup`)}>
			設定画面に戻る
		</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 600px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
		text-align: center;
		color: var(--primary-text);
	}
	.success-message {
		background: #e6f6e8;
		border: 1px solid #2d7a3e;
		color: #1e5c2e;
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 20px;
		text-align: center;
	}
	.error-message {
		background: #ffe6e6;
		border: 1px solid #dc3545;
		color: #dc3545;
		padding: 12px;
		border-radius: 8px;
		margin-bottom: 20px;
		text-align: center;
	}

	/* 登録済み種目 */
	.events-section {
		margin-bottom: 32px;
	}
	.events-section h3 {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 16px;
		color: var(--primary-text);
	}
	.events-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.event-item {
		background: white;
		border: 1px solid var(--separator-gray);
		border-radius: 12px;
		padding: 16px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.event-info {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
	}
	.event-number {
		font-weight: 600;
		color: var(--secondary-text);
		min-width: 24px;
	}
	.event-text {
		color: var(--primary-text);
		font-size: 16px;
	}
	.event-actions {
		display: flex;
		gap: 8px;
	}
	.edit-btn,
	.delete-btn {
		padding: 6px 12px;
		border-radius: 8px;
		border: none;
		font-size: 14px;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.edit-btn {
		background: var(--ios-blue);
		color: white;
	}
	.edit-btn:active {
		opacity: 0.7;
	}
	.delete-btn {
		background: #dc3545;
		color: white;
	}
	.delete-btn:active {
		opacity: 0.7;
	}

	/* 編集フォーム */
	.edit-form {
		width: 100%;
	}
	.edit-inputs {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 12px;
	}
	.edit-inputs input {
		padding: 10px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 14px;
	}
	.edit-actions {
		display: flex;
		gap: 8px;
	}
	.save-btn,
	.cancel-btn {
		flex: 1;
		padding: 8px;
		border-radius: 8px;
		border: none;
		font-size: 14px;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.save-btn {
		background: #2d7a3e;
		color: white;
	}
	.cancel-btn {
		background: var(--light-gray);
		color: var(--primary-text);
	}
	.save-btn:active,
	.cancel-btn:active {
		opacity: 0.7;
	}

	/* 追加フォーム */
	.add-section {
		background: #f8f9fa;
		border: 2px dashed var(--separator-gray);
		border-radius: 12px;
		padding: 20px;
		margin-bottom: 28px;
	}
	.add-section h3 {
		font-size: 18px;
		font-weight: 600;
		margin-bottom: 16px;
		color: var(--primary-text);
	}
	.add-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.add-form input {
		padding: 12px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 16px;
		background: white;
	}
	.add-btn {
		background: var(--ios-blue);
		color: white;
		padding: 12px;
		border: none;
		border-radius: 8px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
	}
	.add-btn:active {
		opacity: 0.7;
	}

	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
</style>
