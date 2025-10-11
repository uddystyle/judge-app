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
</script>

<button
	class="nav-btn"
	class:primary={variant === 'primary'}
	class:danger={variant === 'danger'}
	{disabled}
	on:click
>
	<slot />
</button>

<style>
	.nav-btn {
		background-color: #e5e5ea;
		color: #1d1d1f;
		border: none;
		border-radius: 12px;
		padding: 15px 20px;
		font-size: 17px;
		font-weight: 600;
		cursor: pointer;
		transition: background-color 0.2s;
	}
	.nav-btn:active {
		background-color: #dcdce1;
	}

	/* Primary (青) スタイル */
	.nav-btn.primary {
		background-color: #007aff;
		color: white;
	}
	.nav-btn.primary:active {
		background-color: #0062cc;
	}

	/* Danger (赤) スタイル */
	.nav-btn.danger {
		background-color: #ff3b30;
		color: white;
	}
	.nav-btn.danger:active {
		background-color: #d93025;
	}

	/* Disabled (無効) スタイル */
	.nav-btn:disabled {
		background-color: #d2d2d7;
		color: #6e6e73;
		cursor: not-allowed;
		opacity: 0.8;
	}
	.nav-btn.primary:disabled {
		background-color: #5ca7ff;
		color: #fff;
		opacity: 0.7;
	}
</style>
