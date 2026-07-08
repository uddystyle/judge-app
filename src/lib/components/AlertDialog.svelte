<script lang="ts">
	import ConfirmDialog from './ConfirmDialog.svelte';
	import * as m from '$lib/paraglide/messages.js';

	// 通知専用ダイアログ。実体は ConfirmDialog（showCancel=false）の薄いラッパー
	export let isOpen = false;
	export let title: string = m.dialog_notification();
	export let message = '';
	export let confirmText: string = m.common_ok();
</script>

<ConfirmDialog bind:isOpen {title} {message} {confirmText} showCancel={false} on:confirm />
