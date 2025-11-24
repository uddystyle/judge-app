<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	export let data: PageData;
</script>

<Header
	showAppName={true}
	pageUser={data.user}
	pageProfile={data.profile}
	hasOrganization={data.organizations && data.organizations.length > 0}
	pageOrganizations={data.organizations || []}
/>

<div class="container">
	<h1 class="page-title">セッションモードについて</h1>
	<p class="page-description">
		TENTOでは、用途に応じて3つのモードからセッションを作成できます。<br />
		それぞれの特徴を理解して、目的に合ったモードを選択してください。
	</p>

	<!-- モードカード -->
	<div class="mode-cards">
		<!-- 検定モード -->
		<div class="mode-card">
			<div class="mode-header">
				<h2 class="mode-title">検定モード</h2>
			</div>
			<p class="mode-description">
				既定の種目・レベルで検定を実施するモードです。
			</p>
			<div class="mode-features">
				<h3>主な特徴</h3>
				<ul>
					<li>既定の種目・レベルから選択</li>
					<li>個別採点・合同採点の両方に対応</li>
					<li>平均値で採点結果を算出</li>
					<li>シンプルで使いやすい</li>
				</ul>
			</div>
			<div class="mode-usage">
				<h3>こんな時に使います</h3>
				<p>バッジテスト</p>
			</div>
		</div>

		<!-- 大会モード -->
		<div class="mode-card">
			<div class="mode-header">
				<h2 class="mode-title">大会モード</h2>
			</div>
			<p class="mode-description">
				複数の検定員で公式な採点を行い、正確な順位を決定するモードです。
			</p>
			<div class="mode-features">
				<h3>主な特徴</h3>
				<ul>
					<li>カスタム種目を自由に設定</li>
					<li>3審3採 または 5審3採 に対応</li>
					<li>複数検定員必須（3名または5名）</li>
					<li>合計点または平均点で順位決定</li>
					<li>参加者（選手）情報の登録が可能</li>
				</ul>
			</div>
			<div class="mode-usage">
				<h3>こんな時に使います</h3>
				<p>公式大会、コンテスト、競技会</p>
			</div>
		</div>

		<!-- 研修モード -->
		<div class="mode-card">
			<div class="mode-header">
				<h2 class="mode-title">研修モード</h2>
			</div>
			<p class="mode-description">
				検定員同士で採点を比較し、採点基準のすり合わせを行うモードです。
			</p>
			<div class="mode-features">
				<h3>主な特徴</h3>
				<ul>
					<li>カスタム種目を自由に設定</li>
					<li>個別採点・合同採点の両方に対応</li>
					<li>最大100名の検定員が参加可能</li>
					<li>採点結果を集計せず、個別に表示</li>
					<li>検定員同士で相互に採点を比較</li>
				</ul>
			</div>
			<div class="mode-usage">
				<h3>こんな時に使います</h3>
				<p>検定員研修、採点練習、基準のすり合わせ</p>
			</div>
		</div>
	</div>

	<!-- 比較表 -->
	<div class="comparison-section">
		<h2 class="section-title">モード比較表</h2>
		<div class="table-wrapper">
			<table class="comparison-table">
				<thead>
					<tr>
						<th>項目</th>
						<th>検定モード</th>
						<th>大会モード</th>
						<th>研修モード</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td class="label">種目設定</td>
						<td>既定の種目</td>
						<td>カスタム種目</td>
						<td>カスタム種目</td>
					</tr>
					<tr>
						<td class="label">複数検定員モード</td>
						<td>選択可能（ON/OFF）</td>
						<td>常にON（必須）</td>
						<td>選択可能（ON/OFF）</td>
					</tr>
					<tr>
						<td class="label">採点方法</td>
						<td>平均値</td>
						<td>3審3採 / 5審3採</td>
						<td>集計なし（個別表示）</td>
					</tr>
					<tr>
						<td class="label">検定員数</td>
						<td>制限なし</td>
						<td>3名または5名</td>
						<td>最大100名</td>
					</tr>
					<tr>
						<td class="label">参加者管理</td>
						<td>なし</td>
						<td>選手情報を登録可能</td>
						<td>なし</td>
					</tr>
					<tr>
						<td class="label">結果の集計</td>
						<td>平均点を算出</td>
						<td>合計点/平均点で順位決定</td>
						<td>集計せず比較のみ</td>
					</tr>
				</tbody>
			</table>
		</div>
	</div>

	<!-- 戻るボタン -->
	<div class="nav-buttons">
		<button class="back-btn" on:click={() => goto('/dashboard')}>
			ダッシュボードに戻る
		</button>
	</div>
