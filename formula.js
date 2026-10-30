// 化学式の文法チェック（純粋関数のみ。DOMにもストレージにも触れない）。
// 元素記号として実在するものだけを受け入れることで、"MP3" "HTTP2" "COVID19" のような
// 一般語の誤検出を大幅に減らす。括弧つきの式（Ca(OH)2）にも対応する。
// Wikipedia等、<sub>の直前に空白を1つ挿入して表示する「C 6H 12O 6」のような表記にも対応する
// （要素記号の直後・数字の直前にだけ現れる空白は読み飛ばす。地の文の単語間の空白とは区別する）。
// 反応式の係数（2H2O）・水和物（CuSO4·5H2O）・重水素/三重水素（D2O, T2O）にも対応する。
// 括弧・係数・水和物の乗数をすべて展開した原子ごとの個数も計算し、PubChemへ問い合わせる際は
// その「合成済みの式」（例: CuSO4·5H2O → CuH10O9S）を使う。PubChemの分子式検索エンドポイントは
// 中黒や水和物の区切りをそのまま解釈してくれないため、ここで誤って展開しないと検索自体が失敗する。
// popup / sidepanel / ページ内ハイライト（content script）から共通利用する。
(function (global) {
  const ELEMENT_LIST =
    ("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
     "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu " +
     "Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr").split(" ");
  const ELEMENTS = new Set(ELEMENT_LIST);
  // D（重水素）・T（三重水素）は元素周期表の記号ではなく、かつ"D""T"単体がごく普通の英字であるため、
  // 他の元素記号（V, I, C, O, U, P, F等）と偶然つながって "COVID19" "HTTP2" "UTF8" のような
  // 一般語を誤検出する原因になることを確認した。そのため、ページ内自動ハイライトでは使わず、
  // ユーザーが明示的に入力・選択した検索（検索欄）でのみ許可する。
  const ELEMENTS_WITH_ISOTOPES = new Set([...ELEMENT_LIST, "D", "T"]);
  const MAX_LENGTH = 80; // 水和物（係数＋区切り＋別の式）を許容するため、単純な式よりやや余裕を持たせる
  const MAX_DEPTH = 3;
  const MAX_SEGMENTS = 4; // 水和物の連結段数の上限（通常は1〜2段）
  // Hill式での並び順（炭素→水素→それ以外はアルファベット順）。D/Tは水素の同位体として扱う。
  const HILL_FIRST = ["C", "H", "D", "T"];
  // 許容する空白の種類（半角スペース・ノーブレークスペース・シンスペース等）。
  // Wikipediaのような百科事典サイトが <sub> の前に挿入することがある文字を含む。
  const SOFT_SPACE = "[ \\u00A0\\u2007\\u2008\\u2009\\u200A\\u202F]";
  const SOFT_SPACE_RE = new RegExp(SOFT_SPACE);
  const SOFT_SPACE_RE_ANCHORED = new RegExp(`${SOFT_SPACE}$`);
  // 水和物の区切り文字（中黒 "·" が一般的。検索欄からの手入力に限り "*" も許可する）
  const HYDRATE_SEP_RE = /^[·*]/;

  // 文法: formula := coefficient? group+ (hydrateSep coefficient? group+)*
  //       group := (Element | '(' formula ')') digits?
  // 要素記号の直後・数字の直前・各group境界・係数の前後・区切り文字の前後では、
  // 空白を最大1つだけ読み飛ばして良い。読み飛ばした空白の「位置」を記録しておき、
  // 妥当と判定できた場合だけ、その位置だけを取り除いた詰め表記（clean、表示用）を組み立てる。
  // 同時に、括弧・係数・水和物の乗数をすべて展開した原子ごとの個数（counts、検索用）も計算する。
  // allowIsotopes: true のとき D（重水素）・T（三重水素）を元素記号として受け入れる。
  // ユーザーが明示的に入力・選択した検索（検索欄）でのみ true にする。
  function parse(input, { allowIsotopes = false } = {}) {
    const s = String(input);
    if (s.length === 0 || s.length > MAX_LENGTH) return { valid: false };
    const elements = allowIsotopes ? ELEMENTS_WITH_ISOTOPES : ELEMENTS;
    let i = 0;
    let hasDigit = false;
    let hasParen = false;
    const skipped = [];
    const totalCounts = new Map(); // 最終的な原子ごとの個数（全セグメント・全乗数を適用済み）

    function addTo(map, symbol, n) {
      map.set(symbol, (map.get(symbol) || 0) + n);
    }

    function skipSoftSpace() {
      if (i < s.length && SOFT_SPACE_RE.test(s[i])) {
        skipped.push(i);
        i++;
      }
    }

    // 係数（反応式の "2H2O" の "2"、水和物中の "5H2O" の "5"）。無くても1として扱う。
    function consumeCoefficient() {
      skipSoftSpace();
      const m = /^\d{1,3}/.exec(s.slice(i));
      if (!m) return 1;
      i += m[0].length;
      hasDigit = true;
      skipSoftSpace();
      return parseInt(m[0], 10);
    }

    // このセグメント（括弧の中、または最上位）に含まれる原子を集計したMapを返す。
    // 不正な構文の場合は null を返す。
    function groups(depth) {
      let count = 0;
      const local = new Map();
      for (;;) {
        skipSoftSpace();
        // ")" のほか、水和物の区切り文字（·, *）が来たら、要素記号として解釈しようとせずに
        // ここで素直に止まる（続きは呼び出し元のhydrateループが処理する）。
        if (i >= s.length || s[i] === ")" || HYDRATE_SEP_RE.test(s[i])) break;

        let symbol = null;
        let subCounts = null;
        if (s[i] === "(") {
          if (depth >= MAX_DEPTH) return null;
          i++;
          hasParen = true;
          const inner = groups(depth + 1);
          if (!inner || i >= s.length || s[i] !== ")") return null;
          i++;
          subCounts = inner;
        } else {
          const m = /^[A-Z][a-z]?/.exec(s.slice(i));
          if (!m) return null;
          symbol = m[0];
          if (!elements.has(symbol)) {
            symbol = symbol[0]; // 2文字目が別の語の一部だった場合は1文字の元素として再解釈
            if (!elements.has(symbol)) return null;
          }
          i += symbol.length;
        }

        skipSoftSpace();
        const digits = /^\d{1,3}/.exec(s.slice(i));
        let n = 1;
        if (digits) {
          i += digits[0].length;
          hasDigit = true;
          n = parseInt(digits[0], 10);
        }

        if (subCounts) {
          for (const [sym, c] of subCounts.map) addTo(local, sym, c * n);
        } else {
          addTo(local, symbol, n);
        }
        count++;
      }
      // atoms>=2判定には「式中に書かれた元素トークンの個数」(count)を使う。
      // 原子の総数（例: "O2"なら2）ではなく、"O2"という1トークンとして数える
      // ("O2"単体のような弱い根拠での誤検出を防ぐ、従来からの設計を維持するため)。
      return count > 0 ? { count, map: local } : null;
    }

    const coef1 = consumeCoefficient();
    const seg1 = groups(0);
    if (!seg1) return { valid: false };
    for (const [sym, c] of seg1.map) addTo(totalCounts, sym, c * coef1);
    let atoms = seg1.count;

    // 水和物（CuSO4·5H2O）: 区切り文字が続く限り、係数つきの式をさらに連結する
    for (let seg = 0; seg < MAX_SEGMENTS; seg++) {
      skipSoftSpace();
      if (i >= s.length || !HYDRATE_SEP_RE.test(s[i])) break;
      i++; // 区切り文字そのもの
      skipSoftSpace();
      const coefN = consumeCoefficient();
      const segN = groups(0);
      if (!segN) return { valid: false };
      for (const [sym, c] of segN.map) addTo(totalCounts, sym, c * coefN);
      atoms += segN.count;
    }

    if (i !== s.length) return { valid: false };

    let clean = s;
    for (let k = skipped.length - 1; k >= 0; k--) {
      clean = clean.slice(0, skipped[k]) + clean.slice(skipped[k] + 1);
    }
    return { valid: true, atoms, hasDigit, hasParen, clean, counts: totalCounts };
  }

  // 原子ごとの個数（Map）から、PubChemの分子式検索が期待するHill式の文字列を組み立てる
  // （例: Ca:1,H:4,O:6,S:1 → "CaH4O6S"）。炭素を含む場合はC→H→アルファベット順、
  // 含まない場合は全元素をアルファベット順に並べる。個数が1の元素は数字を省略する。
  function toHillFormula(counts) {
    const hasCarbon = counts.has("C");
    const keys = [...counts.keys()];
    const firstKeys = hasCarbon ? HILL_FIRST.filter((k) => counts.has(k)) : [];
    const restKeys = keys.filter((k) => !firstKeys.includes(k)).sort();
    let out = "";
    for (const k of [...firstKeys, ...restKeys]) {
      const n = counts.get(k);
      out += n > 1 ? `${k}${n}` : k;
    }
    return out;
  }

  // Unicodeの下付き数字（₀〜₉）を通常の数字に置き換える。1文字対1文字なので文字位置はずれない。
  function normalizeSubscripts(text) {
    return String(text).replace(/[\u2080-\u2089]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x2080 + 48));
  }

  // 表示用に、下付き数字・許容した空白を取り除いた「詰めた」表記にする（例: "C 6H 12O 6" → "C6H12O6"）。
  // 水和物の区切りや係数はそのまま残す（見た目の情報を保つため）。
  // 妥当な化学式として解釈できた場合のみ文字列を返し、そうでなければ null。
  function normalizeFormula(text) {
    const result = parse(normalizeSubscripts(text), { allowIsotopes: true });
    return result.valid ? result.clean : null;
  }

  // PubChemへの問い合わせ用に、係数・水和物をすべて展開した合成済みの式（Hill式）を返す。
  // 単純な式（係数も水和物もない）の場合は normalizeFormula と同じ結果になる。
  function toSearchFormula(text) {
    const result = parse(normalizeSubscripts(text), { allowIsotopes: true });
    return result.valid ? toHillFormula(result.counts) : null;
  }

  // 文章中から化学式らしい部分を探す際の候補パターン。
  // 空白は「直後が数字の場合」に限って候補に含める（= 要素記号のすぐ後ろだけ）。
  // それ以外の空白（単語の区切りなど）は候補をそこで打ち切ることで、地の文を巻き込まないようにする。
  // 中黒（·）は水和物表記のために候補へ含める（出現頻度が低く、地の文を巻き込むリスクが小さいため）。
  // 直前の文字が英字・アンダースコアの場合のみ候補の開始を拒否し、数字は拒否しない
  // （"2H2O" のような反応式の係数を、候補の一部ではなく直前の文脈として後から拾えるようにするため）。
  const CANDIDATE = new RegExp(
    `(?<![A-Za-z_\\u2080-\\u2089])[A-Z](?:[A-Za-z0-9()·\\u2080-\\u2089]|${SOFT_SPACE}(?=\\d))*`,
    "g"
  );

  function countChar(str, ch) {
    return str.split(ch).length - 1;
  }

  // raw（マッチした式）の直前に「反応式の係数」（例: "2H2O" の "2"）があれば、その分だけ
  // 開始位置を前方に広げて返す。係数の前は単語の続きでないこと（"page2H2O" 等を弾く）を確認する。
  function extendForLeadingCoefficient(text, start) {
    const back = text.slice(Math.max(0, start - 6), start);
    const m = /(\d{1,3})[ \u00A0\u2007\u2008\u2009\u200A\u202F]?$/.exec(back);
    if (!m) return 0;
    const beforeCoef = back.slice(0, m.index);
    if (beforeCoef && /[A-Za-z0-9_]$/.test(beforeCoef)) return 0;
    return back.length - m.index;
  }

  // 文章中から化学式らしい部分を探す（ページ内ハイライト用）。
  // 誤検出を抑えるため「原子が2個以上」かつ「数字か括弧を含む」ものに限る。D/T同位体は使わない
  // （allowIsotopesを指定しない＝デフォルトfalseのため）。
  // 戻り値の raw はページ上の元の表記（係数があれば含む）、text は検索用の合成済み式（Hill式）。
  // 判定・正規化とも同じ parse() の結果を使うことで、CANDIDATE の切り出しと矛盾しないようにする。
  function findFormulas(text) {
    const str = String(text);
    const found = [];
    for (const m of str.matchAll(CANDIDATE)) {
      let raw = m[0];
      // 末尾の空白・不整合な閉じ括弧はtrimする（候補の切り出しが広すぎた場合の後始末）
      while (
        raw.length > 0 &&
        (SOFT_SPACE_RE_ANCHORED.test(raw) ||
          raw.endsWith("·") ||
          (raw.endsWith(")") && countChar(raw, "(") < countChar(raw, ")")))
      ) {
        raw = raw.slice(0, -1);
      }
      if (!raw) continue;
      const result = parse(normalizeSubscripts(raw));
      if (!(result.valid && result.atoms >= 2 && (result.hasDigit || result.hasParen))) continue;

      const coefLen = extendForLeadingCoefficient(str, m.index);
      const start = m.index - coefLen;
      const fullRaw = str.slice(start, m.index) + raw;
      // 係数込みの raw を正式に再解析し、検索用のHill式を作る（先頭の係数もここで数に反映される）
      const withCoef = parse(normalizeSubscripts(fullRaw));
      const searchText = withCoef.valid ? toHillFormula(withCoef.counts) : toHillFormula(result.counts);
      found.push({ start, end: m.index + raw.length, text: searchText, raw: fullRaw });
    }
    return found;
  }

  // 検索欄用の緩い判定（数字なしのNaClなども許可。空白入りの表記も許可。D/T同位体記法も許可）
  function isFormula(text) {
    return parse(normalizeSubscripts(text), { allowIsotopes: true }).valid;
  }

  global.ChemFormula = { parse, findFormulas, isFormula, normalizeSubscripts, normalizeFormula, toSearchFormula, toHillFormula };
})(typeof window !== "undefined" ? window : globalThis);
