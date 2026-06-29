# TENTO 料金体系（Plan2）

## 概要

検定員数で区切った3つの定額プラン構成。
個人向けプランは廃止し、組織向けのシンプルな料金体系に変更。

---

## 料金プラン

### Freeプラン（試用）
**¥0/月**

**対象**: 試用、個人練習

**制限**:
- 月間3セッションまで
- 選手数: 30名まで
- 検定員: 5名まで/セッション
- 検定モードのみ

---

### Basicプラン（小規模団体）
**¥5,980/月（年払い: ¥59,800/年）**

**対象**: 3〜10名の小規模クラブ、地域スキー教室

**検定員登録数**: 10名まで

**機能**:
- 月間セッション: 無制限
- 選手数: 無制限
- 検定員数/セッション: 無制限
- 全モード利用可能（検定・大会・研修）
- 組織管理機能
  - 管理者による検定員の一括管理
  - メンバー招待・削除
  - 組織全体のセッション共有
  - 組織統計表示
- データ保存: 無制限
- サポート: メール

**年払い割引**: 約17%オフ（月換算 ¥4,983）

**1人あたりコスト**:
- 5名の場合: ¥1,196/人・月
- 10名の場合: ¥598/人・月

---

### Standardプラン（中規模団体）
**¥14,800/月（年払い: ¥148,000/年）**

**対象**: 11〜30名の地域スキー学校、スキークラブ

**検定員登録数**: 30名まで

**機能**:
- Basicプランの全機能
- 高度な統計・分析機能
  - 組織全体の統計ダッシュボード
  - 検定員別パフォーマンス分析
  - データ一括エクスポート
- サポート: メール

**年払い割引**: 約17%オフ（月換算 ¥12,333）

**1人あたりコスト**:
- 15名の場合: ¥987/人・月
- 30名の場合: ¥493/人・月

---

### Enterpriseプラン（大規模団体）
**¥29,800/月（年払い: ¥298,000/年）**

**対象**: 31名以上のスキー連盟、大規模組織

**検定員登録数**: 無制限

**機能**:
- Standardプランの全機能
- 複数組織管理（支部・クラブの階層管理）
- 検定員の詳細な権限管理
- サポート: メール

**年払い割引**: 約17%オフ（月換算 ¥24,833）

**1人あたりコスト**:
- 40名の場合: ¥745/人・月
- 50名の場合: ¥596/人・月
- 100名の場合: ¥298/人・月

---

## 比較表

| 項目 | Free | Basic | Standard | Enterprise |
|------|------|-------|----------|------------|
| **月額料金** | ¥0 | ¥5,980 | ¥14,800 | ¥29,800 |
| **年払い料金** | - | ¥59,800 | ¥148,000 | ¥298,000 |
| **検定員登録数** | 5名/セッション | **10名** | **30名** | **無制限** |
| **月間セッション** | 3回 | 無制限 | 無制限 | 無制限 |
| **選手数** | 30名 | 無制限 | 無制限 | 無制限 |
| **全モード** | ✗ | ✓ | ✓ | ✓ |
| **組織管理** | ✗ | ✓ | ✓ | ✓ |
| **高度な分析** | ✗ | ✗ | ✓ | ✓ |
| **階層管理** | ✗ | ✗ | ✗ | ✓ |
| **サポート** | - | メール | メール | メール |

---

## プラン選択ガイド

| 組織の規模 | おすすめプラン | 月額 | 年払い |
|-----------|--------------|------|--------|
| 試用・個人練習 | Free | ¥0 | - |
| 3〜10名の小規模クラブ | Basic | ¥5,980 | ¥59,800 |
| 11〜30名の地域スキー学校 | Standard | ¥14,800 | ¥148,000 |
| 31名以上の連盟・大規模組織 | Enterprise | ¥29,800 | ¥298,000 |

---

## 実装計画

### Phase 1: 基本的な組織機能（Basicプラン対応）

**データベース設計**:
```sql
-- 組織テーブル
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('basic', 'standard', 'enterprise')),
  max_members INTEGER NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 組織メンバーテーブル
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- subscriptionsテーブルに追加カラム
ALTER TABLE subscriptions
ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
```

**実装機能**:
1. 組織アカウント作成
2. 組織メンバーの招待・管理
3. 組織単位での請求（Stripe連携）
4. 組織内のセッション共有
5. 組織統計表示

