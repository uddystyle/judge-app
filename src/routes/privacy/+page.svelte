<script lang="ts">
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	// クライアントサイドでユーザー情報を取得
	let user: any = null;
	let profile: any = null;

	onMount(async () => {
		try {
			const response = await fetch('/api/me');
			const data = await response.json();
			user = data.user;
			profile = data.profile;
		} catch (error) {
			console.error('Failed to fetch user info:', error);
		}
	});
</script>

<svelte:head>
	<title>プライバシーポリシー - TENTO</title>
</svelte:head>

<Header showAppName={true} pageUser={user} pageProfile={profile} />

<div class="container">
	<div class="header-section">
		<h1 class="title">プライバシーポリシー</h1>
		<p class="updated">最終更新日: 2025年11月9日</p>
	</div>

	<div class="content">
		<section class="section">
			<h2>第1条（基本方針）</h2>
			<p>
				TENTO運営者（以下「当社」といいます）は、スキー・スノーボード検定・大会のための採点管理システム「TENTO」（以下「当サービス」といいます）において、ユーザーの個人情報の重要性を認識し、個人情報の保護に関する法律（以下「個人情報保護法」といいます）を遵守するとともに、以下のプライバシーポリシー（以下「本ポリシー」といいます）に従い、適切な取扱い及び保護に努めます。
			</p>
		</section>

		<section class="section">
			<h2>第2条（個人情報の定義）</h2>
			<p>
				「個人情報」とは、個人情報保護法第2条第1項により定義された個人情報、すなわち、生存する個人に関する情報であって、当該情報に含まれる氏名、生年月日その他の記述等により特定の個人を識別することができるもの（他の情報と容易に照合することができ、それにより特定の個人を識別することができることとなるものを含みます）、または個人識別符号が含まれるものを指します。
			</p>
		</section>

		<section class="section">
			<h2>第3条（収集する情報）</h2>
			<p>当社は、当サービスの提供にあたり、以下の情報を収集します。</p>

			<h3>3.1 ユーザーが提供する情報</h3>
			<ul>
				<li>氏名（フルネーム）</li>
				<li>メールアドレス</li>
				<li>パスワード（暗号化して保存）</li>
				<li>組織名・団体名</li>
				<li>プロフィール画像（任意）</li>
				<li>支払い情報（クレジットカード情報はStripe社が管理し、当社は保存しません）</li>
			</ul>

			<h3>3.2 サービス利用時に自動的に収集される情報</h3>
			<ul>
				<li>IPアドレス</li>
				<li>ブラウザの種類とバージョン</li>
				<li>デバイス情報（OS、デバイスタイプ）</li>
				<li>アクセス日時</li>
				<li>利用状況データ（セッション情報、採点データ等）</li>
				<li>Cookie及び類似技術により取得される情報</li>
			</ul>

			<h3>3.3 当サービスの利用により生成される情報</h3>
			<ul>
				<li>作成したセッション情報</li>
				<li>採点データ（競技者情報、スコア等）</li>
				<li>組織メンバー情報</li>
				<li>エクスポートされたデータ</li>
			</ul>
		</section>

		<section class="section">
			<h2>第4条（個人情報の利用目的）</h2>
			<p>当社は、収集した個人情報を以下の目的で利用します。</p>
			<ol>
				<li>当サービスの提供、運営、維持、改善のため</li>
				<li>ユーザー認証及びアカウント管理のため</li>
				<li>組織及びセッション管理機能の提供のため</li>
				<li>採点データの管理及びエクスポート機能の提供のため</li>
				<li>料金の請求及び決済処理のため</li>
				<li>ユーザーサポート及びお問い合わせ対応のため</li>
				<li>利用規約違反行為への対応のため</li>
				<li>当サービスに関する重要なお知らせの送信のため</li>
				<li>新機能、アップデート、キャンペーン情報の通知のため（ユーザーの同意がある場合）</li>
				<li>統計データの作成及び分析のため（個人を識別できない形式に加工）</li>
				<li>セキュリティ対策及び不正利用の防止のため</li>
				<li>法令に基づく対応のため</li>
			</ol>
		</section>

		<section class="section">
			<h2>第5条（個人情報の第三者提供）</h2>
			<p>
				当社は、以下の場合を除き、ユーザーの同意なく個人情報を第三者に提供することはありません。
			</p>
			<ol>
				<li>法令に基づく場合</li>
				<li>人の生命、身体または財産の保護のために必要がある場合であって、本人の同意を得ることが困難である場合</li>
				<li>公衆衛生の向上または児童の健全な育成の推進のために特に必要がある場合であって、本人の同意を得ることが困難である場合</li>
				<li>国の機関もしくは地方公共団体またはその委託を受けた者が法令の定める事務を遂行することに対して協力する必要がある場合であって、本人の同意を得ることにより当該事務の遂行に支障を及ぼすおそれがある場合</li>
			</ol>
		</section>

		<section class="section">
			<h2>第6条（個人情報の共同利用）</h2>
			<p>
				当社は、組織機能において、組織オーナーおよび組織メンバー間で以下の個人情報を共同利用します。
			</p>
			<ul>
				<li>氏名</li>
				<li>メールアドレス</li>
				<li>組織内での役割</li>
				<li>セッション参加履歴</li>
				<li>採点データ</li>
			</ul>
			<p>
				共同利用の目的は、組織内でのセッション管理および採点業務の円滑な実施です。共同利用の責任は、組織オーナーが負うものとします。
			</p>
		</section>

		<section class="section">
			<h2>第7条（第三者サービスの利用）</h2>
			<p>当サービスは、以下の第三者サービスを利用しています。</p>

			<h3>7.1 Supabase（認証・データベース）</h3>
			<p>
				ユーザー認証およびデータ保存のためにSupabaseを利用しています。Supabaseのプライバシーポリシーは<a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer">こちら</a>をご確認ください。
			</p>

			<h3>7.2 Stripe（決済処理）</h3>
			<p>
				有料プランの決済処理のためにStripeを利用しています。クレジットカード情報は当社のサーバーを経由せず、Stripeが直接処理・保管します。Stripeのプライバシーポリシーは<a href="https://stripe.com/jp/privacy" target="_blank" rel="noopener noreferrer">こちら</a>をご確認ください。
			</p>

			<h3>7.3 分析ツール</h3>
			<p>
				サービスの改善のため、アクセス解析ツールを使用する場合があります。これらのツールは、Cookieを使用してユーザーの行動を分析します。
			</p>
		</section>

		<section class="section">
			<h2>第8条（Cookieおよび類似技術）</h2>
			<p>
				当サービスは、サービスの利便性向上およびセキュリティ確保のため、Cookie及び類似の技術を使用します。Cookieとは、ウェブサイトがユーザーのブラウザに送信する小さなテキストファイルです。
			</p>

			<h3>8.1 Cookieの利用目的</h3>
			<ul>
				<li>ログイン状態の維持</li>
				<li>セキュリティの確保</li>
				<li>サービスの利便性向上</li>
				<li>アクセス解析</li>
			</ul>

			<h3>8.2 Cookieの無効化</h3>
			<p>
				ユーザーは、ブラウザの設定によりCookieを無効化することができます。ただし、Cookieを無効化した場合、当サービスの一部機能が利用できなくなる可能性があります。
			</p>
		</section>

		<section class="section">
			<h2>第9条（個人情報の安全管理）</h2>
			<p>
				当社は、個人情報の紛失、破壊、改ざん及び漏洩等のリスクに対して、以下のセキュリティ対策を講じます。
			</p>
			<ul>
				<li>SSL/TLS暗号化通信の使用</li>
				<li>パスワードの暗号化保存</li>
				<li>定期的なセキュリティアップデート</li>
				<li>アクセス制限及び権限管理</li>
				<li>不正アクセスの監視</li>
				<li>従業員への教育・監督</li>
			</ul>
		</section>

		<section class="section">
			<h2>第10条（個人情報の保存期間）</h2>
			<p>
				当社は、個人情報を利用目的の達成に必要な期間に限り保存します。各プランの保存期間は以下のとおりです。
			</p>
			<ul>
				<li>フリープラン: 3ヶ月</li>
				<li>Basicプラン: 12ヶ月</li>
				<li>Standardプラン: 24ヶ月</li>
				<li>Premiumプラン: 無制限</li>
			</ul>
			<p>
				アカウントを削除した場合、個人情報は速やかに削除されます。組織を削除した場合も、当該組織に紐づく個人情報およびデータは速やかに削除され、復元できません。ただし、法令により保存が義務付けられている情報については、所定の期間保存します。
			</p>
		</section>

		<section class="section">
			<h2>第11条（ユーザーの権利）</h2>
			<p>ユーザーは、自己の個人情報について、以下の権利を有します。</p>
			<ol>
				<li>開示請求権: 当社が保有する個人情報の開示を請求することができます</li>
				<li>訂正・追加・削除請求権: 個人情報の訂正、追加または削除を請求することができます</li>
				<li>利用停止請求権: 個人情報の利用停止を請求することができます</li>
				<li>第三者提供の停止請求権: 第三者への提供の停止を請求することができます</li>
			</ol>
			<p>
				これらの請求を希望される場合は、お問い合わせフォームよりご連絡ください。請求内容を確認の上、合理的な期間内に対応いたします。
			</p>
		</section>

		<section class="section">
			<h2>第12条（個人情報の開示・訂正等）</h2>
			<p>
				ユーザーは、当サービスのアカウント設定画面から、いつでも自己の個人情報を確認・変更することができます。また、アカウントの削除により、個人情報を削除することができます。組織の削除により、当該組織に紐づく個人情報およびデータを削除することもできます。
			</p>
		</section>

		<section class="section">
			<h2>第13条（未成年者の個人情報）</h2>
			<p>
				当サービスは、18歳未満の方の利用を想定していません。18歳未満の方が当サービスを利用される場合は、保護者の同意を得た上でご利用ください。
			</p>
		</section>

		<section class="section">
			<h2>第14条（プライバシーポリシーの変更）</h2>
			<ol>
				<li>
					当社は、本ポリシーを変更することがあります。変更後のプライバシーポリシーは、当サービス上に掲示した時点から効力を生じるものとします。
				</li>
				<li>
					重要な変更がある場合は、当サービス上での告知またはメールにてユーザーに通知します。
				</li>
				<li>
					変更後も当サービスを継続して利用することにより、変更後のプライバシーポリシーに同意したものとみなされます。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第15条（お問い合わせ窓口）</h2>
			<p>
				本ポリシーに関するお問い合わせ、個人情報の開示・訂正・削除等のご請求は、当サービスのお問い合わせフォームよりご連絡ください。
			</p>
			<p>
				お問い合わせフォーム: <a href="/contact">/contact</a>
			</p>
		</section>

		<section class="section">
			<h2>第16条（適用法令と管轄裁判所）</h2>
			<p>
				本ポリシーの解釈および適用は、日本法に準拠します。本ポリシーに関する紛争については、当社の本店所在地を管轄する裁判所を専属的合意管轄裁判所とします。
			</p>
		</section>
	</div>

	<div class="back-section">
		<button class="back-btn" on:click={() => goto('/')}>トップページに戻る</button>
	</div>
