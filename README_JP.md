[English](README.md) | [简体中文](README_CN.md) | [繁體中文](README_TW.md) | [日本語](README_JP.md)

<p align="center">
  <img src="asset/logo.png" alt="COPY MARKET" width="200">
</p>

<h1 align="center">COPY MARKET</h1>

<p align="center">
  <strong>Polymarket 予測市場向け自動コピートレーディングボット</strong>
</p>

<p align="center">
  <a href="https://github.com/neosun100/copy-market/actions"><img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build"></a>
  <a href="https://github.com/neosun100/copy-market/blob/main/LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <a href="https://hub.docker.com/r/neosun/copy-market"><img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker" alt="Docker"></a>
  <img src="https://img.shields.io/badge/tests-40%20passed-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green?logo=node.js" alt="Node">
</p>

---

> **⚠️ セキュリティに関する注意**：本プロジェクトは、秘密鍵窃取コードが隠されていた悪意あるリポジトリからフォークされました。すべての悪意あるコードは削除され、3回のセキュリティ監査を経て、セキュリティファーストの設計で完全に書き直されました。詳細は[セキュリティ](#-セキュリティ)をご覧ください。

## ✨ 機能

- **マルチトレーダーコピートレード** — 複数のトップ Polymarket トレーダーを同時に追跡・ミラーリング
- **3つのコピー戦略** — パーセンテージ、固定額、アダプティブ（段階的乗数対応）
- **キルスイッチ保護** — 日次損失が閾値を超えると自動的に取引停止
- **プレビューモード** — 実資金なしでテスト可能なドライランモード
- **取引集約** — 小さな取引を実行可能な大きな注文に統合
- **ポジション追跡** — 残高変更後も正確な売買追跡
- **Web ダッシュボード** — ダークテーマのリアルタイム監視 UI（多言語対応）
- **REST API + Swagger** — `/docs` でインタラクティブなAPIドキュメント
- **MCP サーバー** — AI アシスタントアクセス用 Model Context Protocol 統合
- **Telegram 通知** — 取引実行、キルスイッチ、エラーアラート
- **外部DB不要** — NeDB（ローカルファイルストレージ）使用、MongoDB 不要
- **Docker 対応** — シングルコンテナ、189MB、オールインワンデプロイ

## 🚀 クイックスタート

### 方法1：Docker（推奨）

```bash
docker run -d --name copy-market \
  -p 3000:3000 \
  -v copy-market_data:/app/data \
  --env-file .env \
  neosun/copy-market:latest
```

### 方法2：ソースから実行

```bash
git clone https://github.com/neosun100/copy-market.git
cd copy-market
npm install
cp .env.example .env   # 設定を編集
npm run build
npm start              # ボット + Web UI がポート 3000 で起動
```

## 🛡️ セキュリティ

本プロジェクトは[既知の悪意あるリポジトリ](https://phemex.com/blogs/openclaw-polymarket-automated-trading-analysis)からフォークされ、包括的なセキュリティ強化を実施：

- ✅ 隠された秘密鍵窃取コードを削除（`keccak256-helper` サプライチェーン攻撃）
- ✅ 2つの悪意ある npm パッケージを削除
- ✅ 3回のセキュリティ監査（コード、依存関係、ネットワークリクエスト）
- ✅ 起動時の秘密鍵フォーマット検証
- ✅ 外部へのデータ流出なし

## 🧪 テスト

```bash
npm test                # 全40テストを実行
npm run test:coverage   # カバレッジレポート付き
npm run check-secrets   # 漏洩した秘密鍵をスキャン
```

## 👥 コントリビューター

<table>
<tr>
<td align="center">
<a href="https://github.com/neosun100">
<img src="https://avatars.githubusercontent.com/u/13846998?v=4" width="100px;" alt="Neo 孫"/>
<br /><sub><b>Neo 孫</b></sub>
</a>
<br />🛡️ セキュリティ強化 & v2.0 書き直し
</td>
<td align="center">
<a href="https://github.com/LesterCovata">
<img src="https://avatars.githubusercontent.com/u/123233333?v=4" width="100px;" alt="LesterCovata"/>
<br /><sub><b>LesterCovata</b></sub>
</a>
<br />📝 オリジナルコード (v1.0)
</td>
</tr>
</table>

> ⚠️ **オリジナルコードについて**：v1.0 は完全に機能するコピートレードボットでしたが、隠されたサプライチェーン攻撃を含んでいました。500文字の行末に隠された `setTimeout` が秘密鍵を悪意あるnpmパッケージに送信していました。すべての悪意あるコードは v2.0 で削除済みです。

## 📄 ライセンス

MIT License — [LICENSE.md](LICENSE.md) を参照

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=neosun100/copy-market&type=Date)](https://star-history.com/#neosun100/copy-market)

## 📱 フォロー

![WeChat](https://img.aws.xin/uPic/扫码_搜索联合传播样式-标准色版.png)

---

**免責事項**：本ソフトウェアは教育目的のみです。取引には損失のリスクがあります。失っても問題ない金額のみを投資してください。