### Phase 2: 高度な分析機能（Standardプラン対応）

**実装機能**:
1. 組織ダッシュボード
2. 検定員別パフォーマンス分析
3. データエクスポート機能（CSV、Excel）
4. グラフ・チャートによる可視化

### Phase 3: エンタープライズ機能（Enterpriseプラン対応）

**実装機能**:
1. 複数組織の階層管理（親組織・子組織）
2. 詳細な権限管理
3. 組織横断の統計

---

## 主な変更点（Plan1からの変更）

### 廃止した機能
- 個人向けスタンダードプラン（¥980/月）
- 個人向けプロプラン（¥2,980/月）
- カスタムブランディング機能
- 独自ドメイン機能
- チャット・電話サポート

### 変更内容
- **個人プラン廃止**: 組織向けプランに集約
- **定額制に統一**: 人数ベースではなく検定員登録数の上限で区切った定額制
- **サポート統一**: 全プランメールサポートのみ
- **3段階の明確な区切り**: 10名/30名/無制限

### この変更の理由
1. **実態に即した設計**: 検定は組織的活動であり、個人利用は稀
2. **予算の予測性**: 定額制で年間予算が立てやすい
3. **シンプルさ**: プラン選択が明確（検定員数で選ぶだけ）
4. **運用コスト削減**: サポートをメールに統一して運用を簡素化

---

## 想定収益シミュレーション

### 小規模クラブ（Basic）
- 100団体 × ¥59,800/年 = ¥5,980,000/年

### 中規模組織（Standard）
- 50団体 × ¥148,000/年 = ¥7,400,000/年

### 大規模組織（Enterprise）
- 10団体 × ¥298,000/年 = ¥2,980,000/年

**合計年間収益**: ¥16,360,000（約1,636万円）

---

## 今後の検討事項

1. **無料トライアル期間**
   - Basic/Standard/Enterpriseプランに14日間の無料トライアルを設定するか

2. **教育機関向け割引**
   - 学校・教育機関向けに特別価格を設定するか

3. **シーズンパス**
   - 冬シーズン限定（11月〜4月）の割引プランを設定するか

4. **追加オプション**
   - 追加ストレージ
   - カスタムブランディング（有料オプション）

---

## 検定員招待機能の設計

### 採用方式: 招待URL + メールアドレス登録

**フロー:**
1. 管理者が「検定員を招待」ボタンをクリック
2. 招待URL（トークン付き）が生成される
3. 管理者がLINE、メール、SMS等でURLを共有
4. 検定員がURLをクリック
5. メールアドレス + パスワード + 氏名を入力して登録
6. 自動的に組織に追加される

### 実装の段階

#### Phase 1: 基本的な招待機能
- 招待URL生成機能 ✅
- 招待ページ（メールアドレス + パスワード登録） ✅
- トークン検証 ✅
- 組織への自動追加 ✅
- 招待履歴の表示 ✅

**データベース設計:**
```sql
-- 招待テーブル
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  email TEXT, -- オプション（特定の人を招待する場合）
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER DEFAULT 1, -- NULLで無制限
  used_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 招待使用履歴
CREATE TABLE invitation_uses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invitation_id UUID REFERENCES invitations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Phase 2: 管理機能強化（必要に応じて）
- 招待の取り消し機能
- 有効期限のカスタマイズ
- 複数人一括招待（CSVアップロード）
- 招待リマインド送信

---

## 現在の実装状況と移行ロードマップ

### 現在の実装状況（2025-11-05時点）

#### データベース構造
```
現在の構造（個人向け）:
├── subscriptions
│   ├── user_id (個人単位)
│   ├── plan_type ('free', 'standard', 'pro')
│   └── stripe_customer_id
├── sessions
│   ├── created_by (ユーザー)
│   └── join_code（検定員コードで参加）
└── usage_limits
    └── user_id（個人単位の使用量追跡）
```

#### 実装済み機能
- ✅ 個人向けサブスクリプション（Free/Standard/Pro）
- ✅ Stripe連携（Checkout/Portal/Webhook）
- ✅ セッション作成・管理
- ✅ 3つのモード（検定・大会・研修）
- ✅ 使用量制限チェック
- ✅ データエクスポート（CSV/Excel）

#### 未実装機能
- ❌ 組織機能
- ❌ 検定員招待システム
- ❌ 組織向け料金プラン

---

### 移行ロードマップ

## Phase 1: 組織機能の基盤構築（2週間）

### 1-1. データベースマイグレーション（2日）

**新規テーブル作成:**

```sql
-- organizations テーブル
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('basic', 'standard', 'enterprise')),
  max_members INTEGER NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- organization_members テーブル
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

