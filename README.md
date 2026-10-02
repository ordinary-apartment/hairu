# Hairu

設置できる幅・奥行・高さ（cm）と予算から、楽天市場の収納家具の候補を探すWebアプリ。

公開URL: **https://ordinary-apartment.github.io/hairu/**

## 構成

ビルドツールや外部ライブラリを必要としないHTML/CSS/JavaScript（ES Modules）と、Node.js 24の取得・ビルド処理を使用しています。

```text
GitHub Actions Repository secrets
  RAKUTEN_APP_ID / RAKUTEN_ACCESS_KEY
         ↓ Actions内だけで使用
楽天市場商品検索API 20260701
         ↓ 必要な公開商品情報だけを抽出
dist/data/catalog.json + ホワイトリストの静的ファイル
         ↓ Pages artifact（保持1日）
GitHub Pages → ブラウザでサイズ・予算を絞り込み
```

GitHub Pagesは静的配信のため、ユーザーの検索ごとに秘密情報を使って楽天APIを呼び出すことはできません。本実装は**定期取得した候補をブラウザで検索する方式**です。楽天市場全体のリアルタイム検索ではありません。リアルタイム検索へ拡張する場合は、別のサーバー/APIプロキシとそのホスティングが必要です。

## API接続とセキュリティ

- エンドポイント: `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701`
- **Secret名は変更しません**: `RAKUTEN_APP_ID` → `applicationId`クエリ、`RAKUTEN_ACCESS_KEY` → `accessKey`リクエストヘッダー。
- Affiliate IDは送信せず、APIから返る通常の`itemUrl`にリンクします。
- 家具ジャンル`200166`に限定し、8種類のキーワードを各最大3ページ（各30件）取得。最大720件から重複・明確な部品・売切れ・税別価格を除外します。分類は取得キーワードによるものです。
- リクエストは直列で1.2秒間隔。429・5xx・通信失敗は最大3回、2秒・4秒の待機を挟んで再試行。認証エラーは再試行しません。
- SecretsはActions取得ステップにのみ渡します。ブラウザ・HTML・JS・JSON・ログ・Git履歴には出しません。生のエラー、リクエストURL、APIレスポンス全体はログに出しません。
- 公開データは必要な商品フィールドのみ。公開URLを楽天ドメインのHTTPSに制限し、商品リンクの追跡クエリ・フラグメントを削除します（画像はサイズ指定の`_ex`のみ保持）。DOMには`textContent`で文字列を挿入します。CSPは同一オリジンのスクリプト・通信のみ許可します。
- ビルドの公開ファイルはホワイトリスト方式。最終出力にSecretsの実値・URLエンコードした値がないか検査し、含まれる場合はビルドを停止します。
- 生成商品データはcommitしません。6時間ごと・mainへのpush・手動起動で更新し、Pagesにデプロイします。
- 価格取得時刻を商品カードにも表示。24時間を過ぎたデータは初回・検索時・追加表示時・1分ごとの確認で表示を止めます。長時間開いたタブにも対応します。

## 寸法判定

現行の公式出力仕様と、実際のAPIレスポンスの両方で、幅・奥行・高さの専用数値フィールドがないことを確認しました。実レスポンスには`itemCaption`と`attributeIds`があり、属性情報は数値の本体寸法ではありません。

`scripts/dimensions.mjs`が**商品説明に「本体サイズ」「本体外寸」「商品サイズ」などの外寸を示すラベルがあり、その直後に幅・奥行・高さの全3軸と単位が明記されている場合だけ**抽出します。日本語ラベルやW/D/H、cm/mm、全角、小数を扱います。mmはcmに換算します。推測で寸法を補いません。軸名のない`60×30×120`は順序を推測せず対象外です。

