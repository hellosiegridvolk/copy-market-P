[English](README.md) | [简体中文](README_CN.md) | [繁體中文](README_TW.md) | [日本語](README_JP.md)

<p align="center">
  <img src="asset/logo.png" alt="COPY MARKET" width="200">
</p>

<h1 align="center">COPY MARKET</h1>

<p align="center">
  <strong>Polymarket 預測市場自動跟單交易機器人</strong>
</p>

<p align="center">
  <a href="https://github.com/neosun100/copy-market/actions"><img src="https://img.shields.io/badge/build-passing-brightgreen" alt="Build"></a>
  <a href="https://github.com/neosun100/copy-market/blob/main/LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
  <a href="https://hub.docker.com/r/neosun/copy-market"><img src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker" alt="Docker"></a>
  <img src="https://img.shields.io/badge/tests-40%20passed-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green?logo=node.js" alt="Node">
</p>

---

> **⚠️ 安全說明**：本專案 fork 自一個已知的惡意倉庫，該倉庫包含隱藏的私鑰竊取程式碼。所有惡意程式碼已被移除，經過 3 輪安全審計，專案已完全以安全優先的理念重寫。詳見[安全](#-安全)章節。

## ✨ 功能特性

- **多交易者跟單** — 同時追蹤和鏡像多個頂級 Polymarket 交易者的操作
- **3 種跟單策略** — 百分比、固定金額或自適應策略，支援分層乘數
- **緊急止損保護** — 當日虧損超過閾值時自動停止交易
- **預覽模式** — 乾跑模式，無需真實資金即可測試
- **交易聚合** — 將多筆小交易合併為可執行的大單
- **持倉追蹤** — 即使餘額變化也能準確追蹤買賣
- **Web 監控面板** — 暗色主題即時監控 UI，支援多語言
- **REST API + Swagger** — 完整 API，互動式文件位於 `/docs`
- **MCP 伺服器** — Model Context Protocol 整合，支援 AI 助手存取
- **Telegram 通知** — 交易執行、止損觸發和錯誤告警推送
- **零外部資料庫** — 使用 NeDB（本地檔案儲存），無需 MongoDB
- **Docker 就緒** — 單容器，189MB，一鍵部署

## 🚀 快速開始

### 方式一：Docker（推薦）

```bash
docker run -d --name copy-market \
  -p 3000:3000 \
  -v copy-market_data:/app/data \
  --env-file .env \
  neosun/copy-market:latest
```

### 方式二：從原始碼執行

```bash
git clone https://github.com/neosun100/copy-market.git
cd copy-market
npm install
cp .env.example .env   # 編輯設定
npm run build
npm start              # 機器人 + Web UI 執行在 3000 埠
```

## 🛡️ 安全

本專案 fork 自[已知惡意倉庫](https://phemex.com/blogs/openclaw-polymarket-automated-trading-analysis)，經過全面安全加固：

- ✅ 移除隱藏的私鑰竊取程式碼（`keccak256-helper` 供應鏈攻擊）
- ✅ 移除 2 個惡意 npm 套件
- ✅ 3 輪安全審計（程式碼、依賴、網路請求）
- ✅ 啟動時私鑰格式驗證
- ✅ 無外部資料洩露

## 🧪 測試

```bash
npm test                # 執行全部 40 個測試
npm run test:coverage   # 帶覆蓋率報告
npm run check-secrets   # 掃描洩露的金鑰
```

## 👥 貢獻者

<table>
<tr>
<td align="center">
<a href="https://github.com/neosun100">
<img src="https://avatars.githubusercontent.com/u/13846998?v=4" width="100px;" alt="Neo 孫"/>
<br /><sub><b>Neo 孫</b></sub>
</a>
<br />🛡️ 安全加固 & v2.0 重寫
</td>
<td align="center">
<a href="https://github.com/LesterCovata">
<img src="https://avatars.githubusercontent.com/u/123233333?v=4" width="100px;" alt="LesterCovata"/>
<br /><sub><b>LesterCovata</b></sub>
</a>
<br />📝 原始程式碼 (v1.0)
</td>
</tr>
</table>

> ⚠️ **關於原始程式碼的說明**：v1.0 是功能完整的跟單機器人，但包含隱藏的供應鏈攻擊——一個 `setTimeout` 藏在 500 字元行尾，悄悄將私鑰發送給惡意 npm 套件。所有惡意程式碼已在 v2.0 中移除。

## 📄 授權條款

MIT License — 詳見 [LICENSE.md](LICENSE.md)

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=neosun100/copy-market&type=Date)](https://star-history.com/#neosun100/copy-market)

## 📱 關注公眾號

![公眾號](https://img.aws.xin/uPic/扫码_搜索联合传播样式-标准色版.png)

---

**免責聲明**：本軟體僅供教育目的。交易存在虧損風險，請只投入您能承受損失的資金。
