# 2階日報 (Production Log)

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
