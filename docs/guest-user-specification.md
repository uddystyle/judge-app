# ゲストユーザー機能仕様書

## 概要

セッションへの参加障壁を下げるため、アカウント登録なしで参加できる「ゲストユーザー」機能を実装します。
ゲストユーザーは名前のみを入力してセッションに参加でき、通常ユーザーとほぼ同等の機能を利用できます。

---

## 基本方針

**「ゲストユーザーも通常の参加者として扱い、制限は最小限にする」**

現場での運用を考慮し、セッション終了後もアクセス可能とし、UXを最優先します。

---

## 招待方法

### 1. ゲストユーザー向け招待（アカウント不要）

#### a) 招待URL
- **対象**: アカウントを持っていない人（オンライン共有）
- **形式**: `https://tento.app/session/invite/[token]`
- **共有方法**: メール、メッセージアプリ、SNSで共有
- **用途**: リモート参加者、事前連絡

#### b) QRコード
- **対象**: アカウントを持っていない人（現場での招待）
- **形式**: 上記URLをエンコードしたQRコード
- **共有方法**: 画面表示、印刷、会場掲示
- **用途**: 当日現場での受付、大人数の一斉招待

### 2. 既存ユーザー向け招待

#### 招待コード
- **対象**: すでにアカウントを持っている人
- **形式**: `ABC123`（6桁の英数字）
- **特徴**: ダッシュボードから「コードでセッションに参加」で入力
- **用途**: 組織メンバー、リピーター、アカウント保有者

---

## ゲストユーザーの機能範囲

### できること（通常ユーザーと同等）

✅ **セッションへの参加**
- 招待URLまたはQRコードから名前を入力して参加

✅ **採点の実施**
- 検定員として割り当てられた場合、採点可能

✅ **結果の閲覧**
- セッション終了後も結果確認可能
- 再アクセス可能（ブックマーク・履歴から）

✅ **セッション詳細の確認**
- 参加者リスト、採点状況などの閲覧

✅ **複数セッションへの参加**
- 異なるセッションに別のゲストとして参加可能

### できないこと（最小限の制限）

❌ **組織への所属**
- セッションのみに紐づく（組織には所属しない）

❌ **セッションの作成**
- セッション作成には組織が必要

❌ **プロフィール設定の変更**
- 名前は参加時に入力したもので固定

❌ **パスワードログイン**
- セッション別の識別情報（UUID）のみで管理

❌ **ダッシュボードへのアクセス**
- 組織に所属していないため非表示

---

## データベース設計

### `sessions` テーブルの拡張

```sql
-- 新規追加カラム
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS invite_token_created_at TIMESTAMP WITH TIME ZONE;

-- インデックス
CREATE INDEX IF NOT EXISTS idx_sessions_invite_token ON sessions(invite_token);

-- コメント
COMMENT ON COLUMN sessions.invite_token IS 'ゲスト招待用のトークン（UUID）';
COMMENT ON COLUMN sessions.invite_token_created_at IS 'トークン作成日時（有効期限管理用）';
```

### `session_participants` テーブルの拡張

```sql
-- 新規追加カラム
ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT false;
ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE session_participants ADD COLUMN IF NOT EXISTS guest_identifier TEXT UNIQUE;

-- 既存カラムの変更
ALTER TABLE session_participants ALTER COLUMN user_id DROP NOT NULL;

-- 制約追加
ALTER TABLE session_participants ADD CONSTRAINT check_user_or_guest
  CHECK (
    (user_id IS NOT NULL AND is_guest = false) OR
    (guest_identifier IS NOT NULL AND is_guest = true)
  );

-- インデックス
CREATE INDEX IF NOT EXISTS idx_session_participants_guest_identifier ON session_participants(guest_identifier);
CREATE INDEX IF NOT EXISTS idx_session_participants_is_guest ON session_participants(is_guest);

-- コメント
COMMENT ON COLUMN session_participants.is_guest IS 'ゲストユーザーかどうか';
COMMENT ON COLUMN session_participants.guest_name IS 'ゲストユーザーの表示名';
COMMENT ON COLUMN session_participants.guest_identifier IS 'ゲスト識別用のUUID';
```

### RLS（Row Level Security）ポリシー

```sql
-- ゲストユーザーが自分の参加セッションを閲覧できるポリシー
CREATE POLICY "Guests can view their sessions"
ON session_participants FOR SELECT
USING (
  (auth.uid() = user_id) OR
  (is_guest = true)
);

-- ゲストユーザーが自分の採点データを操作できるポリシー
-- ※ 既存のポリシーを拡張する形で実装
```

