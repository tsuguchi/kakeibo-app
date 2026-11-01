# Firestore データ構造と暗号化の設計（ドラフト v0.2）

最終更新: 2026-11-02
要件は [REQUIREMENTS.md](REQUIREMENTS.md) を参照。

## 1. 全体像

```
users/{uid}                     暗号化の鍵の情報（包んだ鍵）など
├── meta/categories             分類の一覧
├── meta/accounts               口座の一覧
├── meta/balances               口座ごとの残高
├── meta/budgets                予算
├── meta/recurring              毎月の自動記録の設定
├── summaries/{YYYY-MM}         月ごとの集計
└── transactions/{txId}         記録（収入・支出・振替）
```

設計の方針：

- データはすべて `users/{uid}` の下に置き、本人だけが読み書きできるようにする（3 章）
- 家計の中身は、すべてブラウザで暗号化した `enc` フィールドに入れる。暗号化しないのは、検索に使う年月と作成・更新の日時だけ（REQUIREMENTS.md 4.9）
- 暗号化した中身はサーバーで検索・集計できないため、次のように読み込み件数を抑える
  - 記録は年月（`month`）で絞って、その月の分だけ読み込む。並べ替えと絞り込みはブラウザで復号してから行う
  - 月ごとの集計と口座の残高は、別のドキュメントに持たせる。記録の追加・変更・削除と同じトランザクションの中で、ブラウザで復号して足し引きし、暗号化し直して書き込む
  - 分類・口座・予算・自動記録の設定は、種類ごとに 1 つのドキュメントにまとめる
- 読み込み件数の目安: アプリを開くと、`users/{uid}` 1 件 + `meta` 5 件 + 今月の集計 1 件 + 今月の記録（1 か月 300 件なら 300 件）で約 310 件。12 か月の移り変わりを見ると、集計 12 件が増える。1 人 1 日 1,000 件程度の目標（REQUIREMENTS.md 5 章）に収まる
- Firestore のブラウザ内のキャッシュ（persistentLocalCache）を使うと、同じ月を開き直したときの読み込みを減らせる。キャッシュに残るのは暗号化された状態のデータなので、使ってよい

## 2. 暗号化の設計

### 2.1 使う方式

| 用途 | 方式 | 理由 |
|---|---|---|
| データの暗号化 | AES-256-GCM（ブラウザ標準の Web Crypto API） | 改ざんも検出できる。ブラウザ標準で使える |
| 暗号化パスワードから鍵を作る | Argon2id（m=19456 KiB、t=2、p=1） | OWASP の推奨で第一候補。値は OWASP が示す最低限の設定の 1 つ |
| 復旧キーから鍵を作る | HKDF-SHA256（Web Crypto API） | 復旧キーは十分に長いランダムな値なので、時間のかかる方式は要らない |
| マスターキーから用途別の鍵を作る | HKDF-SHA256（Web Crypto API） | 1 つのマスターキーから、暗号化用と ID 用の鍵を分けて作る |
| 自動記録の記録 ID を作る | HMAC-SHA256（Web Crypto API） | 同じ設定・同じ月なら同じ ID になり、二重の記録を防げる。ID から中身は分からない |

- 確認した情報（2026-11-02）:
  - OWASP Password Storage Cheat Sheet: Argon2id が第一候補。PBKDF2 は FIPS-140 への準拠が必要な場合の選択肢。Argon2id の最低限の設定の例として m=19456 KiB、t=2、p=1 が示されている
  - Argon2id はブラウザ標準の Web Crypto API に入っていない（Chrome で試験中の新しい方式の一覧にも含まれない）
- Argon2id は JavaScript だけで書かれたライブラリ `@noble/hashes`（MIT ライセンス）の `argon2idAsync` で動かす（2026-11-02 に決定）
  - 候補だった WebAssembly の `hash-wasm` は、2024-11 から更新が止まっていたため使わない
  - WebAssembly を使わないので、Content Security Policy に `wasm-unsafe-eval` を足さずに済む
  - 計算の途中で画面の処理に順番を譲るので、計算中も画面が固まらない
  - 同じ入力で両方のライブラリが同じ結果を出すことを確かめた
