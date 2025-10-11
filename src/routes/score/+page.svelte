<script lang="ts">
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import { userProfile, currentBib } from '$lib/stores';
	import { get } from 'svelte/store';
	import { page } from '$app/stores';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { getContext } from 'svelte';
	import { goto } from '$app/navigation';

	const supabase = getContext<SupabaseClient>('supabase');

	let currentScore = ''; // 得点を保持する変数
	let loading = false;

	// NumericKeypadからの'input'イベントを処理する関数
	function handleInput(event: CustomEvent<string>) {
		const num = event.detail;
		if (currentScore.length < 2) {
			currentScore = currentScore === '0' && num !== '0' ? num : currentScore + num;
			if (parseInt(currentScore) > 99) currentScore = '99';
		}
	}

	// NumericKeypadからの'clear'イベントを処理する関数
	function handleClear() {
		currentScore = '';
	}

	// NumericKeypadからの'confirm'イベントを処理する関数
	async function handleConfirm() {
		const score = parseInt(currentScore, 10) || 0;
		if (score < 0 || score > 99) {
			alert('得点は0-99の範囲で入力してください');
			return;
		}

		loading = true;
		const { id, discipline, level, event } = $page.params;

		// get() を使ってストアから現在の値を取得
		const bib = get(currentBib);
		const profile = get(userProfile);

		if (!bib) {
			alert('ゼッケン番号がありません。前のページに戻って再入力してください。');
			loading = false;
			return;
		}

		const {
			data: { user }
		} = await supabase.auth.getUser();

		const { error } = await supabase.from('results').upsert({
			session_id: id,
			bib: bib,
			score: score,
			// 氏名保存の解決策: profileストアのfull_nameを優先的に使用
			judge_name: profile?.full_name || user?.email,
			discipline: discipline,
			level: level,
			event_name: event
		});

		if (error) {
			alert('得点の送信に失敗しました: ' + error.message);
		} else {
			goto(
				`/session/${id}/${discipline}/${level}/${event}/score/complete?bib=${bib}&score=${score}`
			);
		}
		loading = false;
	}
</script>

<div class="numeric-display">{currentScore || '0'}</div>

<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} />

<style>
	/* このページ専用のスタイル */
	.numeric-display {
		background: transparent;
		border: none;
		font-size: 48px;
		font-weight: 600;
		padding: 20px;
		margin: 0;
		min-height: 80px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--primary-text);
	}
</style>