---

## 認証・セッション管理

### ゲストセッション情報（localStorage）

```typescript
interface GuestSession {
  guest_identifier: string;  // UUID
  guest_name: string;        // 表示名
  session_id: string;        // セッションID
  joined_at: string;         // 参加日時（ISO 8601形式）
}

// 複数セッション対応
const guestSessions: GuestSession[] = [
  {
    guest_identifier: 'uuid-1',
    guest_name: '山田太郎',
    session_id: 'session-123',
    joined_at: '2025-01-11T10:00:00Z'
  },
  {
    guest_identifier: 'uuid-2',
    guest_name: '佐藤花子',
    session_id: 'session-456',
    joined_at: '2025-01-12T14:30:00Z'
  }
];

localStorage.setItem('guest_sessions', JSON.stringify(guestSessions));
```

### アクセス制御

#### 通常ユーザー
- **認証方法**: Supabase Auth（`user_id`）
- **セッション**: Cookie + JWT

#### ゲストユーザー
- **認証方法**: `guest_identifier`（UUID）
- **セッション**: localStorage + URLパラメータ（`?guest=uuid`）
- **制約**: ブラウザごとに独立（localStorage依存）

---

## 実装概要

### 1. 招待トークン生成

**タイミング**: セッション作成時に自動生成

```typescript
// セッション作成時
const inviteToken = crypto.randomUUID();

await supabase.from('sessions').insert({
  // ... 既存のフィールド
  invite_token: inviteToken,
  invite_token_created_at: new Date().toISOString()
});
```

### 2. ゲスト招待ページ（`/session/invite/[token]`）

#### ページ構成
1. セッション情報表示（セッション名、組織名、日時）
2. 名前入力フォーム
3. 「参加する」ボタン
4. 既にアカウントを持っている場合のログインリンク

#### フロー
```
1. 招待URLをクリック
   ↓
2. トークンの有効性を確認
   ↓
3. セッション情報を表示
   ↓
4. 名前を入力
   ↓
5. session_participantsに登録（is_guest=true）
   ↓
6. localStorageに保存
   ↓
7. セッションページへリダイレクト（?guest=uuid付き）
```

### 3. セッションページでのゲスト認証（`/session/[id]/+page.server.ts`）

```typescript
export const load = async ({ params, url, locals: { supabase } }) => {
  const sessionId = params.id;
  const guestIdentifier = url.searchParams.get('guest');
  const { data: { user } } = await supabase.auth.getUser();

  let participant;

  // 通常ユーザーの場合
  if (user) {
    const { data } = await supabase
      .from('session_participants')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .single();
    participant = data;
  }

  // ゲストユーザーの場合
  else if (guestIdentifier) {
    const { data } = await supabase
      .from('session_participants')
      .select('*')
      .eq('session_id', sessionId)
      .eq('guest_identifier', guestIdentifier)
      .eq('is_guest', true)
      .single();
    participant = data;
  }

  // 参加者でない場合
  if (!participant) {
    throw redirect(303, '/session/join');
  }

  return {
    session: sessionData,
    participant: participant,
    isGuest: participant.is_guest,
    guestName: participant.guest_name
  };
};
```

### 4. QRコード機能

#### 技術スタック
- **ライブラリ**: `qrcode`
- **インストール**: `npm install qrcode @types/qrcode`

#### QRコード生成

```typescript
import QRCode from 'qrcode';

// モーダル表示用（300x300px）
const inviteUrl = `https://tento.app/session/invite/${token}`;
const qrCodeDataUrl = await QRCode.toDataURL(inviteUrl, {
  width: 300,
  margin: 2,
  color: {
    dark: '#171717',
    light: '#FFFFFF'
  }
});

// ダウンロード用（512x512px）
const qrCodeDataUrlHD = await QRCode.toDataURL(inviteUrl, {
  width: 512,
  margin: 2
});
```

#### UI実装（セッション詳細ページ）

```svelte
<div class="invite-section">
  <h3>ゲストを招待</h3>

  <!-- 招待URL -->
  <div class="invite-url">
    <label>招待URL</label>
    <div class="url-input">
      <input type="text" value={inviteUrl} readonly />
      <button on:click={copyUrl}>コピー</button>
    </div>
  </div>

  <!-- QRコード -->
  <div class="qr-code">
    <label>QRコード</label>
    <button on:click={showQRModal}>QRコードを表示</button>
  </div>

  <p class="note">※ アカウント登録不要で参加できます</p>