- かかった時間（パソコン）: Node.js で 137 ミリ秒、Chrome で鍵の作成全体が 157 ミリ秒。スマホでは数倍かかる見込みで、実機で測ってから設定の値を決める
- 暗号化パスワードを入力したときだけ計算し、「この端末で覚える」を選んだ端末では毎回は計算しない
- 方式と設定の値は `users/{uid}` に保存する。将来、より強い設定に変えるときに、古い設定のデータも開けるようにするため

### 2.2 鍵の構成

```
暗号化パスワード ──Argon2id──▶ パスワード鍵 ─┐
                                              ├─ 包む（AES-GCM）─▶ マスターキー（32 バイトのランダムな値）
復旧キー ─────────HKDF──────▶ 復旧鍵 ───────┘                          │
                                                                        ├─HKDF─▶ 暗号化鍵（AES-256-GCM）
                                                                        └─HKDF─▶ ID 鍵（HMAC-SHA256）
```

- マスターキーは、初めての設定（F-80）のときにブラウザで作る。サーバーには、パスワード鍵と復旧鍵でそれぞれ包んだ（暗号化した）ものだけを保存する
- 暗号化パスワードの変更（F-83）は、マスターキーをパスワード鍵で包み直すだけで済む。記録を暗号化し直す必要はない
- 復旧キーでの再設定（F-84）は、復旧鍵でマスターキーを取り出し、新しい暗号化パスワードで包み直す
- 復旧キーは 160 ビットのランダムな値を、読み間違えにくい文字（Crockford の Base32）で 4 文字ずつ区切って表示する（例: `7K3M-9QXA-…`、32 文字）
- 暗号化パスワードが合っているかは、包んだマスターキーを取り出せるかで確かめる（AES-GCM は鍵が違うと取り出しに失敗する）。確認用の値を別に保存しない
- 「この端末で覚える」（F-82）を選んだときは、暗号化鍵と ID 鍵を、取り出し不可（non-extractable）の CryptoKey としてブラウザの IndexedDB に保存する。ブラウザの中のプログラムからも鍵の中身は読み出せない。ログアウトすると消す

### 2.3 暗号化したデータの形

暗号化する項目は、まとめて JSON にしてから暗号化し、`enc` フィールドに入れる。

| フィールド | 型 | 説明 |
|---|---|---|
| enc.v | number | 暗号化の形式の版（今は 1） |
| enc.iv | bytes | 12 バイトのランダムな値。暗号化のたびに作り直す |
| enc.ct | bytes | 暗号文（AES-GCM の認証タグを含む） |

- 追加認証データ（AAD）に、ドキュメントのパス（例: `users/{uid}/transactions/{txId}`）と `enc.v` を入れる。暗号文を別のドキュメントに付け替えられても、復号に失敗して気づける

## 3. コレクション定義

金額はすべて 1 円単位の整数。日付は `YYYY-MM-DD` の文字列。ID はブラウザで作るランダムな文字列（Firestore の自動 ID）。

### users/{uid}

ドキュメント ID は Firebase Authentication の uid。暗号化しない。

| フィールド | 型 | 説明 |
|---|---|---|
| createdAt | timestamp | 作成日時 |
| crypto.v | number | 鍵の構成の版（今は 1） |
| crypto.kdf | map | `{ name: "argon2id", m: 19456, t: 2, p: 1 }` |
| crypto.passwordSalt | bytes | Argon2id のソルト（16 バイト） |
| crypto.wrappedByPassword | map | パスワード鍵で包んだマスターキー（`iv`・`ct`） |
| crypto.recoverySalt | bytes | 復旧キー用の HKDF のソルト（16 バイト） |
| crypto.wrappedByRecovery | map | 復旧鍵で包んだマスターキー（`iv`・`ct`） |

`crypto` がまだないときは、初めての設定の画面（F-80）を出す。

### users/{uid}/meta/categories

分類の一覧（F-20、F-21）。`enc` の中身:

```json
{
  "items": [
    { "id": "c1", "kind": "expense", "name": "食費", "order": 0, "hidden": false }
  ]
}
```

### users/{uid}/meta/accounts

