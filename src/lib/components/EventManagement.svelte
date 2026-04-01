<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages.js';

	export let events: any[];
	export let isTrainingMode: boolean;
	export let isChief: boolean;
	export let eventSuccess: string | undefined = undefined;
	export let eventError: string | undefined = undefined;

	let eventName = '';
	let editingEventId: number | null = null;
	let editEventName = '';

	function startEditEvent(event: any) {
		editingEventId = event.id;
		editEventName = isTrainingMode ? event.name : event.event_name;
	}

	function cancelEditEvent() {
		editingEventId = null;
		editEventName = '';
	}

	function clearEventForm() {
		eventName = '';
	}
</script>

<div class="settings-section">
	<h3 class="settings-title">{m.event_management()}</h3>

	{#if eventSuccess}
		<div class="success-message">{eventSuccess}</div>
	{/if}

	{#if eventError}
		<div class="error-message">{eventError}</div>
	{/if}

	{#if isChief}
		<!-- 主任検定員のみ編集可能 -->
		{#if events && events.length > 0}
			<div class="events-list">
				{#each events as event, index}
					<div class="event-item">
						{#if editingEventId === event.id}
							<form method="POST" action="?/updateEvent" use:enhance class="edit-form">
								<input type="hidden" name="eventId" value={event.id} />
								<input type="hidden" name="isTraining" value={isTrainingMode} />
								<input
									type="text"
									name="eventName"
									bind:value={editEventName}
									placeholder={m.event_name()}
									class="edit-input"
									required
								/>
								<div class="edit-actions">
									<button type="submit" class="save-btn-small">{m.common_save()}</button>
									<button type="button" class="cancel-btn-small" on:click={cancelEditEvent}>
										{m.common_cancel()}
									</button>
								</div>
							</form>
						{:else}
							<div class="event-info">
								<span class="event-number">{index + 1}.</span>
								<span class="event-text">
									{isTrainingMode ? event.name : event.event_name}
								</span>
							</div>
							<div class="event-actions">
								<button class="edit-btn-small" on:click={() => startEditEvent(event)}>
									{m.common_edit()}
								</button>
								<form method="POST" action="?/deleteEvent" use:enhance style="display: inline;">
									<input type="hidden" name="eventId" value={event.id} />
									<input type="hidden" name="isTraining" value={isTrainingMode} />
									<button
										type="submit"
										class="delete-btn-small"
										on:click={(e) => {
											if (!confirm(m.event_deleteConfirm())) {
												e.preventDefault();
											}
										}}
									>
										{m.common_delete()}
									</button>
								</form>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-message">{m.event_noEvents()}</p>
		{/if}

		<form method="POST" action="?/addEvent" use:enhance on:submit={clearEventForm}>
			<div class="add-event-form">
				<input
					type="text"
					name="eventName"
					bind:value={eventName}
					placeholder={m.event_namePlaceholder()}
					required
				/>
				<button type="submit" class="add-event-btn">{m.event_add()}</button>
			</div>
		</form>
	{:else}
		<!-- 一般検定員: 表示のみ -->
		{#if events && events.length > 0}
			<div class="events-list readonly">
				{#each events as event, index}
					<div class="event-item readonly">
						<div class="event-info">
							<span class="event-number">{index + 1}.</span>
							<span class="event-text">
								{isTrainingMode ? event.name : event.event_name}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="empty-message">{m.event_noEvents()}</p>
		{/if}
		<p class="readonly-notice">※ 種目の追加・編集・削除は主任検定員のみ可能です</p>
	{/if}
</div>

<style>
	.settings-section {
		margin-bottom: 1.5rem;
		text-align: left;
	}
	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		display: block;
		text-align: left;
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
	.events-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 16px;
	}
	.events-list.readonly {
		gap: 8px;
	}
	.event-item {
		background: white;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		padding: 12px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.event-item.readonly {
		border: 2px solid var(--separator-gray);
		background: var(--bg-primary);
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
	.edit-btn-small,
	.delete-btn-small,
	.save-btn-small,
	.cancel-btn-small {
		padding: 10px 16px;
		border-radius: 6px;
		border: none;
		font-size: 14px;
		cursor: pointer;
		transition: opacity 0.2s;
		font-weight: 500;
		min-height: 44px;
	}
	.edit-btn-small {
		background: var(--ios-blue);
		color: white;
	}
	.delete-btn-small {
		background: transparent;
		color: #dc3545;
		border: 1.5px solid #dc3545;
	}
	.delete-btn-small:hover {
		background: #ffe6e6;
		opacity: 1;
	}
	.delete-btn-small:active {
		background: #ffcccc;
		opacity: 1;
	}
	.save-btn-small {
		background: #2d7a3e;
		color: white;
	}
	.cancel-btn-small {
		background: var(--light-gray);
		color: var(--primary-text);
	}
	.edit-btn-small:active,
	.delete-btn-small:active,
	.save-btn-small:active,
	.cancel-btn-small:active {
		opacity: 0.7;
	}
	.edit-form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.edit-input {
		padding: 8px;
		font-size: 14px;
		border-radius: 6px;
		border: 1px solid var(--separator-gray);
		width: 100%;
	}
	.edit-actions {
		display: flex;
		gap: 8px;
	}
	.add-event-form {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}
	.add-event-form input {
		flex: 1;
		padding: 10px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 14px;
	}
	.add-event-btn {
		background: var(--ios-blue);
		color: white;
		padding: 10px 20px;
		border: none;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.2s;
		white-space: nowrap;
	}
	.add-event-btn:active {
		opacity: 0.7;
	}
	.empty-message {
		text-align: center;
		color: var(--secondary-text);
		padding: 20px;
		font-size: 14px;
		background: #f8f9fa;
		border-radius: 8px;
		margin-bottom: 16px;
	}
	.readonly-notice {
		font-size: 14px;
		color: #666;
		font-style: italic;
		margin-top: 12px;
		text-align: center;
	}

	@media (min-width: 768px) {
		.settings-title {
			font-size: 20px;
		}
	}
</style>