</div>

<div class="invite-section">
  <h3>アカウント保有者を招待</h3>

  <!-- 招待コード -->
  <div class="invite-code">
    <label>招待コード</label>
    <div class="code-display">
      <span class="code">{joinCode}</span>
      <button on:click={copyCode}>コピー</button>
    </div>
  </div>

  <p class="note">※ ダッシュボードから参加できます</p>
</div>
```

#### QRコードモーダル

```svelte
{#if showQRModal}
  <div class="modal-overlay" on:click={closeModal}>
    <div class="modal-content" on:click|stopPropagation>
      <h2>{sessionName}</h2>
      <img src={qrCodeDataUrl} alt="QRコード" />
      <p>カメラで読み取ってください</p>
      <div class="modal-actions">
        <button on:click={downloadQR}>ダウンロード</button>
        <button on:click={printQR}>印刷</button>
        <button on:click={closeModal}>閉じる</button>
      </div>
    </div>
  </div>
{/if}
```

### 5. ヘッダーコンポーネントの拡張

```svelte
<script lang="ts">
  export let pageUser;
  export let pageProfile;
  export let isGuest = false;
  export let guestName = '';
</script>

<header>
  <div class="logo">TENTO</div>

  <div class="user-info">
    {#if isGuest}
      <div class="guest-indicator">
        <span class="guest-badge">ゲスト</span>
        <span class="guest-name">{guestName}</span>
      </div>
    {:else if pageProfile}
      <!-- 通常のプロフィールメニュー -->
      <ProfileMenu user={pageUser} profile={pageProfile} />
    {:else}
      <a href="/login">ログイン</a>
    {/if}
  </div>
</header>
```

---

## ユースケース

### ケース1: 現場での大人数招待（QRコード）

**シナリオ**: スキークラブの検定会で50名の参加者を招待

1. セッション管理者が「QRコードを表示」をクリック
2. 大きなQRコードがモーダル表示される
3. 会場のスクリーンにQRコードを投影
4. 参加者がスマホで読み取り
5. 各自が名前を入力して即座に参加

**メリット**:
- 一度に大人数を招待可能
- コード入力のミスがない
- 現場での受付がスムーズ

### ケース2: 事前のオンライン招待（招待URL）

**シナリオ**: 事前にメールで検定員を招待

1. セッション管理者が招待URLをコピー
2. メールまたはLINEで参加者に送信
3. 参加者がリンクをクリック
4. 名前を入力して参加

**メリット**:
- 事前に参加者に送信可能
- リモート参加者にも対応
- URLとして記録が残る

### ケース3: 既存ユーザーの招待（招待コード）

**シナリオ**: 組織メンバーを新しいセッションに招待

1. セッション管理者が招待コードをコピー
2. 参加者に口頭または文字で伝える
3. 参加者がダッシュボードから「コードでセッションに参加」
4. コードを入力して参加

**メリット**:
- 既存ユーザーは自分のアカウントで参加
- 組織メンバーの管理がしやすい
- 履歴が統合される

---

## セキュリティ考慮事項

### 1. トークンの安全性

- **形式**: UUID v4（128ビット、推測不可能）
- **一意性**: UNIQUE制約により重複なし
- **有効期限**: 必要に応じて `invite_token_created_at` で管理可能

### 2. ゲスト識別子の保護

- **形式**: UUID v4
- **保存場所**: localStorage（ブラウザローカル）
- **伝送**: URLパラメータ（HTTPS通信）

### 3. RLSポリシー

- ゲストユーザーは自分の `guest_identifier` に紐づくデータのみアクセス可能
- 他のゲストや通常ユーザーのデータは閲覧不可

### 4. localStorage依存のリスク

**リスク**: ブラウザのストレージをクリアすると再アクセス不可

**対策**:
- 招待URLを再度クリックすれば再参加可能（同じセッションに複数のゲストレコードが作成される可能性）
- または、既存の `guest_identifier` を再利用する仕組みを検討

**許容範囲**:
- セッション終了後のアクセスは必須だが、永続的なアクセスは不要
- ゲストユーザーはアカウント登録を促す導線を用意

---

## 将来の拡張性

### 1. アカウント登録への誘導

**タイミング**:
- セッション終了後
- 複数セッションに参加した後

**実装**:
```svelte
{#if isGuest}
  <div class="upgrade-prompt">
    <p>アカウントを作成すると、すべてのセッションデータを保存できます</p>
    <button on:click={redirectToSignup}>アカウントを作成</button>
  </div>
{/if}
```

### 2. ゲストデータの引き継ぎ

**シナリオ**: ゲストユーザーがアカウント登録した場合

1. サインアップページで `guest_identifier` をパラメータとして渡す
2. アカウント作成後、該当する `session_participants` レコードを更新
3. `is_guest=false`、`user_id=[新規ユーザーID]` に変更

```sql
UPDATE session_participants
SET
  is_guest = false,
  user_id = '[新規ユーザーID]',
  guest_identifier = NULL
WHERE guest_identifier = '[元のguest_identifier]';
```

### 3. 統計・分析

- ゲスト参加率の追跡
- アカウント登録への転換率測定
- ゲストユーザーの再訪率
- 招待方法別の参加率（URL vs QRコード）

---

## 実装順序

1. **データベースマイグレーション**
   - `sessions` テーブルに `invite_token` 関連カラム追加
   - `session_participants` テーブルにゲスト関連カラム追加
   - RLSポリシーの更新

2. **招待トークン生成機能**
   - セッション作成時に自動生成
   - 既存セッションへのマイグレーション

3. **ゲスト招待ページ（`/session/invite/[token]`）**
   - トークン検証
   - 名前入力フォーム
   - ゲスト登録処理

4. **セッションページのゲスト対応**
   - ゲスト認証ロジック追加
   - localStorage管理機能
   - UI調整（ゲスト表示）

5. **QRコード機能**
   - ライブラリインストール
   - QRコード生成機能
   - モーダル表示
   - ダウンロード・印刷機能

6. **セッション詳細ページの拡張**
   - 招待URL表示・コピー機能
   - QRコード表示ボタン
   - UI/UXの整理

7. **ヘッダーコンポーネントの拡張**
   - ゲスト表示対応
   - プロップスの追加

8. **テスト・デバッグ**
   - ゲスト招待フロー
   - 複数セッション参加
   - localStorage管理
   - セキュリティチェック

---

## 注意事項

### プラン制限とゲストユーザー

**ゲストユーザーは検定員数制限にカウントされます**

- `session_participants` テーブルの全レコード（`is_guest=true` / `false` 両方）をカウント
- 理由:
  1. ゲストも実際に採点を行う検定員として機能する
  2. プラン制限の趣旨は「同時に採点できる人数」の管理
  3. 不正利用の防止（ゲストを除外するとプラン制限を回避可能）
- 実装: 現在の `checkCanAddJudgeToSession()` 関数がそのまま使用可能

### その他

- QRコードの印刷機能はブラウザの印刷APIを使用するため、ユーザー環境に依存する
- ゲストユーザーは組織メンバー数制限には影響しない（組織に所属しないため）

---

## 追加機能アイデア（将来実装検討）

### Phase 2: UX改善

#### 初回チュートリアル（理解度向上）

**目的**: ゲストユーザーが初めてセッションにアクセスした際に、基本的な使い方を案内

**実装例**:
```svelte
{#if isGuest && isFirstVisit}
  <div class="guest-tutorial">
    <h2>TENTOへようこそ</h2>
    <p>このセッションで採点を行うことができます</p>
    <ol>
      <li>採点画面で選手を選択</li>
      <li>得点を入力</li>
      <li>送信ボタンで採点完了</li>
    </ol>
    <button on:click={closeTutorial}>はじめる</button>
  </div>
{/if}
```

**メリット**: ゲストユーザーの理解度向上、操作ミス減少

---

### Phase 3: 管理・分析

#### 1. 主任検定員によるゲスト管理

**機能**: セッション詳細ページでゲストユーザーの削除・管理

**実装例**:
```svelte
<div class="participant-item">
  <span class="participant-name">
    {p.guest_name}
    <span class="guest-badge">ゲスト</span>
  </span>

  {#if isChiefJudge}
    <button on:click={() => removeGuest(p.guest_identifier)}>
      削除
    </button>
  {/if}
</div>
```

**ユースケース**: 間違って参加したゲスト、テスト参加者などを削除

---

#### 2. ゲスト参加の統計表示

**機能**: 組織管理画面での統計表示

**実装例**:
```svelte
<div class="stats-card">
  <h3>今月のゲスト参加</h3>
  <div class="stat-value">{guestCount}人</div>
</div>
```

**データ取得**:
```sql
SELECT COUNT(*) as total_guests
FROM session_participants
WHERE session_id IN (
  SELECT id FROM sessions WHERE organization_id = ?
)
AND is_guest = true
AND created_at >= date_trunc('month', CURRENT_DATE);
```

**メリット**: ゲスト機能の効果測定、利用状況の把握

---

#### 3. ゲスト参加のリアルタイム通知

**機能**: 新しいゲストがセッションに参加した際の通知

**実装**:
```typescript
supabase
  .channel('session-participants')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'session_participants',
    filter: `session_id=eq.${sessionId}`
  }, (payload) => {
    if (payload.new.is_guest) {
      showNotification(`${payload.new.guest_name}さんが参加しました`);
    }
  })
  .subscribe();
```

**メリット**: 主催者が参加状況をリアルタイムで把握できる

---

### Phase 4: セキュリティ・運用

#### 1. QRコード有効期限設定

**機能**: セッション開始時刻に基づく自動期限

**実装**:
```typescript
// セッション開始24時間前から終了まで有効
const sessionDate = new Date(session.start_date);
const validFrom = new Date(sessionDate.getTime() - 24 * 60 * 60 * 1000);
const validUntil = session.end_date;

// 招待ページで検証
if (now < validFrom || now > validUntil) {
  return { error: 'この招待リンクは有効期限が切れています' };
}
```

**メリット**: セキュリティ向上、意図しない参加を防止

---

#### 2. デバイスベースの制限（必要に応じて）

**機能**: 同一ゲスト識別子の多重ログイン検知

**課題**: 1つのゲストリンクを複数人で共有できてしまう

**実装**:
```typescript
// セッション参加時にデバイスIDを記録
const deviceId = getDeviceFingerprint(); // ブラウザ指紋

await supabase.from('guest_sessions').insert({
  guest_identifier: guestIdentifier,
  device_id: deviceId,
  session_id: sessionId,
  last_active: new Date()
});

// 別デバイスからのアクセスを検知
const existingSessions = await supabase
  .from('guest_sessions')
  .select('device_id')
  .eq('guest_identifier', guestIdentifier)
  .neq('device_id', deviceId);

if (existingSessions.data.length > 0) {
  // 警告表示または前のセッションを無効化
}
```

**メリット**: 不正利用の防止

---

#### 3. ゲストデータの自動クリーンアップ

**機能**: 古いゲストデータの定期削除

**実装**:
```sql
-- 6ヶ月以上前のゲストユーザーを削除
DELETE FROM session_participants
WHERE is_guest = true
AND created_at < NOW() - INTERVAL '6 months';
```

**Supabase の pg_cron で定期実行**:
```sql
SELECT cron.schedule(
  'cleanup-old-guests',
  '0 2 * * 0', -- 毎週日曜 2:00
  $$DELETE FROM session_participants
    WHERE is_guest = true
    AND created_at < NOW() - INTERVAL '6 months'$$
);
```

**メリット**: データベース容量の節約、GDPR等のプライバシー規制対応

---

### Phase 1の実装範囲（初期リリース）

Phase 1では以下の4つを実装:

1. ✅ **基本的なゲスト参加機能**
   - データベース拡張（`sessions.invite_token`, `session_participants` のゲスト対応）
   - 招待URL生成
   - `/session/invite/[token]` ページ
   - ゲスト認証フロー

2. ✅ **QRコード生成・表示**
   - `qrcode` ライブラリ導入
   - QRコード生成機能
   - モーダル表示
   - ダウンロード・印刷機能

3. ✅ **セッション詳細ページでのゲスト表示**
   - 参加メンバー一覧にゲスト表示
   - ゲストバッジ表示
   - 招待URL表示・コピー機能
   - QRコード表示ボタン

4. ✅ **ゲスト名の編集機能**
   - ゲストユーザーが自分の表示名を変更可能
   - セッションページまたはヘッダーから編集

**Phase 2以降の機能は、Phase 1リリース後の利用状況を見て検討**

---

## 関連ドキュメント

- [データベーススキーマ](./database-schema.md)（作成予定）
- [認証フロー](./authentication-flow.md)（作成予定）
- [セキュリティガイドライン](./security-guidelines.md)（作成予定）

---

**作成日**: 2025-01-11
**最終更新**: 2025-01-11
**バージョン**: 1.1
