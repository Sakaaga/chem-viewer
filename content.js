// ページ内の化学式らしき文字列をうっすらハイライトし、「クリックしたときだけ」ポップアップで検索する機能。
// このスクリプトは、設定画面でONにして全サイトへのアクセス権限を許可した場合にのみ、
// highlight-sync.js が scripting.registerContentScripts で登録する（既定ではどのページにも注入されない）。
// 依存: libs/browser-polyfill.min.js, formula.js
// PubChemへの通信は行わない。クリックされた式は、選択して検索した場合と同じ経路
// （右クリックメニュー・ショートカットと共通のbackground.js側の処理）でポップアップに渡す。
(async function () {
  try {
    const stored = await browser.storage.local.get("settings");
    if (stored.settings?.autoHighlight !== true) return;

    // i18n.js は DOM 全体の data-i18n を書き換えるため、任意のWebページには読み込まない。
    function t(key) {
      return browser.i18n.getMessage(key) || key;
    }

    const MAX_WRAPS = 3000; // 1ページあたりのハイライト上限（到達したらコンソールに明示する）
    const CHUNK_MS = 12; // 1回の処理で使う時間の目安。ページ操作を妨げないよう時間で区切って進める
    const SKIP_SELECTOR =
      'a, button, code, pre, kbd, samp, svg, math, script, style, textarea, input, select, noscript, iframe, ' +
      '[role="button"], [contenteditable=""], [contenteditable="true"], .chemviewer-hl, #chemviewer-tooltip';
    const SUB_DIGITS = /^\d{1,3}$/;
    let wrapCount = 0;
    let limitReached = false;
    let skippedErrors = 0;

    // ---------- 見た目（スタイル・ツールチップ） ----------

    function injectStyles() {
      if (document.getElementById("chemviewer-style")) return;
      const style = document.createElement("style");
      style.id = "chemviewer-style";
      style.textContent = `
        .chemviewer-hl { border-bottom: 1px dotted #2563eb; cursor: pointer; }
        #chemviewer-tooltip {
          position: fixed; z-index: 2147483647; background: #111827; color: #f9fafb;
          font: 12px/1.5 sans-serif; padding: 8px 10px; border-radius: 6px; max-width: 260px;
          white-space: pre-line; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.25); display: none;
        }`;
      (document.head || document.documentElement).appendChild(style);
    }

    function getTooltip() {
      let el = document.getElementById("chemviewer-tooltip");
      if (!el) {
        el = document.createElement("div");
        el.id = "chemviewer-tooltip";
        document.body.appendChild(el);
      }
      return el;
    }

    // 画面外にはみ出さない位置に表示する
    function showTooltip(anchor, text) {
      const tooltip = getTooltip();
      tooltip.textContent = text;
      tooltip.style.display = "block";
      const rect = anchor.getBoundingClientRect();
      const w = tooltip.offsetWidth;
      const h = tooltip.offsetHeight;
      const left = Math.min(rect.left, window.innerWidth - w - 8);
      let top = rect.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
      tooltip.style.left = `${Math.max(8, left)}px`;
      tooltip.style.top = `${top}px`;
    }

    function hideTooltip() {
      getTooltip().style.display = "none";
    }

    // ---------- ポップアップでの検索（バックグラウンド経由） ----------

    // ホバー時は通信しない（静的なヒントのみ）。
    function handleHover(span, formula) {
      showTooltip(span, `${formula}\n${t("highlightClickHint")}`);
    }

    // クリックされたら、選択して検索した場合と同じ経路でポップアップを開く。
    // ページ側スクリプトが dispatchEvent した合成イベント(isTrusted=false)では動作しない。
    async function handleClick(span, formula, event) {
      if (!event.isTrusted) return;
      showTooltip(span, t("highlightOpening"));
      try {
        const res = await browser.runtime.sendMessage({ type: "chemviewer:analyze", formula });
        if (res?.opened) {
          hideTooltip(); // ポップアップが開いたので、ページ上のヒントは不要
        } else {
          // 古いブラウザ等でポップアップを自動で開けない場合は、バッジから開いてもらう
          showTooltip(span, t("highlightCheckToolbar"));
        }
      } catch {
        showTooltip(span, t("highlightError"));
      }
    }

    // ---------- ハイライトの付与 ----------

    function reportLimit() {
      if (limitReached) return;
      limitReached = true;
      console.info(`Chem Viewer: reached the highlight limit (${MAX_WRAPS}); the rest of this page is left as is.`);
    }

    // formula は検索用に正規化した表記（H2O）で、画面の表示は元のまま変えない。
    function makeHighlightSpan(formula) {
      const span = document.createElement("span");
      span.className = "chemviewer-hl";
      span.addEventListener("mouseenter", () => handleHover(span, formula));
      span.addEventListener("mouseleave", hideTooltip);
      span.addEventListener("click", (event) => handleClick(span, formula, event));
      return span;
    }

    // 通常のテキストノード内の式を囲む
    function wrapMatches(textNode) {
      if (limitReached || !textNode.parentNode) return;
      const text = textNode.nodeValue;
      const matches = ChemFormula.findFormulas(text);
      if (matches.length === 0) return;

      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      for (const match of matches) {
        if (wrapCount >= MAX_WRAPS) {
          reportLimit();
          break;
        }
        if (match.start > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
        const span = makeHighlightSpan(match.text);
        span.textContent = match.raw; // Unicode下付き（H₂O）もページ上の表記のまま残す
        frag.appendChild(span);
        lastIndex = match.end;
        wrapCount++;
      }
      if (lastIndex === 0) return; // 1件も囲まなかった
      if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      textNode.parentNode.replaceChild(frag, textNode);
    }

    // H<sub>2</sub>O のように下付き数字が <sub> 要素で書かれた式の処理。
    // テキストが「H」「<sub>2</sub>」「O」と別ノードに分かれるため、同じ親要素の子ノードを
    // 一続きの文字列に並べ直して検出し、該当範囲を Range で囲む（ページ上の文字は一切変えない）。
    function wrapSubscriptRuns(parent) {
      const segments = []; // { node, text, isSub, separator }
      for (const node of parent.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          segments.push({ node, text: node.nodeValue });
        } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "SUB" && SUB_DIGITS.test(node.textContent.trim())) {
          segments.push({ node, text: node.textContent.trim(), isSub: true });
        } else {
          segments.push({ node, text: " ", separator: true }); // 他の要素は区切りとして扱う（リンク等をまたがない）
        }
      }
      let flat = "";
      const map = []; // flat の各文字が、どのsegmentの何文字目か
      segments.forEach((seg, si) => {
        for (let i = 0; i < seg.text.length; i++) map.push({ si, i });
        flat += seg.text;
      });

      // 通常のテキストだけで成立する式は別処理に任せ、<sub>を1つ以上含むものだけを対象にする
      const found = ChemFormula.findFormulas(flat).filter((m) => {
        for (let k = m.start; k < m.end; k++) if (segments[map[k].si].isSub) return true;
        return false;
      });

      // 後ろから処理して、先に囲んだ範囲によって前方のノード位置がずれないようにする
      for (const m of found.reverse()) {
        if (wrapCount >= MAX_WRAPS) {
          reportLimit();
          break;
        }
        const first = map[m.start];
        const last = map[m.end - 1];
        const a = segments[first.si];
        const b = segments[last.si];
        if (a.isSub || a.separator || b.separator) continue;
        try {
          const range = document.createRange();
          range.setStart(a.node, first.i);
          if (b.isSub) range.setEndAfter(b.node);
          else range.setEnd(b.node, last.i + 1);
          range.surroundContents(makeHighlightSpan(m.text));
          wrapCount++;
        } catch {
          // 範囲が要素を分断する等で囲めない場合は、その式だけ諦める
        }
      }
    }

    function scanSubscripts(root) {
      const parents = new Set();
      if (root.tagName === "SUB" && root.parentElement) parents.add(root.parentElement);
      for (const sub of root.querySelectorAll("sub")) {
        if (sub.parentElement) parents.add(sub.parentElement);
      }
      for (const parent of parents) {
        if (limitReached) return;
        if (parent.closest(SKIP_SELECTOR)) continue;
        safely(() => wrapSubscriptRuns(parent));
      }
    }

    // ---------- 走査（時間で区切って進める） ----------

    let textTasks = []; // 未処理のテキストノード
    let taskIndex = 0;
    const pendingRoots = new Set(); // 走査待ちの要素
    let scheduled = false;

    // 1箇所の失敗でページ全体の処理が止まらないよう、ノード単位で失敗を隔離する
    function safely(fn) {
      try {
        fn();
      } catch (err) {
        if (skippedErrors++ < 3) console.warn("Chem Viewer: skipped a node because of an error:", err);
      }
    }

    function collectTextNodes(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || node.nodeValue.trim().length < 2) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      let current;
      while ((current = walker.nextNode())) textTasks.push(current);
    }

    function idle(fn) {
      if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 1000 });
      else setTimeout(fn, 30);
    }

    function schedule() {
      if (scheduled || limitReached) return;
      scheduled = true;
      idle(run);
    }

    function enqueue(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE || !el.isConnected) return;
      if (el.closest(SKIP_SELECTOR)) return;
      pendingRoots.add(el);
      schedule();
    }

    function run() {
      scheduled = false;
      const deadline = performance.now() + CHUNK_MS;
      try {
        for (const root of pendingRoots) {
          pendingRoots.delete(root);
          if (!root.isConnected) continue;
          safely(() => scanSubscripts(root)); // 先に <sub> 形式（囲んだ範囲は通常のスキャンから除外される）
          safely(() => collectTextNodes(root));
          if (performance.now() > deadline) break;
        }
        while (taskIndex < textTasks.length && performance.now() < deadline && !limitReached) {
          const node = textTasks[taskIndex++];
          safely(() => wrapMatches(node));
        }
        if (taskIndex >= textTasks.length || limitReached) {
          textTasks = [];
          taskIndex = 0;
        }
      } finally {
        // 自分自身のDOM変更で生じた記録は捨てる（それをまた走査して無限に繰り返すのを防ぐ）
        observer.takeRecords();
        if (limitReached) {
          pendingRoots.clear();
          observer.disconnect();
        } else if (pendingRoots.size > 0 || taskIndex < textTasks.length) {
          schedule();
        }
      }
    }

    // ---------- 動的に変わるページへの対応 ----------
    // 追加された要素・追加されたテキストノード・既存テキストの書き換え（React/Vue等がよく行う）を拾う。
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "childList") {
          for (const n of m.addedNodes) {
            if (n.nodeType === Node.ELEMENT_NODE) enqueue(n);
            else if (n.nodeType === Node.TEXT_NODE) enqueue(n.parentElement);
          }
        } else if (m.type === "characterData") {
          enqueue(m.target.parentElement);
        }
      }
    });

    injectStyles();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    enqueue(document.body);
  } catch (err) {
    console.error("Chem Viewer: page highlight failed to initialize", err);
  }
})();
