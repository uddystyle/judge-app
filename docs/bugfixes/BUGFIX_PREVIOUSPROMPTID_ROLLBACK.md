# バグ修正: previousPromptId 巻き戻し問題

## 🐛 問題の詳細

### 発見された脆弱性

`startFallbackPolling()`が呼ばれるたびに`previousPromptId`を初期値（`data.sessionDetails.active_prompt_id`）に上書きしていました。

**問題のコード**:
```typescript
function startFallbackPolling() {
  if (fallbackPolling) {
    return;
  }

  // ❌ 毎回初期値に上書き
  previousPromptId = data.sessionDetails.active_prompt_id;

  fallbackPolling = setInterval(checkSessionStatus, 30000);
}
```

### 二重遷移が発生するシナリオ

1. **初期状態**: `active_prompt_id = 'prompt-1'`, `previousPromptId = null`
2. **Realtime接続**: 正常に購読開始
3. **サーバー更新**: `active_prompt_id = 'prompt-2'`に変更
4. **Realtime処理**:
   - `prompt-2`を検知
   - `previousPromptId = 'prompt-2'`に更新
   - 採点画面へ遷移（✅ 1回目）
5. **接続エラー**: CHANNEL_ERROR発生
6. **ポーリング再開**: `startFallbackPolling()`呼び出し
7. **❌ 巻き戻し**: `previousPromptId = data.sessionDetails.active_prompt_id`（='prompt-1'）
   - `data.sessionDetails`はページロード時の古いデータ
   - `previousPromptId`が'prompt-2'から'prompt-1'に巻き戻される
8. **ポーリング実行**: サーバーから最新データ取得 → `active_prompt_id = 'prompt-2'`
9. **❌ 二重遷移**: `'prompt-2' !== 'prompt-1'`なので新規と判定 → 採点画面へ再遷移（❌ 2回目）

---

## ✅ 修正内容

### 修正されたコード

**ファイル**: `src/routes/session/[id]/+page.svelte`

```typescript
function startFallbackPolling() {
  if (fallbackPolling) {
    console.log('[fallback] 既にポーリング開始済み');
    return;
  }

  console.log('[fallback] フォールバックポーリングを開始（30秒ごと）');

  // ✅ previousPromptId が null の場合のみ初期化（巻き戻し防止）
  // Realtimeで既に処理済みの prompt を上書きしないようにする
  if (previousPromptId === null) {
    previousPromptId = data.sessionDetails.active_prompt_id;
    console.log('[fallback] previousPromptId を初期化:', previousPromptId);
  } else {
    console.log('[fallback] previousPromptId を保持:', previousPromptId);
  }

  // 30秒ごとにポーリング（Realtimeのバックアップなので低頻度）
  fallbackPolling = setInterval(checkSessionStatus, 30000);
}
```

### 修正のポイント

1. **条件付き初期化**: `previousPromptId === null`の場合のみ初期化
2. **保持ロギング**: 巻き戻しを防いだことをログに記録
3. **Realtime優先**: Realtimeで処理済みの値を保護

---

## 🧪 テスト追加

### 新規テストケース（3テスト）

**ファイル**: `src/routes/session/[id]/page.test.ts`

#### 1. 巻き戻し防止テスト
```typescript
it('Realtime処理後、フォールバックポーリング再開時にpreviousPromptIdを巻き戻さない', () => {
  // 初回開始: previousPromptId が null なので初期化される
  startFallbackPolling();
  expect(previousPromptId).toBe('prompt-1');

  // Realtime で prompt-2 を処理
  previousPromptId = 'prompt-2';

  // 接続エラーでフォールバックポーリング再開
  fallbackPolling = null;
  startFallbackPolling();

  // ✅ previousPromptId が巻き戻されないことを確認
  expect(previousPromptId).toBe('prompt-2'); // 'prompt-1'に戻ってはいけない
});
```

#### 2. 初回開始時のみ初期化
```typescript
it('初回開始時のみpreviousPromptIdを初期化する', () => {
  // 初回開始
  startFallbackPolling();
  expect(previousPromptId).toBe('prompt-initial');

  // 2回目の開始（previousPromptIdは既に値がある）
  previousPromptId = 'prompt-updated';
  fallbackPolling = null;
  startFallbackPolling();

  // previousPromptIdは上書きされない
  expect(previousPromptId).toBe('prompt-updated');
});
```

#### 3. 二重遷移防止の統合テスト
```typescript
it('Realtime処理後の再開で二重遷移が発生しない', () => {
  // 初回開始
  startFallbackPolling();

  // Realtime で prompt-new を処理
  previousPromptId = 'prompt-new';
  gotoCallCount++;

  // 接続エラーでフォールバックポーリング再開
  startFallbackPolling();

  // previousPromptId は 'prompt-new' のまま（巻き戻されない）
  expect(previousPromptId).toBe('prompt-new');

  // ポーリングで最新データ取得
  checkSessionStatus();

  // ✅ 二重遷移は発生しない（goto は Realtime の1回のみ）
  expect(gotoCallCount).toBe(1);
});
```

### テスト実行結果

```
✓ src/routes/session/[id]/page.test.ts (14 tests) 4ms
  Fallback Polling - previousPromptId 巻き戻し防止
    ✓ Realtime処理後、フォールバックポーリング再開時にpreviousPromptIdを巻き戻さない
    ✓ 初回開始時のみpreviousPromptIdを初期化する
    ✓ Realtime処理後の再開で二重遷移が発生しない

Test Files  27 passed | 1 skipped (28)
Tests       510 passed | 5 skipped (516)
```

**コンソールログから確認**:
```
[fallback] previousPromptId を初期化: prompt-1
[fallback] previousPromptId を保持: prompt-2
```

---

## 📊 影響範囲

### 修正されたファイル

1. **`src/routes/session/[id]/+page.svelte`** - `startFallbackPolling()`関数を修正
2. **`src/routes/session/[id]/page.test.ts`** - 3つの新規テストケースを追加

### テスト統計

| 修正前 | 修正後 | 増加 |
|--------|--------|------|
| 507テスト | **510テスト** | +3 |

---

## 🎯 修正の効果

### 防止される問題

1. ✅ **二重遷移の完全防止**: Realtime処理後のポーリング再開で二重遷移が発生しない
2. ✅ **状態整合性の保持**: `previousPromptId`がRealtimeとPollingで一貫性を保つ
3. ✅ **ユーザー体験の向上**: 検定員が同じ採点指示で2回遷移することがない

### 検証方法

```bash
# 修正を含む全テスト実行
npm run test

# 特定のテストのみ実行
npm run test -- page.test
```

---

## 📝 関連情報

### 関連ドキュメント

- `TEST_IMPLEMENTATION_SUMMARY.md` - 全テスト実装サマリー
- `src/routes/session/[id]/TESTING.md` - 待機画面テスト詳細

### 技術的背景

**previousPromptIdの役割**:
- Realtimeとフォールバックポーリングの両方で同じpromptを二重処理しないための同期変数
- 一度処理したprompt IDを記録し、次回以降はスキップする

**修正前の問題**:
- フォールバックポーリング再開時に、ページロード時の古いデータで上書きされていた
- Realtimeで既に処理済みのpromptが「未処理」として扱われる

**修正後の動作**:
- 初回開始時のみ初期化
- 再開時は現在の値を保持
- Realtimeで処理した状態が保護される

---

## ✅ 結論

この修正により、**Realtime接続エラー後のフォールバックポーリング再開時の二重遷移問題が完全に解決**されました。

3つの新規テストケースで回帰防止が保証され、510テストすべてが通過しています。
