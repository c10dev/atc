() => {
  // layout-probe v1 (ATC-311). Plain browser JS for the Playwright MCP `browser_evaluate` (paste this whole function as its `function`).
  // It installs window.__lp: controls(), mark(), check(label), step(selector). It reads boxes only; it changes nothing on the page.
  // Re-run it after a click that navigates (the page loses window.__lp); the "before" boxes live in sessionStorage and survive.
  if (window.__lp && window.__lp.v === 1) return "layout-probe already installed";
  const KEY = "__lp_before";
  const IGN = "__lp_ignore";
  const MAX = 700; // elements per snapshot
  const DEPTH = 8; // levels under the root
  const ROWS = 12; // first N children of a long list
  const LANDMARK = new Set(["HEADER", "NAV", "MAIN", "ASIDE", "FOOTER", "FORM", "TABLE", "THEAD", "TH", "H1", "H2", "H3"]);
  const ROWISH = new Set(["TR", "LI", "TD", "ARTICLE", "DD", "DT", "OPTION"]);
  const TAGS = new Set(["HEADER", "NAV", "MAIN", "ASIDE", "FOOTER", "SECTION", "ARTICLE", "FORM", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD", "UL", "OL", "LI", "DL", "DT", "DD", "BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY", "DETAILS", "H1", "H2", "H3", "H4", "H5", "H6", "P", "FIELDSET", "LEGEND"]);
  const CLS = /bar|toolbar|chip|badge|tag|pill|panel|card|row|list|grid|col|filter|tab|item|cell|detail|head|foot|group|count|tool|switch|toggle|status|label/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
  const hintOf = (el) => (el.id || el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.getAttribute("name") || ownText(el).slice(0, 24) || (el.classList[0] || "")).replace(/[|/#\[\]]/g, "_");
  const layoutBearing = (el) => {
    if (TAGS.has(el.tagName)) return true;
    if (el.tagName === "DIV" || el.tagName === "SPAN") return CLS.test(el.className && el.className.baseVal === undefined ? String(el.className) : "") || el.hasAttribute("role") || (el.tagName === "DIV" && el.children.length >= 2) || getComputedStyle(el).cursor === "pointer";
    return false;
  };
  const sigOf = (el) => {
    const s = getComputedStyle(el);
    return [s.fontWeight, s.borderTopWidth, s.borderLeftWidth, s.paddingTop, s.paddingLeft].join(",");
  };

  // boxes in page coordinates, keyed by tag + identity hint + occurrence under the same parent (an inserted sibling does not rename the others)
  function snapshot(rootSel) {
    const root = (rootSel && document.querySelector(rootSel)) || document.body;
    const sx = scrollX, sy = scrollY;
    const boxes = {};
    const keyOfEl = new WeakMap();
    let n = 0;
    (function walk(el, parentKey, depth) {
      const seen = {};
      const kids = [...el.children];
      const limit = kids.length > 30 ? ROWS : kids.length;
      for (let i = 0; i < kids.length && n < MAX; i++) {
        const c = kids[i];
        if (i >= limit && !ROWISH.has(c.tagName) && c.tagName !== "DIV") continue;
        if (i >= limit) continue;
        if (!visible(c)) continue;
        const tag = c.tagName;
        const h = hintOf(c);
        const base = tag + "[" + h + "]";
        seen[base] = (seen[base] || 0) + 1;
        const key = parentKey + "/" + base + "#" + seen[base];
        const bear = layoutBearing(c);
        if (bear) {
          const r = c.getBoundingClientRect();
          boxes[key] = [Math.round((r.left + sx) * 100) / 100, Math.round((r.top + sy) * 100) / 100, Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100, sigOf(c), tag];
          keyOfEl.set(c, key);
          n++;
        }
        if (depth < DEPTH) walk(c, bear ? key : parentKey, depth + 1);
      }
    })(root, "", 0);
    const d = document.documentElement;
    return { url: location.href, iw: innerWidth, cw: d.clientWidth, sw: d.scrollWidth, sh: d.scrollHeight, n, boxes, keyOfEl };
  }

  const strip = (s) => ({ url: s.url, iw: s.iw, cw: s.cw, sw: s.sw, sh: s.sh, n: s.n, boxes: s.boxes });
  function mark(rootSel) {
    const s = snapshot(rootSel);
    sessionStorage.setItem(KEY, JSON.stringify({ rootSel: rootSel || null, s: strip(s) }));
    return { marked: s.n, url: s.url };
  }

  function groupBy(list) {
    const m = new Map();
    for (const f of list) {
      const k = f.severity + "|" + f.cause + "|" + f.d.join(",");
      if (!m.has(k)) m.set(k, { ...f, count: 0, keys: [] });
      const g = m.get(k);
      g.count++;
      if (g.keys.length < 3) g.keys.push(f.key);
    }
    return [...m.values()].map(({ key, ...r }) => r);
  }

  function diff(b, a, opts, targetKey) {
    const thr = opts.threshold || 1;
    const addedKeys = Object.keys(a.boxes).filter((k) => !(k in b.boxes));
    const removedKeys = Object.keys(b.boxes).filter((k) => !(k in a.boxes));
    const structural = [...addedKeys.map((k) => a.boxes[k][5]), ...removedKeys.map((k) => b.boxes[k][5])].some((t) => !ROWISH.has(t));
    const sbBefore = b.iw - b.cw, sbAfter = a.iw - a.cw;
    // the content swap region: the lowest common ancestor of what appeared or disappeared (a detail panel, a table body).
    // What changes inside it is the intended change, unless the clicked control sits inside it too.
    const segs = [...addedKeys, ...removedKeys].map((k) => k.split("/"));
    let region = null;
    if (segs.length) {
      let common = segs[0];
      for (const sg of segs) {
        let i = 0;
        while (i < common.length && i < sg.length && common[i] === sg[i]) i++;
        common = common.slice(0, i);
      }
      const cand = common.join("/");
      if (common.length >= 3 && !(targetKey && (targetKey === cand || targetKey.startsWith(cand + "/")))) region = cand;
    }
    const out = [];
    for (const k of Object.keys(a.boxes)) {
      const p = b.boxes[k];
      if (!p) continue;
      const q = a.boxes[k];
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2], q[3] - p[3]].map((v) => Math.round(v * 10) / 10);
      const big = Math.max(...d.map(Math.abs));
      if (big < thr) continue;
      const tag = q[5];
      const own = targetKey && (k === targetKey || k.startsWith(targetKey + "/"));
      const sigChanged = p[4] !== q[4];
      const horizontal = Math.abs(d[0]) >= thr || Math.abs(d[2]) >= thr;
      let cause, fix;
      if (sbBefore !== sbAfter && Math.abs(d[2]) >= thr && Math.abs(d[0]) < thr) {
        cause = "scrollbar appears or disappears";
        fix = "scrollbar-gutter: stable";
      } else if (own && sigChanged) {
        const [w0, bt0, bl0, pt0, pl0] = p[4].split(","), [w1, bt1, bl1, pt1, pl1] = q[4].split(",");
        if (w0 !== w1) {
          cause = "font-weight changes on the active state";
          fix = "do not change weight, or reserve the bold width (::after bold-text trick)";
        } else {
          cause = "border or padding changes on the active state";
          fix = "keep the same box: border always present (transparent when off), or use outline / box-shadow";
        }
      } else if (own) {
        cause = "the clicked control's own box changed";
        fix = "keep the control's box constant across states";
      } else if (["TH", "TD", "TR", "COL", "COLGROUP"].includes(tag) && Math.abs(d[2]) >= thr) {
        cause = "table column width changes";
        fix = "fixed column widths or table-layout: fixed; tabular-nums for numbers";
      } else if (region && region.startsWith(k + "/") && d[2] === 0 && d[3] !== 0) {
        cause = "a container's height follows the swapped content";
        fix = "give the list area a min-height, or scroll it inside a fixed-height box, so what is below does not jump";
      } else if (!horizontal && (addedKeys.length || removedKeys.length) && !structural) {
        cause = "list rows added or removed";
        fix = "";
      } else if (!horizontal && structural && Math.abs(d[1]) >= thr && d[3] === 0) {
        cause = "pushed by inserted content";
        fix = "reserve the space, or overlay instead of insert";
      } else if (d[2] === 0 && d[3] !== 0) {
        cause = "text wraps or its height changes";
        fix = "overflow-wrap / min-width: 0, or a fixed-line layout";
      } else if (horizontal) {
        cause = "a sibling's width or position changes";
        fix = "reserve the width of the changing sibling (fixed width, min-width, or tabular-nums)";
      } else {
        cause = "unclassified shift";
        fix = "inspect what changed above or beside it";
      }
      const inRegion = region && (k === region || k.startsWith(region + "/"));
      let severity;
      if (inRegion) {
        severity = "Note";
        cause = "inside the swapped content region";
        fix = "";
      } else if (own) severity = "Note";
      else if (cause.startsWith("a container's height")) severity = opts.expectInsert || Math.abs(d[3]) < 100 ? "Note" : "Blocker";
      else if (cause === "list rows added or removed") severity = "Note";
      else if ((opts.expectInsert && cause === "pushed by inserted content") || big < 2 && !LANDMARK.has(tag)) severity = "Note";
      else severity = "Blocker";
      out.push({ key: k, tag, d, cause, fix, severity });
    }
    return { findings: out, added: addedKeys.length, removed: removedKeys.length, structural };
  }

  // elements that move with no click at all (a clock, a live feed): measure once, then ignore them in check()
  async function idle(rootSel, ms) {
    const b = snapshot(rootSel);
    await raf2();
    await sleep(ms == null ? 1500 : ms);
    const r = diff(strip(b), strip(snapshot(rootSel)), {}, null);
    const keys = r.findings.map((f) => f.key);
    sessionStorage.setItem(IGN, JSON.stringify(keys));
    return { idleMoving: keys.length, sample: keys.slice(0, 3) };
  }

  // opts: { target: css selector of the clicked control, expectInsert: true for a detail open/close, settle: ms (default 300), threshold: px (default 1) }
  async function check(label, opts) {
    opts = opts || {};
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { label, error: "no marked snapshot: call __lp.mark() before the click" };
    const m = JSON.parse(raw);
    await raf2();
    await sleep(opts.settle == null ? 300 : opts.settle);
    const a = snapshot(m.rootSel);
    let targetKey = null;
    if (opts.target) {
      const el = document.querySelector(opts.target);
      if (el) {
        let c = el;
        while (c && !a.keyOfEl.has(c)) c = c.parentElement;
        targetKey = c ? a.keyOfEl.get(c) : null;
      }
    }
    const navigated = m.s.url !== a.url;
    const r = diff(m.s, strip(a), opts, targetKey);
    const ign = new Set(JSON.parse(sessionStorage.getItem(IGN) || "[]"));
    if (ign.size) r.findings = r.findings.filter((f) => !ign.has(f.key));
    const grouped = groupBy(r.findings);
    const blockers = r.findings.filter((f) => f.severity === "Blocker").length;
    sessionStorage.setItem(KEY, JSON.stringify({ rootSel: m.rootSel, s: strip(a) })); // chain: the next click compares against this
    return {
      label,
      navigated,
      blockers,
      notes: r.findings.length - blockers,
      added: r.added,
      removed: r.removed,
      docWidthChange: a.sw - m.s.sw,
      docHeightChange: a.sh - m.s.sh,
      findings: grouped.sort((x, y) => (x.severity === y.severity ? y.count - x.count : x.severity === "Blocker" ? -1 : 1)).slice(0, 12),
    };
  }

  // mark, click in the page, then check. For a control that navigates, use mark() + browser_click + this file again + check() instead.
  async function step(selector, opts) {
    opts = { ...(opts || {}), target: selector };
    const el = document.querySelector(selector);
    if (!el) return { label: selector, error: "selector not found" };
    mark(opts.root);
    el.click();
    return check(opts.label || selector, opts);
  }

  const pathOf = (el) => {
    const parts = [];
    for (let c = el; c && c !== document.body; c = c.parentElement) {
      const sib = [...c.parentElement.children];
      parts.unshift(c.tagName.toLowerCase() + ":nth-child(" + (sib.indexOf(c) + 1) + ")");
    }
    return "body > " + parts.join(" > ");
  };
  // what to click: native controls and anything with a pointer cursor; descendants of a listed control are skipped
  function controls(rootSel) {
    const root = (rootSel && document.querySelector(rootSel)) || document.body;
    const out = [];
    const picked = [];
    const all = [...root.querySelectorAll("*")];
    for (const el of all) {
      if (out.length >= 150) break;
      if (!visible(el) || el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (picked.some((p) => p.contains(el))) continue;
      const tag = el.tagName, role = el.getAttribute("role");
      const pointer = getComputedStyle(el).cursor === "pointer";
      let kind = null;
      if (tag === "SELECT") kind = "select";
      else if (tag === "INPUT" && ["checkbox", "radio"].includes(el.type)) kind = "check";
      else if (tag === "INPUT" && ["text", "search", "email", "number", ""].includes(el.type)) kind = "input";
      else if (role === "tab") kind = "tab";
      else if (tag === "TH" && (el.hasAttribute("aria-sort") || pointer)) kind = "sort";
      else if (tag === "SUMMARY") kind = "detail";
      else if ((tag === "TR" || tag === "LI") && (pointer || el.hasAttribute("tabindex"))) kind = "row";
      else if (tag === "BUTTON" || role === "button" || role === "switch" || role === "checkbox") kind = "button";
      else if (tag === "A" && el.getAttribute("href")) {
        let ext = false;
        try { ext = new URL(el.href, location.href).origin !== location.origin; } catch (e) {}
        if (ext) continue; // leaves the app: not a layout question
        kind = "link";
      }
      else if (pointer) kind = "pointer";
      if (!kind) continue;
      if (kind !== "input") picked.push(el);
      const h = el.getAttribute("href");
      out.push({ sel: pathOf(el), kind, label: (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").replace(/\s+/g, " ").trim().slice(0, 30), ...(kind === "select" ? { options: [...el.options].map((o) => o.value).slice(0, 12) } : {}), ...(kind === "link" ? { navigates: !!h && !h.startsWith("#") } : {}) });
    }
    // view controls first, links last, so the cap never drops the filters behind a long list of links
    const ORDER = ["tab", "sort", "button", "check", "select", "row", "detail", "pointer", "link", "input"];
    return out.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind)).slice(0, 60);
  }

  window.__lp = { v: 1, snapshot: (r) => strip(snapshot(r)), mark, check, step, controls, idle };
  return "layout-probe installed: __lp.idle(), __lp.controls(), __lp.mark(), __lp.check(label,{target,expectInsert}), __lp.step(selector)";
}