- 内寸・収納部・棚板・梱包サイズは判定に使いません。
- 単位不足・寸法不足・範囲表記・伸縮商品・複数の異なる本体サイズ・商品名との不一致・除外された突起等の判定困難な記載は「サイズ要確認」にします。
- 同じ3寸法が繰り返されている場合は1候補として扱います。
- 商品カードに幅・奥行・高さと、説明中の**根拠の記載箇所**を表示します。
- 3軸すべて入力上限以下なら「記載サイズが条件内」。サイズ超過の商品は除外。確定できない商品は「サイズ要確認」としてその後に表示（チェックボックスで非表示にできます）。
- 自動抽出であり設置を保証しません。商品ページで選択サイズ・外寸・扉の開閉・搬入経路を確認してください。
- 予算は税込の商品価格で判定（送料別）。SKU等で価格に幅がある商品はAPIの購入可能価格上限を使って絞り込み、カードには価格範囲を表示します。

## エラー時の動作

- 一部の取得失敗: 取得できた候補を表示し、取得失敗の家具の種類を通知します。
- API全失敗・Secrets未設定: 空の`unavailable`カタログを公開し、API取得不能を表示します。古い商品を新しいものとして再利用しません。
- 取得成功で条件0件: 条件を変更する案内を表示します。
- JSON読込失敗・形式不正: 通信エラーと再読み込みボタンを表示します。
- 更新停止・24時間超過: 価格表示を停止し、更新待ちを表示します。
- 商品画像の読込失敗: 画像の代替テキストを表示します。

## 開発・検証

Node.js 24以上とPython 3を使用します。アプリの実行時依存はありません。ブラウザ検証には開発用のPlaywrightを使います（Macではインストール済みChrome、CIではChromium）。

```sh
cd /Users/hirabayashi/Desktop/hairu
npm test
npm ci
npm run test:ui
node scripts/build.mjs --offline
npm run preview
# http://localhost:4173
```

ローカルのofflineビルドはAPI未接続の表示を検証するものです。本物の商品データの取得には、Repository secretsを使うActionsを実行してください。Secretsをコマンド引数やローカルファイルに書く必要はありません。

CIは寸法抽出、3軸・予算の境界、価格範囲、並び順、0件、期限切れ、URL安全性、API認証送信、リトライ、全失敗・部分失敗、出力への秘密情報混入を検証します。PlaywrightでPC・スマートフォン幅の入力・検索・並び順・根拠表示・0件・通信復旧・期限切れ・HTML挿入防止・追加表示を検証します。PR検証にはSecretsを渡しません。

`npm run test:live`は公開URLの実カタログを使い、両画面幅の検索・寸法根拠・0件・横スクロールがないこと・ブラウザから楽天APIを直接呼ばないことを読み取りのみで検証します。

## GitHub Pagesと運用

公開元は**GitHub Actions**です（初期状態のmain/rootから変更）。ソースは引き続きmainのrootに配置しますが、商品データをGit履歴に残さずPages artifactで配信するため、branch/root方式ではなくActions方式を採用しています。

- `.github/workflows/deploy.yml`: テスト → 最新カタログ取得 → Pagesへデプロイ。
- `.github/workflows/test.yml`: push / PRのSecrets不要検証。
- `.github/workflows/probe.yml`: 手動のAPI接続・レスポンス観測用。観測artifactは1日で削除されます。
- `Update catalog and deploy Hairu`をActions画面から手動実行すると再取得できます。
- GitHubのスケジュールは遅延・停止する場合があります。長期無活動で無効化される場合もあるため、Actions実行状況を確認してください。更新停止時はブラウザで価格を非表示にしますが、Pages自体にはHTTP応答ごとの動的な削除機能はありません。
- 公開カタログは限定的な候補です。0件は楽天市場全体に該当商品がないことを意味しません。自動寸法抽出は厳しめのため未判定の商品もあります。

## 確認した公式資料

- [楽天市場商品検索API 現行仕様](https://webservice.rakuten.co.jp/documentation/ichiba-item-search)
- [サイズ・色データの取得について](https://webservice.faq.rakuten.net/hc/ja/articles/25589776667545)
- [キャッシュ・更新頻度・取得日時の表示](https://webservice.faq.rakuten.net/hc/ja/articles/900001974343)
- [クレジット表示](https://webservice.rakuten.co.jp/guide/credit)