口座の一覧（F-30、F-32）。`enc` の中身:

```json
{
  "items": [
    { "id": "a1", "type": "bank", "name": "〇〇銀行", "openingBalance": 120000, "order": 0, "hidden": false }
  ]
}
```

`type` は `cash`・`bank`・`credit`・`emoney`・`other`。

### users/{uid}/meta/balances

口座ごとの今の残高（F-31）。`enc` の中身: `{ "a1": 98500, "a2": -32000 }`

- 残高 = 使い始めの残高 + 収入 − 支出 ± 振替。クレジットカードは、使った分がマイナスになり、銀行からの支払い（振替）で 0 に戻る
- 記録の追加・変更・削除と同じトランザクションで更新する。ずれたときのために、設定画面から全件を読み直して計算し直す機能を用意する

### users/{uid}/meta/budgets

予算（F-50〜F-52）。`enc` の中身:

```json
{
  "items": [
    { "categoryId": "c1", "fromMonth": "2026-11", "amount": 40000 }
  ]
}
```

- ある月の予算は、その分類の `fromMonth` がその月以前のもののうち、いちばん新しいものを使う。これで「翌月以降に引き継ぐ」と「月ごとに変える」の両方を表せる
- 予算をなくすときは `amount: null` の行を足す

### users/{uid}/meta/recurring

毎月の自動記録の設定（F-60〜F-66）。`enc` の中身:

```json
{
  "items": [
    {
      "id": "r1",
      "type": "expense",
      "day": 27,
      "amount": 85000,
      "categoryId": "c3",
      "accountId": "a1",
      "toAccountId": null,
      "memo": "家賃",
      "startMonth": "2026-11",
      "endMonth": null,
      "shift": "next",
      "active": true,
      "generatedThrough": "2026-10"
    }
  ]
}
```

- `day` は 1〜31、または月末を表す `"last"`
- `shift` は `none`（ずらさない）・`prev`（前の平日）・`next`（次の平日）
- `generatedThrough` は、記録を作り終えた最後の月（ずらす前の月）。記録した分を利用者が削除しても、同じ月の分を作り直さないために使う

### users/{uid}/summaries/{YYYY-MM}

月ごとの集計（F-40〜F-42、F-51）。ドキュメント ID は年月。`enc` の中身:

```json
{
  "income": 300000,
  "expense": 215000,
  "byCategory": { "c1": 38000, "c3": 85000 }
}
```

振替は含めない。予算と比べるときは、`byCategory` と `meta/budgets` から計算する。

### users/{uid}/transactions/{txId}

記録（F-10〜F-15）。

| フィールド | 型 | 暗号化 | 説明 |
|---|---|---|---|
| month | string | しない | 記録の年月 `YYYY-MM`。月ごとの読み込みに使う |
| createdAt | timestamp | しない | 作成日時 |
| updatedAt | timestamp | しない | 更新日時 |
| enc | map | する | 中身（下の JSON） |

```json
{
  "type": "expense",
  "date": "2026-11-27",
  "amount": 85000,
  "categoryId": "c3",
  "accountId": "a1",
  "toAccountId": null,
  "memo": "家賃",
  "source": { "kind": "recurring", "recurringId": "r1", "originalDate": "2026-11-27" }
}
```

- `type` は `income`・`expense`・`transfer`。振替のときは `categoryId` を `null` にし、`accountId` が出金元、`toAccountId` が入金先
- `source.kind` は `manual`（手入力）・`recurring`（自動記録）・`import`（CSV の取り込み）。`originalDate` は、自動記録で休日をずらす前の日付（F-63、F-65）
- 自動記録の分の `txId` は、`HMAC(ID 鍵, recurringId + ずらす前の年月)` を Base64URL にしたもの。同じ設定の同じ月なら同じ ID になる（F-62）

## 4. 主な処理の流れ

### 4.1 記録の追加・変更・削除

1 つのトランザクションで、次をまとめて行う。

1. `meta/balances` と、関係する月の `summaries` を読み込んで復号する（記録の月を変えたときは、前後 2 か月分）
2. 金額を足し引きする（変更のときは、もとの記録の分を引いてから新しい分を足す）
3. 記録・集計・残高を暗号化して書き込む

