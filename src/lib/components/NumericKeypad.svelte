<script lang="ts">
	import { createEventDispatcher } from 'svelte';

	type KeypadEvent = {
		input: string;
		clear: void;
		confirm: void;
	};

	const dispatch = createEventDispatcher<KeypadEvent>();
</script>

<div class="numeric-keypad">
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '7')}>7</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '8')}>8</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '9')}>9</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '4')}>4</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '5')}>5</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '6')}>6</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '1')}>1</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '2')}>2</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '3')}>3</button>
	<button type="button" class="numeric-key" on:click={() => dispatch('input', '0')}>0</button>

	<button type="button" class="numeric-key spacer" aria-label="spacer" tabindex="-1"></button>

	<button type="button" class="numeric-key clear" on:click={() => dispatch('clear')}>C</button>

	<button type="button" class="numeric-key confirm" on:click={() => dispatch('confirm')}
		>確定</button
	>
</div>

<style>
	.numeric-keypad {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		width: 100%;
		max-width: 100%;
		margin: 24px auto;
	}
	.numeric-key {
		background: #ffffff;
		border: none;
		border-radius: 18px;
		font-size: 32px;
		font-weight: 500;
		height: 80px;
		cursor: pointer;
		transition: all 0.2s;
		color: var(--primary-text);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}
	.numeric-key:active {
		transform: translateY(1px);
		background: #f0f0f0;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
	}
	.numeric-key.confirm {
		background: var(--ios-green);
		color: white;
		grid-column: span 3;
	}
	.numeric-key.confirm:active {
		background: #24993e;
	}
	.numeric-key.clear {
		background: var(--ios-red);
		color: white;
	}
	.numeric-key.clear:active {
		background: #d93025;
	}
	.numeric-key.spacer {
		background: transparent;
		border: none;
		cursor: default;
		box-shadow: none;
	}
	.numeric-key.spacer:hover,
	.numeric-key.spacer:active {
		background: transparent;
		transform: none;
	}
</style>
