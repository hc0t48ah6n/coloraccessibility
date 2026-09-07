/**
 * a11y-contrast-injector v1.0.0
 * 1行のscriptタグでWebページの低コントラストテキストを自動検知・補正するバニラJSライブラリ
 *
 * 特徴:
 * - ゼロ依存（バニラJS） / 軽量・高速
 * - 文字サイズ・太さに応じたWCAG大文字基準（3:1 / 4.5:1）自動判別
 * - 親要素の背景色・半透明（Alpha Blending）自動合成計算
 * - 色相（Hue）・彩度（Saturation）を極力維持したまま輝度のみ調整
 * - MutationObserver による動的コンテンツ（SPA / Ajax / モーダル）の自動追従
 * - プログラマブルなグローバルAPI (window.A11yContrastInjector)
 *
 * @license MIT
 */
(function (global) {
  'use strict';

  // --- スクリプト属性・オプションの初期化 ---
  const currentScript = document.currentScript;

  // デフォルト設定
  const defaults = {
    targetRatio: parseFloat(currentScript?.getAttribute('data-target-ratio') || '4.5'), // 基本目標比率 (WCAG AA: 4.5)
    largeTextRatio: parseFloat(currentScript?.getAttribute('data-large-ratio') || '3.0'), // 大文字目標比率 (WCAG AA: 3.0)
    ignoreClass: currentScript?.getAttribute('data-ignore-class') || 'a11y-ignore',
    autoObserve: currentScript?.getAttribute('data-auto-observe') !== 'false', // MutationObserver の自動有効化
    debug: currentScript?.hasAttribute('data-debug') || false
  };

  let config = { ...defaults };
  let mutationObserver = null;
  const processedElements = new WeakSet();

  // --- 色計算・カラーモデルヘルパー関数 ---

  /**
   * RGBからsRGB相対輝度 (Relative Luminance) を算出 (WCAG 2.1定義)
   */
  function getLuminance(r, g, b) {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
  }

  /**
   * 2つのRGBカラーからコントラスト比 (1:1 〜 21:1) を計算
   */
  function getContrastRatio(rgb1, rgb2) {
    const lum1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
    const lum2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
    const brightest = Math.max(lum1, lum2);
    const darkest = Math.min(lum1, lum2);
    return (brightest + 0.05) / (darkest + 0.05);
  }

  /**
   * CSSの色文字列 (rgb/rgba) をオブジェクト分解
   */
  function parseColor(colorStr) {
    if (!colorStr || colorStr === 'transparent' || colorStr.includes('rgba(0, 0, 0, 0)')) {
      return null;
    }
    const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) return null;
    return {
      r: parseInt(match[1], 10),
      g: parseInt(match[2], 10),
      b: parseInt(match[3], 10),
      a: match[4] !== undefined ? parseFloat(match[4]) : 1.0
    };
  }

  /**
   * アルファブレンディング（半透明色と背景色の合成計算）
   */
  function blendColors(fg, bg) {
    if (fg.a >= 1.0) return fg;
    const alpha = fg.a;
    return {
      r: Math.round(fg.r * alpha + bg.r * (1 - alpha)),
      g: Math.round(fg.g * alpha + bg.g * (1 - alpha)),
      b: Math.round(fg.b * alpha + bg.b * (1 - alpha)),
      a: 1.0
    };
  }

  /**
   * DOMツリーを親要素へと遡り、不透明な最終実効背景色を取得
   */
  function getEffectiveBackgroundColor(element) {
    let current = element;
    let accumulatedColor = { r: 255, g: 255, b: 255, a: 1.0 }; // フォールバック: 白 (#ffffff)
    const bgStack = [];

    while (current && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      const bg = parseColor(style.backgroundColor);
      if (bg) {
        bgStack.unshift(bg);
        if (bg.a >= 0.99) break; // 完全不透明な背景に到達したら探索終了
      }
      current = current.parentElement;
    }

    // 重なった背景色を不透明になるまで下層から合成
    for (const bg of bgStack) {
      accumulatedColor = blendColors(bg, accumulatedColor);
    }

    return accumulatedColor;
  }

  /**
   * RGB -> HSL 変換
   */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  /**
   * HSL -> RGB 変換
   */
  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }

  /**
   * 色相（Hue）と彩度（Saturation）を維持し、二分探索で目標コントラスト比を満たす最適輝度を調整
   */
  function adjustColorForContrast(textColor, bgColor, requiredRatio) {
    const bgLum = getLuminance(bgColor.r, bgColor.g, bgColor.b);
    const hsl = rgbToHsl(textColor.r, textColor.g, textColor.b);

    // 背景が明るい場合は文字を暗く、背景が暗い場合は文字を明るくする
    const shouldDarken = bgLum > 0.5;

    let minL = shouldDarken ? 0 : hsl.l;
    let maxL = shouldDarken ? hsl.l : 100;
    let bestRgb = textColor;

    // 二分探索で最適なLightness（12段階で高精度に収束）
    for (let i = 0; i < 12; i++) {
      const midL = (minL + maxL) / 2;
      const testRgb = hslToRgb(hsl.h, hsl.s, midL);
      const ratio = getContrastRatio(testRgb, bgColor);

      if (ratio >= requiredRatio) {
        bestRgb = testRgb;
        if (shouldDarken) minL = midL; else maxL = midL; // より元の色に近い輝度を探す
      } else {
        if (shouldDarken) maxL = midL; else minL = midL;
      }
    }

    return `rgb(${bestRgb.r}, ${bestRgb.g}, ${bestRgb.b})`;
  }

  /**
   * WCAG 2.1 の大文字（Large Text）基準に該当するか判定
   * 大文字条件: 18pt (24px) 以上、または 14pt (18.66px) 以上かつ Bold (font-weight >= 700)
   */
  function isLargeText(computedStyle) {
    const fontSize = parseFloat(computedStyle.fontSize) || 16;
    const fontWeight = computedStyle.fontWeight;
    const isBold = fontWeight === 'bold' || parseInt(fontWeight, 10) >= 700;

    if (fontSize >= 24) return true;
    if (fontSize >= 18.66 && isBold) return true;

    return false;
  }

  /**
   * 単一要素の診断とCSS注入
   */
  function processElement(el) {
    if (!el || !(el instanceof HTMLElement)) return;

    // 除外判定（クラス指定、既に補正済み、または無視属性）
    if (el.classList.contains(config.ignoreClass) ||
        el.getAttribute('data-a11y-ignore') === 'true' ||
        processedElements.has(el)) {
      return;
    }

    // 直下にテキストノードを含んでいるか確認
    const hasDirectTextNode = Array.from(el.childNodes).some(
      node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
    );

    if (!hasDirectTextNode) return;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;

    const textColor = parseColor(style.color);
    if (!textColor) return;

    const bgColor = getEffectiveBackgroundColor(el);
    const currentRatio = getContrastRatio(textColor, bgColor);

    // 大文字判定により必要目標比率を決定 (WCAG AA: 通常4.5:1 / 大文字3.0:1)
    const requiredRatio = isLargeText(style) ? config.largeTextRatio : config.targetRatio;

    if (currentRatio < requiredRatio) {
      const originalColorStr = style.color;
      const newColorStr = adjustColorForContrast(textColor, bgColor, requiredRatio);

      // 補正結果の適用
      el.style.color = newColorStr;
      el.setAttribute('data-a11y-fixed', 'true');
      el.setAttribute('data-a11y-original-color', originalColorStr);
      el.setAttribute('data-a11y-ratio', currentRatio.toFixed(2));

      if (config.debug) {
        console.log('[a11y-contrast-injector] Fixed:', el, {
          before: currentRatio.toFixed(2),
          requiredRatio,
          from: originalColorStr,
          to: newColorStr
        });
      }
    }

    processedElements.add(el);
  }

  /**
   * 指定したルート配下の対象要素を一括スキャン
   */
  function scan(root = document.body) {
    if (!root) return;

    const selector = 'p, h1, h2, h3, h4, h5, h6, span, a, li, label, button, td, th, blockquote, figcaption, input, textarea';
    
    // ルート要素自体が対象の場合
    if (root.matches && root.matches(selector)) {
      processElement(root);
    }

    const elements = root.querySelectorAll(selector);
    for (let i = 0; i < elements.length; i++) {
      processElement(elements[i]);
    }
  }

  /**
   * DOMの動的変化（MutationObserver）の監視開始
   */
  function startObserver() {
    if (mutationObserver || !window.MutationObserver) return;

    mutationObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              scan(node);
            }
          });
        }
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * DOM監視停止
   */
  function stopObserver() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
  }

  /**
   * 元の状態へリセット
   */
  function reset() {
    const fixedElements = document.querySelectorAll('[data-a11y-fixed="true"]');
    fixedElements.forEach(el => {
      const orig = el.getAttribute('data-a11y-original-color');
      if (orig) {
        el.style.color = orig;
      } else {
        el.style.color = '';
      }
      el.removeAttribute('data-a11y-fixed');
      el.removeAttribute('data-a11y-original-color');
      el.removeAttribute('data-a11y-ratio');
    });
  }

  // --- 公開API (window.A11yContrastInjector) ---
  const publicAPI = {
    version: '1.0.0',
    scan,
    reset,
    startObserver,
    stopObserver,
    configure: (newOptions) => {
      config = { ...config, ...newOptions };
      scan();
    },
    getConfig: () => ({ ...config })
  };

  global.A11yContrastInjector = publicAPI;

  // --- 自動起動処理 ---
  function init() {
    scan();
    if (config.autoObserve) {
      startObserver();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(typeof window !== 'undefined' ? window : this);