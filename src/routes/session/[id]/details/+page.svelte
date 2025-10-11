<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';

	export let data: PageData;
	export let form: ActionData;

	$: sessionName = data.sessionDetails.name;
</script>

<div class="container">
	<div class="instruction">{data.sessionDetails.name} の詳細</div>

	<form
		method="POST"
		action="?/updateName"
		use:enhance={() => {
			return async ({ update }) => {
				await update({ reset: false });
			};
		}}
	>
		<div class="form-container">
			<label for="session-name" class="form-label">検定名</label>
			<input type="text" id="session-name" name="sessionName" bind:value={sessionName} />
			<NavButton variant="primary" type="submit">名前を更新</NavButton>

			{#if form?.message}
				<p class="message" class:success={form?.success}>{form.message}</p>
			{/if}
		</div>
	</form>
	<hr class="divider" />

	<div class="settings-section">
		<h3 class="settings-title">参加中の検定員</h3>
		<div class="participants-container">
			{#if data.participants && data.participants.length > 0}
				{#each data.participants as p}
					<div class="participant-item">
						<span class="participant-name">
							{p.profile.full_name}
							{#if data.sessionDetails.chief_judge_id === p.user_id}
								<span class="chief-badge">(主任)</span>
							{/if}
						</span>
					</div>
				{/each}
			{:else}
				<p>参加者はいません。</p>
			{/if}
		</div>
	</div>

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/dashboard')}>検定選択に戻る</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		max-width: 500px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
		text-align: center;
	}
	.form-container,
	.settings-section {
		margin-bottom: 1.5rem;
	}
	.form-label,
	.settings-title {
		font-size: 17px;
		font-weight: 600;
		margin-bottom: 0.5rem;
		display: block;
		text-align: left;
	}
	input {
		width: 100%;
		padding: 12px;
		border: 1px solid var(--separator-gray);
		border-radius: 8px;
		font-size: 16px;
	}
	.divider {
		border: none;
		border-top: 1px solid var(--separator-gray);
		margin: 24px 0;
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
	.chief-badge {
		font-size: 12px;
		font-weight: 600;
		color: var(--ios-green);
		margin-left: 8px;
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
	.message.success {
		color: var(--ios-green);
	}
</style>