</div>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		max-width: 1000px;
		margin: 0 auto;
	}

	.page-title {
		font-size: 28px;
		font-weight: 700;
		color: var(--text-primary);
		text-align: center;
		margin-bottom: 16px;
	}

	.page-description {
		font-size: 15px;
		color: var(--text-secondary);
		text-align: center;
		line-height: 1.6;
		margin-bottom: 40px;
	}

	/* モードカード */
	.mode-cards {
		display: grid;
		grid-template-columns: 1fr;
		gap: 24px;
		margin-bottom: 48px;
	}

	.mode-card {
		background: white;
		border: 1px solid var(--border-light);
		border-radius: 12px;
		padding: 24px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}

	.mode-header {
		margin-bottom: 12px;
	}

	.mode-title {
		font-size: 22px;
		font-weight: 700;
		color: var(--text-primary);
		margin: 0;
	}

	.mode-description {
		font-size: 15px;
		color: var(--text-secondary);
		line-height: 1.6;
		margin-bottom: 20px;
	}

	.mode-features,
	.mode-usage {
		margin-bottom: 16px;
	}

	.mode-features h3,
	.mode-usage h3 {
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 8px;
	}

	.mode-features ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.mode-features li {
		font-size: 14px;
		color: var(--text-secondary);
		padding: 6px 0;
		padding-left: 20px;
		position: relative;
	}

	.mode-features li::before {
		content: '✓';
		position: absolute;
		left: 0;
		color: var(--accent-primary);
		font-weight: 600;
	}

	.mode-usage p {
		font-size: 14px;
		color: var(--text-secondary);
		margin: 0;
	}

	/* 比較表 */
	.comparison-section {
		margin-bottom: 40px;
	}

	.section-title {
		font-size: 22px;
		font-weight: 700;
		color: var(--text-primary);
		text-align: center;
		margin-bottom: 24px;
	}

	.table-wrapper {
		overflow-x: auto;
		border-radius: 12px;
		border: 1px solid var(--border-light);
	}

	.comparison-table {
		width: 100%;
		border-collapse: collapse;
		background: white;
	}

	.comparison-table th {
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 14px;
		font-weight: 600;
		padding: 14px;
		text-align: left;
		border-bottom: 2px solid var(--border-medium);
	}

	.comparison-table td {
		padding: 14px;
		font-size: 14px;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--border-light);
	}

	.comparison-table td.label {
		font-weight: 600;
		color: var(--text-primary);
	}

	.comparison-table tbody tr:last-child td {
		border-bottom: none;
	}

	/* ナビゲーション */
	.nav-buttons {
		display: flex;
		justify-content: center;
		margin-top: 40px;
	}

	.back-btn {
		background: var(--accent-primary);
		color: white;
		border: none;
		border-radius: 10px;
		padding: 14px 32px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s ease;
		min-height: 48px;
	}

	.back-btn:hover {
		background: var(--accent-hover);
		transform: translateY(-1px);
	}

	.back-btn:active {
		background: var(--accent-active);
		transform: translateY(0);
	}

	/* タブレット以上 */
	@media (min-width: 768px) {
		.container {
			padding: 60px 40px;
		}

		.page-title {
			font-size: 32px;
			margin-bottom: 20px;
		}

		.page-description {
			font-size: 16px;
			margin-bottom: 56px;
		}

		.mode-cards {
			grid-template-columns: repeat(3, 1fr);
			gap: 32px;
			margin-bottom: 64px;
		}

		.mode-card {
			padding: 28px;
		}

		.comparison-table th,
		.comparison-table td {
			padding: 16px;
			font-size: 15px;
		}

		.section-title {
			font-size: 26px;
			margin-bottom: 32px;
		}
	}

	/* デスクトップ */
	@media (min-width: 1024px) {
		.page-title {
			font-size: 36px;
		}

		.mode-cards {
			gap: 40px;
		}
	}
</style>