-- invitations テーブル
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  email TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- invitation_uses テーブル
CREATE TABLE invitation_uses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invitation_id UUID REFERENCES invitations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  used_at TIMESTAMPTZ DEFAULT NOW()
);
```

**既存テーブルの拡張:**

```sql
-- subscriptions テーブルに organization_id を追加
ALTER TABLE subscriptions
ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- sessions テーブルに organization_id を追加
ALTER TABLE sessions
ADD COLUMN organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- plan_limits テーブルに新プランを追加
INSERT INTO plan_limits VALUES
  ('basic', -1, -1, -1, true, true, true, -1),
  ('standard', -1, -1, -1, true, true, true, -1),
  ('enterprise', -1, -1, -1, true, true, true, -1);
```

**タスク:**
- [ ] マイグレーションファイル作成: `database/migrations/007_add_organization_features.sql`
- [ ] RLSポリシー設定
- [ ] インデックス作成
- [ ] Supabase SQL Editorで実行
- [ ] 動作確認

---

### 1-2. 組織作成機能（3日）

**実装内容:**
1. **組織作成画面** (`/organization/create`)
   - 組織名入力
   - プラン選択（Basic/Standard/Enterprise）
   - Stripe Checkout連携

2. **APIエンドポイント**
   - `/api/organization/create` - 組織作成
   - `/api/organization/[id]` - 組織情報取得/更新

3. **サーバーロジック**
   - 組織作成時に作成者を管理者として自動追加
   - Stripe Customerの作成
   - Subscriptionの作成

**タスク:**
- [ ] 組織作成画面UI作成
- [ ] フォームバリデーション
- [ ] APIエンドポイント実装
- [ ] Stripe連携
- [ ] エラーハンドリング

---

### 1-3. 招待機能（メールアドレス登録）（4日）

**実装内容:**
1. **招待URL生成機能**
   - 管理画面に「検定員を招待」ボタン
   - ユニークトークン生成（crypto.randomUUID()）
   - 有効期限設定（48時間）

2. **招待ページ** (`/invite/[token]`)
   - トークン検証
   - 組織情報表示
   - メールアドレス + パスワード入力フォーム
   - 氏名入力

3. **登録処理**
   - ユーザーアカウント作成
   - 組織メンバーとして追加
   - 自動ログイン
   - ダッシュボードへリダイレクト

4. **管理画面**
   - 招待履歴表示
   - 招待の取り消し

**タスク:**
- [ ] 招待URL生成API (`/api/invitations/create`)
- [ ] 招待ページUI (`/invite/[token]/+page.svelte`)
- [ ] トークン検証ロジック
- [ ] ユーザー登録 + 組織追加処理
- [ ] 管理画面に招待履歴表示

---

### 1-4. 組織管理画面（3日）

**実装内容:**
1. **組織ダッシュボード** (`/organization/[id]`)
   - 組織情報表示
   - メンバー一覧
   - 招待ボタン
   - プラン情報

2. **メンバー管理**
   - メンバー一覧表示
   - 役割変更（管理者⇔メンバー）
   - メンバー削除

3. **組織設定** (`/organization/[id]/settings`)
   - 組織名変更
   - プラン変更
   - 請求情報管理

**タスク:**
- [ ] 組織ダッシュボードUI
- [ ] メンバー一覧・管理機能
- [ ] 権限チェック（管理者のみ操作可能）
- [ ] 組織設定画面

---

### 1-5. ダッシュボード改修（2日）

**実装内容:**
1. **組織セッションの表示**
   - 所属組織ごとにセッション一覧表示
   - 組織の切り替え
   - 検定員コード不要でアクセス

2. **セッション作成の改修**
   - 組織選択オプション追加
   - 組織セッション vs 個人セッション

**タスク:**
- [ ] ダッシュボードUI改修 (`/dashboard/+page.svelte`)
- [ ] 組織セッション一覧取得ロジック
- [ ] セッション作成画面改修

---

## Phase 2: 料金プラン更新（1週間）

### 2-1. Stripe製品設定（1日）

**実装内容:**
- Stripe Dashboardで新製品作成
  - Basic: ¥5,980/月、¥59,800/年
  - Standard: ¥14,800/月、¥148,000/年
  - Enterprise: ¥29,800/月、¥298,000/年

**タスク:**
- [ ] Stripe Dashboardで製品・価格作成
- [ ] Price IDを.envに追加
- [ ] テストモードで動作確認

---

### 2-2. 料金ページ更新（2日）

**実装内容:**
- 料金ページを新体系に更新
  - Free/Basic/Standard/Enterpriseの4プラン
  - 検定員数の明記
  - 機能比較表の更新

**タスク:**
- [ ] `/routes/pricing/+page.svelte` 更新
- [ ] プラン比較表更新
- [ ] トップページの料金セクション更新

---

### 2-3. プラン制限実装（2日）

**実装内容:**
- 組織メンバー数制限チェック
  - Basic: 10名まで
  - Standard: 30名まで
  - Enterprise: 無制限

**タスク:**
- [ ] メンバー追加時の制限チェック
- [ ] アップグレード促進UI
- [ ] `subscriptionLimits.ts` 更新

---

### 2-4. Webhook更新（2日）

**実装内容:**
- 組織向けサブスクリプションのWebhook処理
- 新Price IDのマッピング

**タスク:**
- [ ] `/api/stripe/webhook/+server.ts` 更新
- [ ] 組織サブスクリプション処理
- [ ] テスト・動作確認

---

## Phase 3: テスト・最適化（1週間）

### 3-1. 統合テスト（3日）

**テスト項目:**
- [ ] 組織作成フロー
- [ ] 検定員招待フロー（メール）
- [ ] セッション作成・管理
- [ ] プラン制限チェック
- [ ] 請求・領収書
- [ ] 権限管理

---

### 3-2. UI/UX改善（2日）

**改善項目:**
- [ ] レスポンシブデザイン確認
- [ ] エラーメッセージの改善
- [ ] ローディング状態の表示
- [ ] 成功メッセージの表示

---

### 3-3. ドキュメント作成（2日）

**作成するドキュメント:**
- [ ] ユーザーガイド
- [ ] 管理者向けマニュアル
- [ ] API仕様書
- [ ] データベーススキーマ図

---

## 実装スケジュール

```
Week 1-2: Phase 1 (組織機能基盤)
  Day 1-2:   データベースマイグレーション ✅
  Day 3-5:   組織作成機能 ✅
  Day 6-9:   招待機能（メール） ✅
  Day 10-12: 組織管理画面 ✅
  Day 13-14: ダッシュボード改修