</div>

<Footer />

<style>
	.container {
		padding: 28px 20px;
		max-width: 900px;
		margin: 0 auto;
		min-height: calc(100vh - 200px);
	}

	.header-section {
		text-align: center;
		margin-bottom: 48px;
	}

	.title {
		font-size: 32px;
		font-weight: 700;
		margin-bottom: 12px;
		color: var(--primary-text);
	}

	.updated {
		font-size: 14px;
		color: var(--secondary-text);
	}

	.content {
		background: white;
		border-radius: 16px;
		padding: 32px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		margin-bottom: 32px;
	}

	.section {
		margin-bottom: 40px;
	}

	.section:last-child {
		margin-bottom: 0;
	}

	.section h2 {
		font-size: 20px;
		font-weight: 700;
		color: var(--primary-text);
		margin-bottom: 16px;
		padding-bottom: 8px;
		border-bottom: 2px solid var(--accent-primary);
	}

	.section h3 {
		font-size: 17px;
		font-weight: 600;
		color: var(--primary-text);
		margin-top: 20px;
		margin-bottom: 12px;
	}

	.section p {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin-bottom: 12px;
	}

	.section ol {
		padding-left: 24px;
		margin-bottom: 12px;
	}

	.section ol li {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin-bottom: 12px;
	}

	.section ul {
		padding-left: 24px;
		margin-top: 8px;
		margin-bottom: 12px;
	}

	.section ul li {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin-bottom: 8px;
	}

	.section a {
		color: var(--ios-blue);
		text-decoration: none;
		border-bottom: 1px solid var(--ios-blue);
		transition: all 0.2s;
	}

	.section a:hover {
		color: #0051d5;
		border-bottom-color: #0051d5;
	}

	.back-section {
		text-align: center;
		margin-bottom: 32px;
	}

	.back-btn {
		background: white;
		color: var(--ios-blue);
		border: 2px solid var(--ios-blue);
		border-radius: 10px;
		padding: 14px 32px;
		font-size: 16px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.back-btn:hover {
		background: var(--ios-blue);
		color: white;
	}

	@media (max-width: 768px) {
		.title {
			font-size: 24px;
		}

		.content {
			padding: 24px 20px;
		}

		.section h2 {
			font-size: 18px;
		}

		.section h3 {
			font-size: 16px;
		}

		.section p,
		.section ol li,
		.section ul li {
			font-size: 14px;
		}
	}
</style>
