<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	export let isOpen = false;
	export let title = '通知';
	export let message = '';
	export let confirmText = 'OK';

	const dispatch = createEventDispatcher();

	function handleConfirm() {
		dispatch('confirm');
		isOpen = false;
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			handleConfirm();
		}
	}
</script>

{#if isOpen}
	<div class="dialog-backdrop" on:click={handleBackdropClick} role="presentation">
		<div class="dialog-container" role="alertdialog" aria-labelledby="dialog-title" aria-modal="true">
			<div class="dialog-header">
				<h2 id="dialog-title" class="dialog-title">{title}</h2>
			</div>
			<div class="dialog-body">
				<p class="dialog-message">{message}</p>
			</div>
			<div class="dialog-footer">
				<button class="dialog-btn confirm-btn" on:click={handleConfirm}>
					{confirmText}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.dialog-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 9999;
		padding: 20px;
	}

	.dialog-container {
		background: var(--bg-primary);
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
		max-width: 400px;
		width: 100%;
		overflow: hidden;
		animation: slideIn 0.2s ease-out;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.dialog-header {
		padding: 20px 24px;
		border-bottom: 1px solid var(--border-light);
	}

	.dialog-title {
		font-size: 18px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
		letter-spacing: -0.01em;
	}

	.dialog-body {
		padding: 24px;
	}

	.dialog-message {
		font-size: 15px;
		color: var(--text-primary);
		line-height: 1.6;
		margin: 0;
		letter-spacing: -0.01em;
		white-space: pre-line;
	}

	.dialog-footer {
		padding: 16px 24px;
		display: flex;
		justify-content: flex-end;
		border-top: 1px solid var(--border-light);
	}

	.dialog-btn {
		padding: 10px 20px;
		border-radius: 8px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		border: none;
		letter-spacing: -0.01em;
		min-width: 80px;
	}

	.confirm-btn {
		background: linear-gradient(135deg, #404040 0%, #262626 100%);
		color: white;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.confirm-btn:hover {
		background: linear-gradient(135deg, #525252 0%, #404040 100%);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		transform: translateY(-1px);
	}

	.confirm-btn:active {
		background: linear-gradient(135deg, #404040 0%, #262626 100%);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
		transform: translateY(0) scale(0.98);
	}

	/* PC対応: タブレット以上 */
	@media (min-width: 768px) {
		.dialog-container {
			max-width: 480px;
		}

		.dialog-header {
			padding: 24px 28px;
		}

		.dialog-title {
			font-size: 20px;
		}

		.dialog-body {
			padding: 28px;
		}

		.dialog-message {
			font-size: 16px;
		}

		.dialog-footer {
			padding: 20px 28px;
		}

		.dialog-btn {
			padding: 12px 24px;
			font-size: 16px;
		}
	}
</style>
