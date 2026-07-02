<script lang="ts">
	/**
	 * ボタンの見た目を指定します。
	 * 'primary' (青), 'danger' (赤), 'default' (グレー)
	 * @type {'primary' | 'danger' | 'default'}
	 */
	export let variant: 'primary' | 'danger' | 'default' = 'default';

	/**
	 * ボタンを無効にするかどうかを指定します。
	 * @type {boolean}
	 */
	export let disabled: boolean = false;

	/**
	 * ボタンのタイプを指定します。
	 * デフォルトは 'button' (意図しないフォーム送信を防ぐため)
	 * @type {'button' | 'submit' | 'reset'}
	 */
	export let type: 'button' | 'submit' | 'reset' = 'button';
</script>

<button
	class="nav-btn"
	class:primary={variant === 'primary'}
	class:danger={variant === 'danger'}
	{type}
	{disabled}
	on:click
	{...$$restProps}
>
	<slot />
</button>

<style>
	.nav-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		background-color: var(--bg-primary);
		color: var(--text-primary);
		border: 1.5px solid var(--border-medium);
		border-radius: 8px;
		padding: 14px 24px;
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		box-shadow: none;
		letter-spacing: -0.01em;
		min-height: 44px;
	}

	.nav-btn:hover:not(:disabled) {
		background-color: var(--bg-hover);
		border-color: var(--border-dark);
	}

	.nav-btn:active:not(:disabled) {
		transform: scale(0.98);
		background-color: var(--gray-200);
	}

	/* Primary - Gradient filled button */
	.nav-btn.primary {
		background: var(--accent);
		color: white;
		border: none;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.nav-btn.primary:hover:not(:disabled) {
		background: var(--accent-hover);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		transform: translateY(-1px);
	}

	.nav-btn.primary:active:not(:disabled) {
		background: var(--accent-active);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
		transform: translateY(0) scale(0.98);
	}

	/* Danger - Red background for destructive actions */
	.nav-btn.danger {
		background-color: var(--color-error);
		color: white;
		border-color: var(--color-error);
	}

	.nav-btn.danger:hover:not(:disabled) {
		background-color: var(--color-error);
		border-color: var(--color-error);
	}

	.nav-btn.danger:active:not(:disabled) {
		background-color: var(--color-error);
	}

	/* Disabled state */
	.nav-btn:disabled {
		background-color: var(--gray-100);
		color: var(--text-disabled);
		border-color: var(--gray-200);
		cursor: not-allowed;
		opacity: 0.5;
	}
</style>
