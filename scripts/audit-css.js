/**
 * Colour, radius and font audit for Revie's stylesheets. Dev tool, not used by the app.
 *
 *   node scripts/audit-css.js [--list] [--loose] [--json out.json]
 *
 * Finds (1) explicit text/background pairs in one rule that are not approved in docs/brand.md (or,
 * for pairs involving a non-brand colour, fall below WCAG AA 4.5:1), (2) with --loose, text colours
 * that fail AA on the cream page ground, and counts hardcoded hex values, px border radii and
 * font-family declarations. Variable values are read from marketplaceDefaults.css and revieTokens.css,
 * plus the Console branding values noted below. It cannot see inherited backgrounds; the rendered
 * check for those is the styleguide pages plus the contrast scan in docs/tech-constraints.md.
 */
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const ROOT = path.join(__dirname, '..', 'src');

// ---------- colour parsing ----------
const hex2rgb = h => {
  h = h.replace('#', '');
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map(c => c + c)
      .join('');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  ];
};
const hsl2rgb = (h, s, l, a = 1) => {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const f = n =>
    l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255), a];
};
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
function parseColor(str) {
  str = String(str)
    .trim()
    .toLowerCase();
  if (NAMED[str]) return NAMED[str];
  let m;
  if ((m = str.match(/^#([0-9a-f]{3,8})$/))) return hex2rgb(str);
  if ((m = str.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.%]+))?\s*\)$/)))
    return [
      +m[1],
      +m[2],
      +m[3],
      m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4],
    ];
  if (
    (m = str.match(
      /^hsla?\(\s*([\d.]+)(?:deg)?[ ,]+([\d.]+)%[ ,]+([\d.]+)%(?:[ ,/]+([\d.%]+))?\s*\)$/
    ))
  )
    return hsl2rgb(
      +m[1],
      +m[2],
      +m[3],
      m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]
    );
  return null;
}
const lum = ([r, g, b]) => {
  const c = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const toHex = ([r, g, b]) =>
  '#' +
  [r, g, b]
    .map(v =>
      Math.round(v)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
    .toUpperCase();

// ---------- variables ----------
const vars = {};
function loadVars(file) {
  postcss.parse(fs.readFileSync(file, 'utf8')).walkRules(r => {
    if (!/(^|,)\s*:root\s*(,|$)/.test(r.selector)) return;
    r.walkDecls(d => {
      if (d.prop.startsWith('--')) vars[d.prop] = d.value.trim();
    });
  });
}
loadVars(ROOT + '/styles/marketplaceDefaults.css');
loadVars(ROOT + '/styles/revieTokens.css');
// Console (hosted branding) sets these inline, beating the CSS; values per CLAUDE.md / branding.json.
Object.assign(vars, {
  '--marketplaceColor': '#310416',
  '--marketplaceColorDark': 'hsl(336, 85%, 0%)',
  '--marketplaceColorLight': 'hsl(336, 85%, 20%)',
  '--colorPrimaryButton': '#310416',
  '--colorPrimaryButtonDark': 'hsl(336, 85%, 0%)',
  '--colorPrimaryButtonLight': 'hsl(336, 85%, 20%)',
});

function resolve(value, depth = 0) {
  if (depth > 8) return null;
  value = value.trim();
  let m = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (m) {
    const v = vars[m[1]];
    return v ? resolve(v, depth + 1) : m[2] ? resolve(m[2], depth + 1) : null;
  }
  return parseColor(value);
}

// ---------- palette & approved pairs (docs/brand.md) ----------
const PALETTE = {
  maroon: '#310416',
  lavender: '#DBABF5',
  offwhite: '#EFEEED',
  forest: '#032723',
  pink: '#FF90C2',
  orange: '#FF9352',
  periwinkle: '#D8E6FF',
  chartreuse: '#EAEA73',
};
const nameOf = rgb => Object.entries(PALETTE).find(([, h]) => h === toHex(rgb))?.[0] || null;
const APPROVED = {
  // background -> allowed text colours
  maroon: ['lavender', 'orange', 'offwhite', 'pink'],
  forest: ['lavender', 'chartreuse', 'periwinkle'],
  offwhite: ['maroon'],
  periwinkle: ['forest'],
  lavender: ['maroon'],
  orange: ['maroon'],
  pink: ['maroon'],
  chartreuse: ['maroon'],
};
const AA = 4.5;
function judge(fg, bg) {
  // composite translucent fg/bg onto white is out of scope: skip anything with alpha<1 on bg; apply fg alpha over bg
  if (bg[3] < 1) return { skip: 'translucent background' };
  const fgc = fg[3] < 1 ? fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])) : fg;
  const f = nameOf(fg),
    b = nameOf(bg),
    r = ratio(fgc, bg);
  if (f && b && fg[3] === 1)
    return {
      ratio: r,
      approved: (APPROVED[b] || []).includes(f),
      why: `${f} on ${b}` + (r >= AA ? ' (not in brand.md table)' : ''),
    };
  // at least one side is not a brand colour (white, warm grey ramp, black, translucent)
  return {
    ratio: r,
    approved: r >= AA,
    why: r >= AA ? 'neutral, passes AA' : 'neutral, below AA 4.5:1',
    neutral: true,
  };
}

