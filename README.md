
Webページの低コントラストなテキストを自動検出し、WCAG 2.1規格（AAレベル 4.5:1）を満たすアクセシブルなCSSを動的に注入する、超軽量・依存ゼロのバニラJavaScriptライブラリです。

面倒なNPMのインストールやビルド設定は一切不要。HTMLに1行のscriptタグを追加するだけで、あらゆるサイトのアクセシビリティをその場で向上させます。

✨ 主な特徴
超軽量 (~3.2 KB): 外部ライブラリ不使用の純粋なJS。読み込み速度を落としません。

リアルタイム監視 (MutationObserver): SPAやモーダル、非同期で後から追加された動的コンテンツも自動で検知・修正。

スマート色彩調整: 単なる黒・白への置き換えではなく、元のデザインの色相（Hue）やトーンを保ったまま輝度のみを自然に調整。

100% クライアントサイド: 外部サーバーへのデータ送信は一切なし。セキュリティやプライバシー面も安心。

📦 導入方法 (CDN)
Webサイトの <head> タグ内に、以下の1行を貼り付けるだけです：

HTML


<script src="[https://hc0t48ah6n.github.io/coloraccessibility/code.js](https://hc0t48ah6n.github.io/coloraccessibility/code.js)" defer></script>
⚙️ オプション設定（HTML属性）
scriptタグに属性を追加することで、手軽に動作をカスタマイズできます：

HTML


<script src="[https://hc0t48ah6n.github.io/coloraccessibility/code.js](https://hc0t48ah6n.github.io/coloraccessibility/code.js)" 
        data-target-ratio="7.0" 
        data-ignore-class="my-custom-ignore" 
        defer></script>
data-target-ratio: 目標とするコントラスト比（デフォルトはWCAG AA基準の 4.5。厳格なAAA基準にしたい場合は 7.0 を指定）。

data-ignore-class: このクラスが付与された要素は自動補正の対象外（スキップ）になります。

📄 ライセンス
MIT License © 2026 hc0t48ah6n
