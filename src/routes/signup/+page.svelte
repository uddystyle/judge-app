<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages.js';

	export let form: ActionData;
	let loading = false;
</script>

<Header showAppName={true} pageUser={null} />

<div class="container">
	{#if form?.success}
		<div class="instruction">{m.auth_confirmEmailSent()}</div>
		<div class="success-container">
			<p class="success-message">
				{m.auth_confirmEmailDescription()}
			</p>
			<p class="info-message">
				{m.auth_emailCheckSpam()}
			</p>
		</div>
		<div class="nav-buttons">
			<NavButton on:click={() => goto('/login')}>{m.auth_loginScreen()}</NavButton>
			<NavButton on:click={() => goto('/')}>{m.nav_topPage()}</NavButton>
		</div>
	{:else}
		<div class="instruction">{m.auth_signupTitle()}</div>

		<form
			method="POST"
			action="?/signup"
			use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					await update();
					loading = false;
				};
			}}
		>
			<div class="form-container">
				<input
					type="text"
					name="fullName"
					placeholder={m.auth_name()}
					autocomplete="name"
					value={form?.fullName ?? ''}
					required
				/>
				<input
					type="email"
					name="email"
					placeholder={m.auth_email()}
					autocomplete="email"
					value={form?.email ?? ''}
					required
				/>
				<input
					type="password"
					name="password"
					placeholder={m.auth_passwordPlaceholder()}
					autocomplete="new-password"
					required
				/>

				{#if form?.error}
					<p class="error-message">{form.error}</p>
				{/if}

				<div class="nav-buttons">
					<NavButton variant="primary" type="submit" disabled={loading}>
						{#if loading}
							<span style="display: inline-flex; align-items: center; gap: 8px;">
								{m.auth_registering()}
								<LoadingSpinner size="small" inline={true} />
							</span>
						{:else}
							{m.auth_register()}
						{/if}
					</NavButton>
				</div>
			</div>
		</form>

		<div class="nav-buttons">
			<NavButton on:click={() => goto('/login')}>{m.auth_loginScreen()}</NavButton>
			<NavButton on:click={() => goto('/')}>{m.nav_topPage()}</NavButton>
		</div>
	{/if}
</div>

<style>
	.container {
		padding: 50px 20px 60px;
		text-align: center;
		max-width: 440px;
		margin: 0 auto;
		min-height: calc(100vh - 80px);
	}
	.instruction {
		font-size: 32px;
		font-weight: 700;
		color: var(--text-primary);
		margin-bottom: 40px;
	}
	.form-container {
		display: flex;
		flex-direction: column;
		gap: 16px;
		background: var(--bg-primary);
		padding: 32px;
		border-radius: 20px;
		border: 2px solid var(--border-light);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
		margin-bottom: 16px;
	}
	.form-container input {
		padding: 16px;
		font-size: 17px;
		border: 2px solid var(--border-light);
		border-radius: 12px;
		background: var(--bg-primary);
		color: var(--text-primary);
		transition: all 0.2s;
	}
	.form-container input:focus {
		outline: none;
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 3px rgba(255, 107, 53, 0.1);
	}
	.nav-buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 8px;
	}
	.error-message {
		color: #dc3545;
		font-size: 14px;
		margin: 0;
		padding: 12px;
		background: #fff5f5;
		border-radius: 8px;
		border: 1px solid #ffdddd;
	}
	.success-container {
		background: var(--bg-primary);
		padding: 32px;
		border-radius: 20px;
		border: 2px solid var(--border-light);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
		margin-bottom: 16px;
	}
	.success-message {
		font-size: 16px;
		color: var(--text-primary);
		line-height: 1.6;
		margin: 0 0 20px 0;
	}
	.info-message {
		font-size: 14px;
		color: var(--text-secondary);
		margin: 0;
		padding: 12px;
		background: var(--bg-secondary);
		border-radius: 8px;
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
			max-width: 500px;
		}
		.instruction {
			font-size: 36px;
			margin-bottom: 40px;
		}
		.form-container {
			padding: 40px;
			gap: 20px;
		}
		.form-container input {
			padding: 18px;
			font-size: 18px;
		}
		.error-message {
			font-size: 15px;
			padding: 14px;
		}
		.success-container {
			padding: 40px;
		}
		.success-message {
			font-size: 18px;
			margin: 0 0 24px 0;
		}
		.info-message {
			font-size: 15px;
			padding: 14px;
		}
	}
</style>
