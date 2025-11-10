<script lang="ts">
	import type { PageData } from './$types';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { goto } from '$app/navigation';

	export let data: PageData;
</script>

<svelte:head>
	<title>利用規約 - TENTO</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@500;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<Header showAppName={true} pageUser={data.user} pageProfile={data.profile} />

<div class="container">
	<div class="header-section">
		<h1 class="title">利用規約</h1>
		<p class="updated">最終更新日: 2025年11月9日</p>
	</div>

	<div class="content">
		<section class="section">
			<h2>第1条（適用）</h2>
			<ol>
				<li>
					本利用規約（以下「本規約」といいます）は、TENTO（以下「当サービス」といいます）の利用に関する条件を、当サービスを提供する運営者（以下「当社」といいます）と利用者（以下「ユーザー」といいます）との間で定めるものです。
				</li>
				<li>
					ユーザーは、本規約に同意した上で、当サービスを利用するものとします。
				</li>
				<li>
					ユーザーが当サービスを利用した場合、本規約の内容を承諾したものとみなします。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第2条（定義）</h2>
			<p>本規約において使用する用語の定義は、以下のとおりとします。</p>
			<ol>
				<li>「当サービス」とは、当社が提供するスキー・スノーボード検定・大会のための採点管理システム「TENTO」を意味します。</li>
				<li>「ユーザー」とは、本規約に同意の上、当サービスを利用する個人または法人を意味します。</li>
				<li>「組織」とは、ユーザーが当サービス上で作成・管理するスキークラブ、スクール、団体等の単位を意味します。</li>
				<li>「組織メンバー」とは、組織に所属するユーザーを意味します。</li>
				<li>「セッション」とは、検定や大会などの採点イベントの単位を意味します。</li>
				<li>「登録情報」とは、ユーザーが当サービスに登録した氏名、メールアドレス、その他の情報を意味します。</li>
			</ol>
		</section>

		<section class="section">
			<h2>第3条（アカウント登録）</h2>
			<ol>
				<li>
					当サービスの利用を希望する者は、本規約を遵守することに同意し、当社が定める方法によりアカウント登録を申請するものとします。
				</li>
				<li>
					当社は、前項に基づき登録を申請した者（以下「登録申請者」といいます）が、以下の各号のいずれかの事由に該当する場合は、登録を拒否することがあります。
					<ul>
						<li>本規約に違反するおそれがあると当社が判断した場合</li>
						<li>登録申請者が過去に本規約違反等により、アカウント停止等の措置を受けたことがある場合</li>
						<li>登録申請に際して虚偽の事項を申告した場合</li>
						<li>その他、当社が登録を適当でないと判断した場合</li>
					</ul>
				</li>
				<li>
					ユーザーは、登録情報に変更があった場合、速やかに変更後の情報に更新するものとします。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第4条（アカウント管理）</h2>
			<ol>
				<li>
					ユーザーは、自己の責任において、アカウント情報（ユーザーID、パスワード等）を管理するものとします。
				</li>
				<li>
					ユーザーは、アカウント情報を第三者に利用させ、または貸与、譲渡、売買、質入等をしてはならないものとします。
				</li>
				<li>
					アカウント情報の管理不十分、使用上の過誤、第三者の使用等による損害の責任はユーザーが負うものとし、当社は一切の責任を負いません。
				</li>
				<li>
					ユーザーは、アカウント情報が盗まれたり、第三者に使用されていることが判明した場合には、直ちに当社にその旨を連絡するとともに、当社の指示に従うものとします。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第5条（組織とメンバー管理）</h2>
			<ol>
				<li>
					ユーザーは、当サービス上で組織を作成し、他のユーザーを組織メンバーとして招待することができます。
				</li>
				<li>
					組織を作成したユーザー（以下「組織オーナー」といいます）は、組織の管理責任を負うものとします。
				</li>
				<li>
					組織オーナーは、組織メンバーの行為について、本規約の遵守を確保する責任を負います。
				</li>
				<li>
					組織メンバーが本規約に違反した場合、当社は組織全体に対して措置を講じることがあります。
				</li>
				<li>
					組織オーナーは、当サービス上でいつでも組織を削除することができます。組織を削除した場合、以下の処理が行われます。
					<ul>
						<li>組織に紐づくすべてのデータ（セッション情報、採点データ等）が削除されます</li>
						<li>有料プランをご利用の場合、サブスクリプションが即座にキャンセルされ、以降の請求は発生しません</li>
						<li>削除されたデータは復元できません</li>
					</ul>
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第6条（料金および支払い）</h2>
			<ol>
				<li>
					ユーザーは、当サービスの有料プランを利用する場合、当社が定める利用料金を支払うものとします。
				</li>
				<li>
					利用料金の支払方法は、クレジットカード決済とします。
				</li>
				<li>
					ユーザーがクレジットカード決済を選択した場合、指定されたクレジットカードから自動的に課金されます。
				</li>
				<li>
					一度支払われた利用料金は、理由の如何を問わず返金されません。ただし、当社の責めに帰すべき事由による場合は、この限りではありません。
				</li>
				<li>
					ユーザーが利用料金の支払いを遅延した場合、当社は当該ユーザーのアカウントを停止することができます。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第7条（プラン変更と解約）</h2>
			<ol>
				<li>
					ユーザーは、いつでもプランを変更することができます。
				</li>
				<li>
					プランのアップグレードは即時反映され、日割り計算により差額が即時請求されます。プランのダウングレードは次回請求日から適用されます。
				</li>
				<li>
					ユーザーは、いつでも有料プランを解約し、無料プランに変更することができます。
				</li>
				<li>
					解約した場合でも、既に支払われた利用料金は返金されません。
				</li>
				<li>
					組織を削除した場合、有料プランのサブスクリプションは自動的に即座にキャンセルされます。次回以降の請求は発生しませんが、既に支払われた期間分の利用料金は返金されません。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第8条（禁止事項）</h2>
			<p>ユーザーは、当サービスの利用にあたり、以下の行為を行ってはならないものとします。</p>
			<ol>
				<li>法令または公序良俗に違反する行為</li>
				<li>犯罪行為に関連する行為</li>
				<li>当社、他のユーザー、またはその他の第三者の知的財産権、肖像権、プライバシー、名誉その他の権利または利益を侵害する行為</li>
				<li>当サービスのネットワークまたはシステム等に過度な負荷をかける行為</li>
				<li>当サービスの運営を妨害するおそれのある行為</li>
				<li>不正アクセスをし、またはこれを試みる行為</li>
				<li>他のユーザーに関する個人情報等を収集または蓄積する行為</li>
				<li>不正な目的を持って当サービスを利用する行為</li>
				<li>当サービスの他のユーザーまたはその他の第三者に不利益、損害、不快感を与える行為</li>
				<li>虚偽の情報を登録する行為</li>
				<li>当サービスを商用目的で利用する行為（当社が認めた場合を除く）</li>
				<li>反社会的勢力等への利益供与行為</li>
				<li>その他、当社が不適切と判断する行為</li>
			</ol>
		</section>

		<section class="section">
			<h2>第9条（サービスの提供停止）</h2>
			<ol>
				<li>
					当社は、以下のいずれかに該当する場合には、ユーザーに事前に通知することなく、当サービスの全部または一部の提供を停止または中断することができるものとします。
					<ul>
						<li>当サービスに係るコンピューター・システムの点検または保守作業を緊急に行う場合</li>
						<li>コンピューター、通信回線等の障害、誤操作、過度なアクセスの集中、不正アクセス、ハッキング等により当サービスの運営ができなくなった場合</li>
						<li>地震、落雷、火災、風水害、停電、天災地変などの不可抗力により当サービスの運営ができなくなった場合</li>
						<li>その他、当社が停止または中断を必要と判断した場合</li>
					</ul>
				</li>
				<li>
					当社は、本条に基づく当サービスの提供停止または中断により、ユーザーまたは第三者が被った損害について、一切の責任を負わないものとします。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第10条（利用制限および登録抹消）</h2>
			<ol>
				<li>
					当社は、ユーザーが以下のいずれかに該当する場合には、事前の通知なく、ユーザーに対して、当サービスの全部もしくは一部の利用を制限し、またはユーザーとしての登録を抹消することができるものとします。
					<ul>
						<li>本規約のいずれかの条項に違反した場合</li>
						<li>登録事項に虚偽の事実があることが判明した場合</li>
						<li>利用料金の支払いを怠った場合</li>
						<li>当社からの連絡に対し、相当期間返答がない場合</li>
						<li>その他、当社が当サービスの利用を適当でないと判断した場合</li>
					</ul>
				</li>
				<li>
					当社は、本条に基づき当社が行った行為によりユーザーに生じた損害について、一切の責任を負いません。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第11条（保証の否認および免責）</h2>
			<ol>
				<li>
					当社は、当サービスがユーザーの特定の目的に適合すること、期待する機能・商品的価値・正確性・有用性を有すること、ユーザーによる当サービスの利用がユーザーに適用のある法令または業界団体の内部規則等に適合すること、継続的に利用できること、および不具合が生じないことについて、明示または黙示を問わず何ら保証するものではありません。
				</li>
				<li>
					当社は、当サービスに関して、ユーザーと他のユーザーまたは第三者との間において生じた取引、連絡または紛争等について一切責任を負いません。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第12条（サービス内容の変更）</h2>
			<ol>
				<li>
					当社は、ユーザーに通知することなく、当サービスの内容を変更し、または当サービスの提供を中止することができるものとします。
				</li>
				<li>
					当社は、これによりユーザーに生じた損害について一切の責任を負いません。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第13条（利用規約の変更）</h2>
			<ol>
				<li>
					当社は、ユーザーの承諾を得ることなく、いつでも本規約を変更することができるものとします。
				</li>
				<li>
					変更後の本規約は、当サービス上に掲示された時点から効力を生じるものとします。
				</li>
				<li>
					ユーザーは、本規約変更後も当サービスを継続して利用することにより、変更後の本規約に同意したものとみなされます。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第14条（個人情報の取扱い）</h2>
			<p>
				当社は、当サービスの利用によって取得する個人情報については、当社が別途定めるプライバシーポリシーに従い、適切に取り扱うものとします。
			</p>
		</section>

		<section class="section">
			<h2>第15条（通知または連絡）</h2>
			<ol>
				<li>
					ユーザーと当社との間の通知または連絡は、当社の定める方法によって行うものとします。
				</li>
				<li>
					当社は、ユーザーから、当社が別途定める方式に従った変更届け出がない限り、現在登録されている連絡先が有効なものとみなして当該連絡先へ通知または連絡を行い、これらは、発信時にユーザーへ到達したものとみなします。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第16条（権利義務の譲渡禁止）</h2>
			<ol>
				<li>
					ユーザーは、当社の書面による事前の承諾なく、利用契約上の地位または本規約に基づく権利もしくは義務を第三者に譲渡し、または担保に供することはできません。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第17条（準拠法および管轄裁判所）</h2>
			<ol>
				<li>本規約の解釈にあたっては、日本法を準拠法とします。</li>
				<li>
					当サービスに関して紛争が生じた場合には、当社の本店所在地を管轄する裁判所を専属的合意管轄裁判所とします。
				</li>
			</ol>
		</section>

		<section class="section">
			<h2>第18条（協議解決）</h2>
			<p>
				当社およびユーザーは、本規約に定めのない事項または本規約の解釈に疑義が生じた場合には、互いに信義誠実の原則に従って協議の上速やかに解決を図るものとします。
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

	.section p {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin-bottom: 12px;
	}

	.section ol {
		padding-left: 24px;
		margin-bottom: 0;
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
		margin-bottom: 8px;
	}

	.section ul li {
		font-size: 15px;
		line-height: 1.8;
		color: var(--primary-text);
		margin-bottom: 8px;
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

		.section p,
		.section ol li,
		.section ul li {
			font-size: 14px;
		}
	}
</style>
