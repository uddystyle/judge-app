<script lang="ts">
	import NumericKeypad from '$lib/components/NumericKeypad.svelte';
	import NavButton from '$lib/components/NavButton.svelte';
	import Header from '$lib/components/Header.svelte';
	import { page } from '$app/stores';
	import { getContext } from 'svelte';
	import type { SupabaseClient } from '@supabase/supabase-js';
	import { goto } from '$app/navigation';
	import { currentBib, userProfile, currentSession } from '$lib/stores';
	import { get } from 'svelte/store';

	// レイアウトから共有されたSupabaseクライアントを受け取る
	const supabase = getContext<SupabaseClient>('supabase');

	let currentScore = '';
	let loading = false;

	// キーパッドから数字が入力されたときの処理
	function handleInput(event: CustomEvent<string>) {
		const num = event.detail;
		if (currentScore.length < 2) {
			currentScore = currentScore === '0' && num !== '0' ? num : currentScore + num;
		}
	}

	function handleClear() {
		currentScore = '';
	}

	async function handleConfirm() {
		const score = parseInt(currentScore, 10) || 0;
		if (score < 0 || score > 99) {
			alert('得点は0～99の範囲で入力してください');
			return;
		}

		loading = true;
		// URLからパラメータを取得
		const { id, discipline, level, event } = $page.params;

		const bib = $currentBib;
		const profile = get(userProfile);
		const sessionDetails = get(currentSession);

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
			judge_name: profile?.full_name || user?.email,
			discipline: discipline,
			level: level,
			event_name: event
		});

		if (error) {
			alert('得点の送信に失敗しました: ' + error.message);
		} else {
			if (sessionDetails?.is_multi_judge) {
				goto(`/session/${id}/${discipline}/${level}/${event}/score/status?bib=${bib}`);
			} else {
				goto(
					`/session/${id}/${discipline}/${level}/${event}/score/complete?bib=${bib}&score=${score}`
				);
			}
		}
		loading = false;
	}
</script>

<Header />

<div class="container">
	<div class="instruction">得点を入力してください</div>

	<div class="numeric-display">{currentScore || '0'}</div>

	<NumericKeypad on:input={handleInput} on:clear={handleClear} on:confirm={handleConfirm} />

	<div class="nav-buttons">
		<NavButton on:click={() => window.history.back()}>ゼッケン入力を修正</NavButton>
	</div>
</div>

<style>
	/* ゼッケン入力ページからスタイルをコピー */
	.container,
	.instruction,
	.numeric-display,
	.nav-buttons {
		padding: 28px 20px;
		text-align: center;
		font-size: 24px;
		font-weight: 700;
		margin-bottom: 28px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: 28px;
	}
	.instruction,
	.numeric-display {
		margin-top: 0;
		margin-bottom: 0;
	}
	.numeric-display {
		font-size: 48px;
		min-height: 80px;
		align-items: center;
		justify-content: center;
	}
</style>
