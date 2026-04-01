<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';

	// サーバーアクションから返されるデータ（エラーメッセージなど）を保持
	export let form: ActionData;

	let isGuestMode = true; // デフォルトはゲストモード
</script>

<div class="container">
	<div class="instruction">{m.session_joinTitle()}</div>

	<!-- モード切り替え -->
	<div class="mode-toggle">
		<button
			type="button"
			class="mode-button"
			class:active={isGuestMode}
			on:click={() => (isGuestMode = true)}
		>
			{m.session_joinAsGuest()}
		</button>
		<button
			type="button"
			class="mode-button"
			class:active={!isGuestMode}
			on:click={() => (isGuestMode = false)}
		>
			{m.session_joinAsMember()}
		</button>
	</div>

	<form method="POST" action="?/join" use:enhance>
		<div class="form-container">
			{#if isGuestMode}
				<input
					type="text"
					name="guestName"
					placeholder={m.session_guestName()}
					value={form?.guestName ?? ''}
					required
				/>
			{/if}

			<input
				type="text"
				name="joinCode"
				id="join-code-input"
				placeholder={m.session_joinCode()}
				maxlength="6"
				style="text-transform: uppercase;"
				value={form?.joinCode ?? ''}
				required
			/>

			<input type="hidden" name="isGuest" value={isGuestMode ? 'true' : 'false'} />

			{#if form?.error}
				<p class="error-message">{form.error}</p>
			{/if}

			<div class="nav-buttons">
				<NavButton variant="primary" type="submit">{m.session_join()}</NavButton>
			</div>
		</div>
	</form>

	<div class="nav-buttons">
		<NavButton on:click={() => goto('/')}>{m.nav_topPage()}</NavButton>
	</div>
</div>

<style>
	.container {
		padding: 28px 20px;
		text-align: center;
		max-width: 400px;
		margin: 0 auto;
	}
	.instruction {
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 20px;
	}
	.mode-toggle {
		display: flex;
		gap: 8px;
		margin-bottom: 20px;
		background: var(--bg-secondary);
		padding: 4px;
		border-radius: 12px;
	}
	.mode-button {
		flex: 1;
		padding: 10px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}
	.mode-button.active {
		background: white;
		color: var(--accent-primary);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 14px;
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
	.error-message {
		color: #dc3545;
		font-size: 14px;
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
		.form-container input {
			padding: 18px;
			font-size: 20px;
			letter-spacing: 0.1em;
		}
		.error-message {
			font-size: 16px;
		}
		.nav-buttons {
			margin-top: 40px;
		}
	}
</style>
