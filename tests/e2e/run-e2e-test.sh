#!/bin/bash

# Stripe E2E統合テスト実行スクリプト
# 使用方法: ./tests/e2e/run-e2e-test.sh

set -e

# カラー出力
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Stripe E2E統合テスト${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# 前提条件チェック
echo -e "${YELLOW}[1/5] 前提条件をチェック中...${NC}"

# Stripe CLIがインストールされているか確認
if ! command -v stripe &> /dev/null; then
    echo -e "${RED}エラー: Stripe CLIがインストールされていません${NC}"
    echo "インストール方法: brew install stripe/stripe-cli/stripe"
    exit 1
fi
echo "  ✓ Stripe CLIがインストール済み"

# .envファイルが存在するか確認
if [ ! -f ".env" ]; then
    echo -e "${RED}エラー: .envファイルが見つかりません${NC}"
    exit 1
fi
echo "  ✓ .envファイルが存在します"

# 必要な環境変数が設定されているか確認（.envファイルの存在確認のみ）
if grep -q "STRIPE_SECRET_KEY=" .env; then
    echo "  ✓ STRIPE_SECRET_KEYが設定されています"
else
    echo -e "${RED}エラー: STRIPE_SECRET_KEYが設定されていません${NC}"
    exit 1
fi

if grep -q "SUPABASE_URL=" .env; then
    echo "  ✓ SUPABASE_URLが設定されています"
else
    echo -e "${RED}エラー: SUPABASE_URLが設定されていません${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}[2/5] Stripe CLIログイン状態を確認中...${NC}"

# Stripe CLIがログイン済みか確認
if ! stripe config --list &> /dev/null; then
    echo -e "${RED}エラー: Stripe CLIにログインしていません${NC}"
    echo "実行してください: stripe login"
    exit 1
fi
echo "  ✓ Stripe CLIにログイン済みです"

echo ""
echo -e "${YELLOW}[3/5] テスト実行手順${NC}"
echo ""
echo "このスクリプトは前提条件の確認のみを行います。"
echo "実際のE2Eテストは手動で実行してください。"
echo ""
echo "詳細な手順は以下を参照:"
echo "  - docs/stripe-cli-setup.md の「E2E統合テスト手順（T8）」セクション"
echo "  - tests/e2e/README.md"
echo ""

echo -e "${YELLOW}[4/5] 必要なコマンド${NC}"
echo ""
echo "1. ターミナル1でStripe CLIを起動:"
echo -e "   ${GREEN}stripe listen --forward-to localhost:5173/api/stripe/webhook${NC}"
echo ""
echo "2. ターミナル2で開発サーバーを起動:"
echo -e "   ${GREEN}npm run dev${NC}"
echo ""
echo "3. ブラウザでテストシナリオを実行:"
echo "   - 個人課金: http://localhost:5173/pricing"
echo "   - 組織課金: http://localhost:5173/organizations/[org-id]/settings/billing"
echo ""

echo -e "${YELLOW}[5/5] DB状態検証${NC}"
echo ""
echo "テスト実行後、以下のSQLファイルでDB状態を検証できます:"
echo -e "   ${GREEN}tests/e2e/verify-db-state.sql${NC}"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}準備完了！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Stripe CLIとdevサーバーを起動後、手動テストを開始してください。"
