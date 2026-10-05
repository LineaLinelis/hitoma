# ひとま / HITOMA

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

World ID **Proof of Human** を通過した人だけが書き込める、匿名・テキストのみの掲示板の最小実装です。Cloudflare **Workers Free + D1 Free + 無料の workers.dev サブドメイン**で運用する構成です。

MITライセンスのOSSとして公開しています。各自のWorld ID・Cloudflareアカウントで設定して運用できます。現在はプロトタイプで、ホスト済みサービス・継続的な運営・サポートの提供はありません。

**実装・ローカル動作確認済み。本番は未配備で、実際のWorld ID認証は未接続です。** アカウントと鍵を設定するまで投稿APIは閉じています。画面の「表示例を読む」は読み取り専用の例で、D1に架空の投稿を作りません。

## できること

- 誰でも閲覧。話題別の一覧、20件ずつのページング、表示中の投稿の検索。
- Proof of Human認証後にスレッド、返信、通報を送信。
- ユーザー名、公開ユーザーID、プロフィール、画像、添付、HTML表示、Markdown装飾、URL自動リンクはなし。
- 投稿本文に作者・World ID・認証セッションのIDを保存しない。
- 通報一覧と管理者による投稿・返信の削除。
- 投稿はスレッド作成から30日で非表示。そのスレッドの返信・通報も日次処理で削除。

## 最初の運用上限

| 項目                      | 上限                         |
| ------------------------- | ---------------------------- |
| タイトル                  | 80 Unicode文字               |
| 本文・返信                | 2,000 Unicode文字            |
| 認証状態                  | 24時間                       |
| 1認証セッションの書き込み | UTCの1日あたり20回、30秒間隔 |
| 掲示板全体の書き込み      | UTCの1日あたり300回          |
| 認証リクエストの受付      | UTCの1日あたり200回          |
| 保存する投稿＋返信        | 合計10,000件                 |
| 閲覧可能な保存期間        | スレッド作成から30日         |

通報も書き込み予算を1回消費します。回数・保存件数はSQLiteの制約・トリガーとD1の原子的な`batch()`で守るため、並列リクエストで超過させられません。失敗した書き込みは枠を消費しません。

これは**認証セッション単位**の制限です。同じ人が別のWorldセッションを作り直すことまでは防ぎません。「1人1アカウント」や「1人1日20回」を厳密に保証する仕組みではありません。

## アカウントなしでローカル確認

Node.js 22.12以上（検証環境はNode.js 24）を使用します。

```bash
git clone https://github.com/LineaLinelis/hitoma.git
cd hitoma
npm ci
npm run build
npm run db:local
npm run preview
```

`http://localhost:8787` を開きます。World ID未設定なので閲覧のみです。「表示例を読む」で一覧・返信の画面を確認できます。

フロントエンドを変更する場合は、別のターミナルで `npm run dev` を実行すると、Viteの `/api` がローカルWorkerへ転送されます。

```bash
npm test
npm run typecheck
```

テストのWorld検証レスポンスはテスト内のモックです。公開用コードにモック認証・テスト用秘密鍵・投稿の抜け道はありません。

## 本番への設定

### 1. Cloudflare Freeを選ぶ

Cloudflareの無料アカウントを作成し、**Workers Free**であることを確認してください。有料プラン、独自ドメイン、R2、KV、有料の解析や外部サービスはこの実装には不要です。

```bash
npx wrangler login
npx wrangler d1 create hitoma
```

返された `database_id` を `wrangler.jsonc` に設定します。既存のWorkerと名前が重ならないよう `name` も選んでください。`APP_ORIGIN` は最終的な公開先のオリジン（例：`https://hitoma.<自分のサブドメイン>.workers.dev`）。末尾スラッシュは付けません。

### 2. World Developer Portal

