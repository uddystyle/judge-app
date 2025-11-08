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
		background-color: var(--bg-white);
		color: var(--text-primary);
		border: 2px solid var(--border-light);
		border-radius: 12px;
		padding: 15px 20px;
		font-size: 17px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}
	.nav-btn:active {
		transform: scale(0.98);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
	}

	/* Primary (オレンジ) スタイル */
	.nav-btn.primary {
		background: linear-gradient(135deg, var(--primary-orange) 0%, var(--primary-orange-light) 100%);
		color: white;
		border-color: var(--primary-orange);
		box-shadow: 0 4px 12px rgba(255, 107, 53, 0.3);
	}
	.nav-btn.primary:active {
		box-shadow: 0 2px 8px rgba(255, 107, 53, 0.3);
	}

	/* Danger (赤) スタイル */
	.nav-btn.danger {
		background-color: #ff3b30;
		color: white;
		border-color: #ff3b30;
	}
	.nav-btn.danger:active {
		background-color: #d93025;
	}

	/* Disabled (無効) スタイル */
	.nav-btn:disabled {
		background-color: var(--border-gray);
		color: var(--text-muted);
		border-color: var(--border-gray);
		cursor: not-allowed;
		opacity: 0.6;
		box-shadow: none;
	}
	.nav-btn.primary:disabled {
		background: var(--border-gray);
		border-color: var(--border-gray);
		opacity: 0.6;
	}
</style>
