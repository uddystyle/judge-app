# 退会済みメンバー除外フィルタの修正

**修正日**: 2026-03-10
**問題**: 退会済み管理者が一部のAPIで権限チェックをすり抜ける可能性
**深刻度**: Medium～High（認可の問題）

---

## 問題の詳細

### 発見された問題

以前の監査（SUBSCRIPTION-AUDIT-REPORT.md）で、`organization_members` から退会済みメンバー（`removed_at IS NOT NULL`）を除外する必要性が指摘され、一部のAPIでは修正されていました。

しかし、**以下の2つのAPIでは修正が漏れていました**：

1. `/api/stripe/upgrade-organization` - 組織プランのアップグレード
2. `/api/invitations/create` - 組織への招待作成

---

### セキュリティへの影響

**攻撃シナリオ**:

```
1. ユーザーAが組織の管理者
2. ユーザーAが組織から退会（removed_at に削除日時が記録）
3. しかし、removed_at のフィルタがないため...
   - ユーザーAは組織プランをアップグレードできる
   - ユーザーAは新しいメンバーを招待できる
```

**影響**:
- ✗ 退会済み管理者が組織の操作を継続可能
- ✗ 不正なプランアップグレード
- ✗ 不正な招待の作成
- ✗ 認可(Authorization)の欠陥

**深刻度**: Medium～High
- 金銭的影響: あり（不正なアップグレード）
- 認可の欠陥: あり
- 悪用難易度: 低（退会後すぐに実行可能）

---

## 修正内容

### 1. ✅ upgrade-organization API の修正

**ファイル**: `src/routes/api/stripe/upgrade-organization/+server.ts`

**修正箇所**: Line 98-107

**修正前**:
```typescript
const { data: member } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single();  // ← removed_at のチェックなし
```

**修正後**:
```typescript
const { data: member } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .is('removed_at', null)  // ✅ 退会済みメンバーを明示的に除外
    .single();
```

---

### 2. ✅ invitations/create API の修正

**ファイル**: `src/routes/api/invitations/create/+server.ts`

**修正箇所**: Line 40-50

**修正前**:
```typescript
const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single();  // ← removed_at のチェックなし
```

**修正後**:
```typescript
const { data: membership } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .is('removed_at', null)  // ✅ 退会済みメンバーを明示的に除外
    .single();
```

---

### 3. ✅ テストモックの修正

**ファイル**: `src/lib/server/__tests__/stripe.checkout-api.test.ts`

**問題**: `.is()` メソッドがモックに存在せず、テストが失敗

**修正内容**:
```typescript
// モックに .is() メソッドを追加
const mockIs2 = vi.fn().mockReturnThis();

mockSupabaseClient.from.mockReturnValueOnce({
    select: mockSelect2,
    eq: mockEq2a,
    is: mockIs2,  // ✅ 追加
    single: mockSingle2
} as any);

mockEq2b.mockReturnValue({
    is: mockIs2  // ✅ チェーンメソッドとして設定
} as any);

mockIs2.mockReturnValue({
    single: mockSingle2
} as any);
```

---

## 他のAPIの確認結果

### ✅ 修正済み（問題なし）

以下のAPIでは `.is('removed_at', null)` が既に適用されています：

| API | ファイル | 行番号 | 状態 |
|-----|---------|--------|------|
| customer-portal | `src/routes/api/stripe/customer-portal/+server.ts` | 57 | ✅ OK |
| sessions/[id] (DELETE) | `src/routes/api/sessions/[id]/+server.ts` | 44 | ✅ OK |
| sessions/[id] (PUT) | `src/routes/api/sessions/[id]/+server.ts` | 118 | ✅ OK |
| sessions/[id]/permanent | `src/routes/api/sessions/[id]/permanent/+server.ts` | 63 | ✅ OK |
| export/[sessionId] | `src/routes/api/export/[sessionId]/+server.ts` | 65 | ✅ OK |
| organization/.../members/... (DELETE) | `src/routes/api/organization/[id]/members/[memberId]/+server.ts` | 32, 49, 68 | ✅ OK |
| organization/.../members/... (PUT) | `src/routes/api/organization/[id]/members/[memberId]/+server.ts` | 130 | ✅ OK |

**結論**: 他のAPIは全て適切に実装されています。

---

## 検証結果

### ✅ テスト

```bash
npm test
```

**結果**:
```
Test Files: 16 passed (16)
Tests: 375 passed (375)
```

**全てのテストが合格**

---

### ✅ ビルド

```bash
npm run build
```

**結果**: 成功（エラーなし）

---

## Before & After

### セキュリティ状態

| 項目 | Before | After |
|------|--------|-------|
| upgrade-organization の認可 | ⚠️ 退会済み管理者OK | ✅ 退会済み管理者NG |
| invitations/create の認可 | ⚠️ 退会済み管理者OK | ✅ 退会済み管理者NG |
| 他のAPIとの一貫性 | ⚠️ 不一致 | ✅ 一貫性あり |

---

### 認可チェックの一貫性

**全てのAPIで統一されたパターン**:

```typescript
const { data: member } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .is('removed_at', null)  // ✅ 必須
    .single();
```

---

## 根本原因分析

### なぜこの問題が発生したか？

1. **段階的な修正**: 以前の監査で一部のAPIは修正されたが、全てのAPIをチェックしなかった
2. **一貫性のない実装**: 同じパターンの権限チェックだが、実装箇所によって異なる
3. **テストカバレッジ不足**: 退会済みメンバーのテストケースが一部のAPIに不足

### 再発防止策

1. **✅ パターンの統一**: 全てのAPIで同じ権限チェックパターンを使用
2. **✅ 全体検索**: `from('organization_members')` を全ファイルで検索して確認
3. **推奨**: 共通の権限チェック関数を作成（DRY原則）

**例**: 将来的な改善
```typescript
// lib/server/authorization.ts
export async function checkOrganizationAdmin(
    supabase: SupabaseClient,
    userId: string,
    organizationId: string
): Promise<{ isAdmin: boolean; member: any }> {
    const { data: member } = await supabase
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .is('removed_at', null)  // 常に適用
        .single();

    return {
        isAdmin: member?.role === 'admin',
        member
    };
}
```

---

## まとめ

### 修正の成果

**発見と修正**:
- 🔍 2つのAPIで退会済みメンバー除外が漏れていることを発見
- ✅ 両方のAPIを修正
- ✅ テストモックも修正
- ✅ 全375テストが合格

**セキュリティ改善**:
- ✅ 退会済み管理者による不正操作を防止
- ✅ 全APIで認可チェックの一貫性を確保
- ✅ 金銭的リスク（不正なアップグレード）を排除

### 重要な教訓

**「部分的な修正」≠「完全な修正」**

過去の監査で一部のAPIは修正されていましたが、同じパターンを使用する全てのAPIをチェックしなかったため、問題が残っていました。

**セキュリティ修正では、パターンを検索して全箇所を確認することが重要です。**

---

## 関連ドキュメント

- `SUBSCRIPTION-AUDIT-REPORT.md`: 元の問題を指摘した監査レポート
- `SECURITY_FIXES_SUMMARY.md`: 今回のセキュリティ修正全体のサマリー

---

**修正完了日**: 2026-03-10
**発見者**: ユーザーからの指摘（優れた発見！）
**次回確認**: 組織関連の新規API追加時に必ずチェック