[World Developer Portal](https://developer.world.org) でアプリを作り、World ID 4.0のRP登録を設定してください。App ID、RP ID、RP署名キーを取得し、公開先のドメインを登録します。**productionのProof of Human資格（issuer schema 1）が有効な利用者だけを受け付けます。** 端末認証、パスポート、Selfie Check、staging/sandboxは投稿に使えません。

`wrangler.jsonc` の `vars.WORLD_APP_ID` と `vars.WORLD_RP_ID` を設定します。この2つは公開設定です。署名キーはSecretにします。

認証はWorld ID 4の[セッション証明](https://docs.world.org/world-id/idkit/session-proofs)です。アクションごとに1度のuniqueness証明をログインに転用しないため、再認証ができます。既存の未期限切れセッションの再確認では、Worldセッションの一致も検査します。

### 3. Secretを設定

下記コマンドは対話入力です。秘密鍵をソース、チャット、シェル引数、`VITE_`変数に書かないでください。

```bash
npx wrangler secret put WORLD_RP_SIGNING_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ADMIN_SECRET
```

`SESSION_SECRET` と `ADMIN_SECRET` は、それぞれ別の32文字以上の暗号学的乱数を使用してください。パスワードマネージャー等で生成・保管できます。署名キーはPortalのキーをそのまま入力します。

ローカルの本物の認証を試す場合は `.env.example` を参考に、git対象外の `.dev.vars` に設定してください。認証Cookieには `Secure` を必須にしているため、**HTTPSのプレビュー**を使い、`APP_ORIGIN` とWorld Portalの許可先を一致させます。本番とローカルのD1は別です。

### 4. マイグレーションと配備

```bash
npm run db:remote
npm run deploy
```

`deploy` はD1 ID・公開設定・必須Secret名を確認し、ビルドして配備します。設定がないままの誤配備を止めます。マイグレーション済みのSQLは後から書き換えず、変更時には新しいマイグレーションを追加してください。

配備後、実際のProof of Humanを持つWorld IDで「認証 → 投稿 → 返信 → 再認証」を確認してください。無料プランで初回認証時のCPU制限、World APIの到達性、公開ドメインの登録もここで確認します。

## 0円で維持する条件

2026-10-05に確認した公式の無料枠です。変更される可能性があるので、運用時には公式価格ページを確認してください。

| Cloudflare Freeの項目   | 無料枠                            |
| ----------------------- | --------------------------------- |
| 静的ファイルの配信      | 無料・リクエスト数無制限          |
| Workersの動的リクエスト | アカウント全体で100,000回/日      |
| WorkerのCPU             | 1リクエストあたり10ms             |
| D1の行読み取り          | アカウント全体で5,000,000行/日    |
| D1の行書き込み          | アカウント全体で100,000行/日      |
| D1容量                  | 1DBあたり500MB、アカウント合計5GB |

出典：[Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)、[静的配信](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)、[D1料金](https://developers.cloudflare.com/d1/platform/pricing/)、[D1上限](https://developers.cloudflare.com/d1/platform/limits/)。

静的配信はWorkerを通さず、APIだけをWorkerに送ります。常時接続・自動ポーリング・全件検索をせず、DBのインデックスとページングで読み取り量を抑えます。署名の楕円曲線の公開テーブルはWorkerの起動時に計算し、初回の認証リクエストに大きい初期計算を持ち込まないようにしています。

**Workers Freeのままなら、無料枠超過時はリクエストやD1の処理が拒否されます。有料プランへのアップグレードを自動化するコードはありません。** 無料枠を超えて動き続けることや、アクセス集中・攻撃に対する稼働継続は保証しません。アカウントの他のアプリも同じ無料枠を消費します。

投稿上限は小規模運用の初期値で、Cloudflare使用量の上限そのものではありません。認証や不正アクセス、削除時のインデックス更新も行数に含まれます。D1使用量・DB容量・Worker CPUをCloudflare Dashboardで確認し、上限近くでは受付を止める運用を優先してください。

World APIへは署名と検証のHTTPリクエストのみを送り、オンチェーン取引・ガス代・有料RPC・有料APIを使用しません。Worldの本番利用条件・将来の料金変更はPortalと公式資料で確認が必要です。

## 匿名性の範囲

「名前や公開IDを持たない匿名掲示板」は実装しています。**運営者や通信基盤も含めた完全な追跡不能は実現・保証していません。**

| データ                                   | このアプリでの扱い                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| 氏名・メール・ウォレット・公開ユーザーID | 求めない・保存しない                                                    |
| 投稿と作者の対応表                       | 作らない                                                                |
| IP・アクセスログ・解析・広告             | アプリでは収集しない。Workerのobservabilityも無効                       |
| World証明・生のnullifier                 | 検証時だけ処理し、D1やログに保存しない                                  |
| WorldセッションID                        | 暗号化したHttpOnly Cookie内に24時間保持。再認証時に当該ブラウザーへ渡す |
| 連投制限                                 | Worldセッション＋UTC日付のHMACだけを、投稿と独立した表で保持            |
| 証明の再利用・ログアウト後の失効         | HMACのみを保持。期限後に日次削除                                        |
| 投稿時刻                                 | 分単位で保存                                                            |

連投制限のハッシュは日付ごとに変わり、最大約3日で削除します。チャレンジは5分で失効し、最大約1日で削除。証明と失効情報のハッシュは24時間有効で、最大約2日で削除します。日次削除が失敗した場合は管理者が復旧し、滞留したデータを削除します。

リクエスト処理時にはサーバーが認証Cookieと投稿本文を同時に扱います。運営者によるコード変更・計測、CloudflareやWorldの通信メタデータ、IPを扱う通信事業者、文章や時刻の推測からの追跡まで防ぐ設計ではありません。Worldの検証API自身には証明とセッション情報が送られます。匿名性をさらに強めるには、別の脅威モデルと匿名認証・通信の設計が必要です。

投稿に個人情報を書けば内容から特定されます。人間性の証明は「本人が手入力した」「AIを使っていない」「正しい内容である」の証明ではなく、人間による代理投稿や自動化も排除しません。

削除済みデータが基盤のバックアップに残る期間は、プロバイダーの復旧機能の仕様に従います。

## 運営

運営者は `ADMIN_SECRET` をBearerトークンとして下記APIに送ります。鍵をブラウザーの公開コードには置きません。

| 操作                             | API                                     |
| -------------------------------- | --------------------------------------- |
| 最新100件の通報と対象本文        | `GET /api/admin/reports`                |
| スレッド・配下の返信・通報の削除 | `DELETE /api/admin/threads/{thread_id}` |
| 返信とその通報の削除             | `DELETE /api/admin/replies/{reply_id}`  |

通報による自動削除はありません。自己編集・自己削除は作者と投稿の対応表を作らない初期仕様のためありません。誤って書いた個人情報は通報して管理者に削除してもらう運用です。管理者自身の掲示板投稿にもProof of Humanは必要です。

毎日03:17 UTCのCronで保存期間を超えたスレッドと認証補助データを削除します。ローカルでCronを確認する場合：

```bash
curl http://localhost:8787/cdn-cgi/local/scheduled
```

## 検証と構成

- `src/`：React + Viteの画面。World ID UIは認証開始時だけ読み込む。
- `worker/`：Workers API、暗号化Cookie、Worldクラウド検証、投稿、管理。
- `migrations/`：D1スキーマ、書き込み上限・連投防止・保存件数のトリガー。
- `tests/`：実D1を使った認証境界・再利用・同時投稿・TTL・削除等のテスト。公式SDKとの署名一致とWorkersランタイムでの実行も検査。
- `scripts/preflight.mjs`：配備前の設定漏れ検査。
- `public/_headers`：CSP、Referrer-Policy等。認証SDKの外部フォントは許可せず、システムフォントへフォールバック。

実際のWorld Appでの認証・本番の公開・本番無料枠のCPU測定は、アカウント未準備のため未実施です。テストでの成功は本番のWorld ID認証成功を意味しません。

## ライセンスと参加

このプロジェクトは[MIT License](LICENSE)で提供します。依存ライブラリは各プロジェクトのライセンスに従います。報告・変更の手順は[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。
