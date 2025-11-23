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

	/* Primary - Black filled button */
	.nav-btn.primary {
		background-color: var(--accent-primary);
		color: white;
		border-color: var(--accent-primary);
	}

	.nav-btn.primary:hover:not(:disabled) {
		background-color: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	.nav-btn.primary:active:not(:disabled) {
		background-color: var(--accent-active);
	}

	/* Danger - Red background for destructive actions */
	.nav-btn.danger {
		background-color: #dc3545;
		color: white;
		border-color: #dc3545;
	}

	.nav-btn.danger:hover:not(:disabled) {
		background-color: #c82333;
		border-color: #c82333;
	}

	.nav-btn.danger:active:not(:disabled) {
		background-color: #bd2130;
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