// ---------- walk ----------
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.css') && files.push(p);
  }
})(ROOT);
const out = { pairs: [], hex: [], radii: [], fonts: [], unresolved: 0 };
for (const file of files) {
  if (/revieTokens\.css$|marketplaceDefaults\.css$/.test(file)) continue;
  const rel = path.relative(ROOT, file);
  postcss.parse(fs.readFileSync(file, 'utf8'), { from: file }).walkRules(rule => {
    let fgDecl, bgDecl;
    rule.walkDecls(d => {
      if (d.parent !== rule) return;
      const p = d.prop;
      if (p === 'color') fgDecl = d;
      if (p === 'background-color' || (p === 'background' && !/url\(|gradient/.test(d.value)))
        bgDecl = d;
      // hardcoded things
      if (/#[0-9a-fA-F]{3,8}\b/.test(d.value) && !p.startsWith('--'))
        out.hex.push({
          file: rel,
          line: d.source.start.line,
          sel: rule.selector,
          prop: p,
          value: d.value,
        });
      if (/radius/.test(p) && /\b\d+(\.\d+)?px\b/.test(d.value) && !/var\(/.test(d.value))
        out.radii.push({
          file: rel,
          line: d.source.start.line,
          sel: rule.selector,
          value: d.value,
        });
      if (p === 'font-family' && !/var\(/.test(d.value) && !/inherit/.test(d.value))
        out.fonts.push({
          file: rel,
          line: d.source.start.line,
          sel: rule.selector,
          value: d.value.slice(0, 60),
        });
    });
    if (fgDecl && bgDecl) {
      const fg = resolve(fgDecl.value),
        bg = resolve(bgDecl.value.split(/\s+/).find(t => resolve(t)) || bgDecl.value);
      if (!fg || !bg) {
        out.unresolved++;
        return;
      }
      const j = judge(fg, bg);
      if (j.skip) return;
      out.pairs.push({
        file: rel,
        line: fgDecl.source.start.line,
        sel: rule.selector.replace(/\s+/g, ' '),
        fg: fgDecl.value,
        bg: bgDecl.value,
        fgHex: toHex(fg),
        bgHex: toHex(bg),
        ...j,
      });
    }
  });
}
const bad = out.pairs.filter(p => !p.approved);
const jsonOut = process.argv.indexOf('--json');
if (jsonOut > 0) fs.writeFileSync(process.argv[jsonOut + 1], JSON.stringify(out, null, 1));
console.log(
  `files ${files.length} | explicit fg+bg pairs ${out.pairs.length} (unresolved ${out.unresolved}) | UNAPPROVED ${bad.length} | hardcoded hex decls ${out.hex.length} | px radii ${out.radii.length} | font-family decls ${out.fonts.length}`
);
if (process.argv.includes('--list'))
  bad
    .sort((a, b) => a.file.localeCompare(b.file))
    .forEach(p =>
      console.log(
        `${p.file}:${p.line} ${p.sel.slice(0, 50)} | ${p.fg} on ${p.bg} -> ${p.fgHex}/${
          p.bgHex
        } ${p.ratio.toFixed(2)} | ${p.why}`
      )
    );

// ---------- second pass: text colours with no explicit background in the rule ----------
if (process.argv.includes('--loose')) {
  const cream = parseColor('#EFEEED'),
    white = [255, 255, 255, 1];
  const rows = [];
  for (const file of files) {
    if (/revieTokens\.css$|marketplaceDefaults\.css$/.test(file)) continue;
    const rel = path.relative(ROOT, file);
    postcss.parse(fs.readFileSync(file, 'utf8'), { from: file }).walkRules(rule => {
      let fgDecl,
        hasBg = false;
      rule.walkDecls(d => {
        if (d.parent !== rule) return;
        if (d.prop === 'color') fgDecl = d;
        if (d.prop === 'background-color' || d.prop === 'background') hasBg = true;
      });
      if (!fgDecl || hasBg) return;
      const fg = resolve(fgDecl.value);
      if (!fg || fg[3] < 1) return;
      const onCream = ratio(fg, cream),
        onWhite = ratio(fg, white);
      if (onCream < 4.5)
        rows.push({
          rel,
          line: fgDecl.source.start.line,
          sel: rule.selector.replace(/\s+/g, ' ').slice(0, 60),
          v: fgDecl.value,
          hex: toHex(fg),
          onCream: onCream.toFixed(2),
          onWhite: onWhite.toFixed(2),
        });
    });
  }
  console.log(
    'text colours below AA on the cream page ground (no bg declared in same rule):',
    rows.length
  );
  rows
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .forEach(r =>
      console.log(
        `${r.rel}:${r.line} ${r.sel} | ${r.v} ${r.hex} cream ${r.onCream} white ${r.onWhite}`
      )
    );
}
