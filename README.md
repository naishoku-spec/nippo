# 2階製造 (Production Log)

複数人で共有可能な日報管理ツールです。

## 技術スタック
- HTML5 / CSS3 / JavaScript (Vanilla)
- [Firebase Realtime Database](https://firebase.google.com/) - データのリアルタイム共有
- [Flatpickr](https://flatpickr.js.org/) - カレンダーUI

## 主な機能
- **製品名の自動引き継ぎ**: 翌営業日に前日の製品名を自動でセット。
- **カレンダー色分け**: 土曜日(青)、日曜日・祝日(赤)を自動判別。
- **モバイル対応**: スマホからでも入力しやすいカードレイアウト。
- **自動集計**: 日別・月別の生産数を自動計算。
- **データ同期**: Firebaseによる複数端末間でのリアルタイム同期。

## ローカル版の起動

1. `start-local.cmd`をダブルクリックします。
2. `http://127.0.0.1:8765/`で画面を開きます。
3. `index.html`などを直接開いた場合も、起動中のローカルHTTP版へ移動します。

ローカル版も本番と同じFirebaseのデータパスを使用します。ブラウザの保存領域は本番とは別ですが、記録の正本はFirebaseです。`index copy.html`などのコピー版やJavaScriptファイルを直接開かないでください。

## 公開時に必要なファイル

画面の入口は次の4ページです。

- `index.html` + `app.js`
- `1f.html` + `1f-app.js`
- `1f-kenpin.html` + `1f-kenpin-app.js`
- `saidan.html` + `saidan-app.js`

共通で`style.css`、`1f-style.css`、`shared-sync.js`、`app-version.json`、`local-entry.js`を使用します。`local-server.js`と`start-local.cmd`はローカル起動用で、公開ページの動作やFirebaseのデータには影響しません。