書き込みは 1 件の記録につき 3〜4 件。1 日 2 万件の無料枠に十分収まる。

### 4.2 毎月の自動記録（F-61、F-62）

アプリを開き、データを復号した後に行う。

1. `meta/recurring` を読み、有効な設定ごとに、`generatedThrough` の次の月から順に次を繰り返す
   1. その月の日付を決める（`day` がその月にないときは月末）
   2. `shift` に従って休日をずらす
   3. ずらした後の日付が今日より後なら、そこで止める
   4. 記録を作り、`generatedThrough` をその月にする
2. 記録・集計・残高・`meta/recurring` を 1 つのトランザクションで書き込む。2 台の端末で同時に開いても、片方のトランザクションがやり直しになり、`generatedThrough` を読み直すので二重にならない。ID も同じになるので、万一のときも上書きで済む

### 4.3 CSV の取り込みと重複の見分け（F-72〜F-74）

1. CSV を読み、画面で列を対応付ける。文字コードは UTF-8 と Shift_JIS を自動で見分け、違えば画面で切り替えられるようにする
2. CSV の日付の範囲の前後 3 日を含む月の記録を読み込み、復号する
3. 取り込み先の口座の記録と、REQUIREMENTS.md F-74 の条件で比べる。既存の記録 1 件は、明細の 1 行とだけ組にする
4. 確かめてもらった後、50 件ずつのトランザクションで書き込む（集計と残高も同時に更新する）

### 4.4 アカウントの削除（F-07）

1. もう一度ログインしてもらう
2. ブラウザから `transactions`・`summaries`・`meta` の全ドキュメントを削除し、最後に `users/{uid}` を削除する
3. Firebase Authentication のユーザーを削除する
4. 途中で失敗したときは、もう一度削除をやり直せるようにする（残ったデータは暗号化されているので、鍵がなければ読めない）

## 5. Security Rules の方針

- `users/{uid}` とその下のすべては、`request.auth.uid == uid` のときだけ読み書きできる
- メールアドレスでログインした人は、メールアドレスを確認済み（`email_verified == true`）のときだけ読み書きできる（F-03）。Google と GitHub でログインした人には、この条件を付けない
- 書き込みのときに、形を確かめる
  - `enc.v` が数値、`enc.iv` が 12 バイトの bytes、`enc.ct` が bytes で 100KB 以下
  - `transactions` の `month` が `YYYY-MM` の形
  - 決められたフィールド以外を書き込めない
- 中身は暗号化されているので、金額などの値の正しさはルールでは確かめられない。ブラウザ側の処理とテストで担保する
- ルールのテストを、Firebase のエミュレーターで書く（タスク管理ボードと同じやり方）

## 6. 祝日のデータ（F-66）

- 内閣府の「国民の祝日」の CSV（`https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv`、Shift_JIS）から、祝日の日付の一覧を JSON にしてアプリに組み込む
- 変換は、リポジトリの中の小さなスクリプトで行い、JSON に入手した日と、載っている最後の年を書き込む
- 2026-11-02 時点で、2027 年分まで載っていることを確かめた

## 7. 必要なインデックス

- `transactions` の `month` の等号だけで検索するので、自動で作られる単一フィールドのインデックスで足りる。複合インデックスは要らない

## 8. 安全のための注意点

- いちばんの脅威は、アプリの画面に悪意のあるプログラムを差し込まれること（XSS）。復号した後のデータや鍵が盗まれる。次で防ぐ
  - React の通常の書き方だけを使い、HTML をそのまま差し込む書き方（`dangerouslySetInnerHTML`）を使わない
  - Content Security Policy を設定し、自分のサイトと Firebase 以外からプログラムを読み込めないようにする
  - 依存するパッケージを最小限にする
- 暗号化パスワード・マスターキー・復号した中身を、ログやエラーの報告に出さない
- 運営する側に分かる情報（ログインのメールアドレス、記録の年月と件数、作成・更新の日時）は、プライバシーポリシーに書く

## 9. 未決事項

- Argon2id の設定の値（スマホの実機で時間を測ってから決める）