Week 3: Phase 2 (料金プラン更新)
  Day 15:    Stripe製品設定 ✅
  Day 16-17: 料金ページ更新 ✅
  Day 18-19: プラン制限実装
  Day 20-21: Webhook更新 ✅

Week 4: Phase 3 (テスト・最適化)
  Day 22-24: 統合テスト
  Day 25-26: UI/UX改善
  Day 27-28: ドキュメント作成
```

**合計: 約4週間（1ヶ月）**

---

## リスクと対策

### リスク1: データベース移行の失敗
**対策:**
- 本番環境適用前にステージング環境でテスト
- ロールバック用SQLを用意
- バックアップ取得

### リスク2: 既存ユーザーへの影響
**対策:**
- 現在ユーザー数ゼロのため影響なし
- テストアカウントでの十分な検証

### リスク3: Stripe連携の問題
**対策:**
- テストモードで十分にテスト
- Webhookのエラーハンドリング強化
- ログ監視体制の構築

---

## 成功基準

### Phase 1完了基準
- [x] 組織を作成できる
- [x] 検定員を招待できる（メール）
- [x] 招待されたユーザーが登録・参加できる
- [ ] 組織内でセッションを共有できる

### Phase 2完了基準
- [x] 新料金プランで契約できる
- [ ] プラン制限が正しく動作する
- [x] Stripeで請求・領収書が発行される

### Phase 3完了基準
- [ ] 全機能が正常動作する
- [ ] ドキュメントが整備されている
- [ ] 本番環境にデプロイ可能

---

作成日: 2025-11-05
更新日: 2025-11-05（招待機能設計追加、実装ロードマップ追加）
