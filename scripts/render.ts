/**
 * social-shots renderer
 *
 * Usage:
 *   node <skill-dir>/node_modules/tsx/dist/cli.mjs <skill-dir>/scripts/render.ts <path/to/shots.json> [options]
 *   (run without arguments for the option list)
 *
 * Reads a shots.json config (see SKILL.md for the schema) and renders one PNG per
 * entry in `images`, using Satori (layout -> SVG) and resvg (SVG -> PNG).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { imageSize } from "image-size";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FormatId = "x" | "linkedin" | "og" | "ig-square" | "ig-portrait" | "story" | "ph";
type TemplateId = "hero" | "duo" | "trio" | "statement";

interface Brand {
  name: string;
  /** Path to app icon (Expo: ./assets/icon.png or ./assets/images/icon.png) */
  icon?: string;
  colors: {
    bg: string; // background start
    bg2?: string; // background end (gradient). Defaults to bg
    accent: string; // highlight color for *words* and badges
    text: string; // headline color
    muted?: string; // subhead color
  };
  /**
   * Optional custom fonts (TTF/OTF/WOFF, not WOFF2). Defaults to bundled Inter, which
   * covers Latin, Latin-ext, Cyrillic, Greek and Vietnamese. `fallback` lists extra font
   * files tried for glyphs the main fonts lack (e.g. a Noto Sans JP/KR/SC for CJK, or
   * Noto Sans Arabic/Hebrew/Thai).
   */
  fonts?: { regular?: string; bold?: string; fallback?: string[] };
  /** Phone bezel color. Default #0B0B0F */
  bezel?: string;
}

/** A plain string (same in every language) or one string per language code. */
type Text = string | Record<string, string>;

/**
 * Screenshot list. Paths may contain `{lang}` (e.g. "screens/{lang}/1.png"); if the
 * localized file doesn't exist, `{lang}` falls back to the primary language, then is
 * removed ("screens/1.png"). Or give one list per language.
 */
type Shots = string[] | Record<string, string[]>;

type LangMode = "single" | "multi" | "bilingual";

interface ImageSpec {
  id: string;
  template: TemplateId;
  format: FormatId;
  /** Use *asterisks* to highlight words in the accent color */
  headline: Text;
  subhead?: Text;
  badge?: Text;
  screenshots?: Shots;
  /** Per-image color overrides */
  colors?: Partial<Brand["colors"]>;
}

interface Config {
  brand: Omit<Brand, "name"> & { name: Text };
  output?: string;
  /**
   * languages[0] is the primary language.
   *  - single:    one set in `lang` (default languages[0]) → out/
   *  - multi:     one set per language → out/<lang>/
   *  - bilingual: primary text + translation subtitles (languages[1..]) → out/<es+en>/
   */
  i18n?: { languages: string[]; mode?: LangMode; lang?: string };
  images: ImageSpec[];
}

/** An ImageSpec with every text resolved for one render. */
interface Resolved {
  id: string;
  template: TemplateId;
  format: FormatId;
  headline: string;
  subhead?: string;
  badge?: string;
  screenshots: string[];
  colors?: Partial<Brand["colors"]>;
  /** Bilingual mode: translations shown as subtitles under the primary text. */
  subtitles: { headline: string; subhead?: string }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FORMATS: Record<FormatId, { w: number; h: number; label: string }> = {
  x: { w: 1200, h: 675, label: "X / Twitter post (16:9)" },
  linkedin: { w: 1200, h: 627, label: "LinkedIn post" },
  og: { w: 1200, h: 630, label: "Open Graph / link preview" },
  "ig-square": { w: 1080, h: 1080, label: "Instagram / Threads square" },
  "ig-portrait": { w: 1080, h: 1350, label: "Instagram feed portrait (4:5)" },
  story: { w: 1080, h: 1920, label: "Stories / Reels / TikTok cover (9:16)" },
  ph: { w: 1270, h: 760, label: "Product Hunt gallery" },
};

const TEMPLATES: TemplateId[] = ["hero", "duo", "trio", "statement"];

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Tiny element helper (Satori accepts React-like plain objects, no JSX needed)
// ---------------------------------------------------------------------------

type Style = Record<string, string | number>;
type Child = Node | string | null | undefined | false;
interface Node {
  type: string;
  props: Record<string, unknown> & { style?: Style; children?: unknown };
}

function h(type: string, props: Record<string, unknown> & { style?: Style }, ...children: Child[]): Node {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
}

const div = (style: Style, ...children: Child[]) => h("div", { style: { display: "flex", ...style } }, ...children);

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

interface LoadedImage {
  src: string;
  w: number;
  h: number;
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function loadImage(path: string): LoadedImage {
  if (!existsSync(path)) throw new Error(`Image not found: ${path}`);
  const buf = readFileSync(path);
  const { width, height } = imageSize(buf);
  if (!width || !height) throw new Error(`Could not read size of ${path}`);
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image type (use png/jpg/webp): ${path}`);
  return { src: `data:${mime};base64,${buf.toString("base64")}`, w: width, h: height };
}

type FontWeight = 400 | 600 | 800;
interface FontEntry {
  name: string;
  data: Buffer;
  weight: FontWeight;
  style: "normal";
}

/**
 * Unicode subsets of the bundled Inter, one file each. Satori looks for a missing glyph
 * in every *other* font family it has loaded (never in a second file of the same
 * family), so each subset gets its own family name; the text uses "Brand" and the rest
 * act as fallbacks. That is what makes Polish, Turkish, Russian, Greek or Vietnamese copy
 * render instead of "NO GLYPH" boxes. CJK, Arabic, Hebrew, Thai etc. still need a font
 * passed via brand.fonts.fallback.
 */
const INTER_SUBSETS = ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek", "greek-ext", "vietnamese"];
const WEIGHTS: FontWeight[] = [400, 600, 800];

function loadFonts(brand: Brand, baseDir: string): FontEntry[] {
  const interDir = join(SKILL_DIR, "node_modules/@fontsource/inter/files");
  const entry = (name: string, data: Buffer, weight: FontWeight): FontEntry => ({ name, data, weight, style: "normal" });
  const inter = (subset: string, weight: FontWeight, name: string) =>
    entry(name, readFileSync(join(interDir, `inter-${subset}-${weight}-normal.woff`)), weight);
  const file = (p: string) => readFileSync(resolve(baseDir, p));

  const fonts: FontEntry[] = [];
  const customRegular = brand.fonts?.regular;
  const customBold = brand.fonts?.bold;
  if (customRegular || customBold) {
    // Whichever weight the brand font lacks reuses the other file; Satori picks the
    // closest weight it has for a family.
    if (customRegular) fonts.push(entry("Brand", file(customRegular), 400));
    if (customBold) {
      const bold = file(customBold);
      fonts.push(entry("Brand", bold, 600), entry("Brand", bold, 800));
    }
  } else {
    for (const w of WEIGHTS) fonts.push(inter("latin", w, "Brand"));
  }
  // Every Inter subset sits behind the brand font (a custom font that lacks "ñ" or
  // Cyrillic degrades to Inter rather than to a missing glyph). Harmless duplication of
  // latin when the brand font is Inter itself.
  for (const subset of INTER_SUBSETS) for (const w of WEIGHTS) fonts.push(inter(subset, w, `Inter ${subset}`));
  (brand.fonts?.fallback ?? []).forEach((p, i) => {
    const data = file(p);
    for (const w of WEIGHTS) fonts.push(entry(`Fallback ${i}`, data, w));
  });
  return fonts;
}

const FONT_EXT_OK = new Set([".ttf", ".otf", ".woff"]);

/** Problems with a font path, or null when it looks loadable. */
function fontProblem(p: string, baseDir: string): string | null {
  const abs = resolve(baseDir, p);
  if (!existsSync(abs)) return `font not found: ${p}`;
  const ext = extname(p).toLowerCase();
  if (ext === ".woff2") return `${p}: WOFF2 is not supported by Satori; use the TTF/OTF/WOFF version`;
  if (!FONT_EXT_OK.has(ext)) return `${p}: unsupported font type (use ttf/otf/woff)`;
  return null;
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

interface Ctx {
  W: number;
  H: number;
  colors: Required<Brand["colors"]>;
  brand: Brand;
  icon?: LoadedImage;
  shots: LoadedImage[];
  spec: Resolved;
}

/**
 * Headline with *highlighted* words. Each token is its own flex item so wrapping works.
 * A highlighted phrase of up to 3 words stays on one line (no orphaned "dos" / "tuyo"),
 * and punctuation glued to it ("*voz*,") stays attached instead of floating.
 */
function headline(text: string, size: number, ctx: Ctx, align: "left" | "center") {
  const words: { t: string; hl: boolean; tail?: string }[] = [];
  const re = /\*([^*]+)\*([^\s*]*)|([^\s*]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      const parts = m[1].trim().split(/\s+/);
      // Short phrases never break; longer ones keep their last two words together.
      const groups = parts.length <= 3 ? [parts.join(" ")] : [...parts.slice(0, -2), parts.slice(-2).join(" ")];
      groups.forEach((t, i) => words.push({ t, hl: true, tail: i === groups.length - 1 ? m![2] : "" }));
    } else words.push({ t: m[3], hl: false });
  }
  // Outer box pins the width to the text column; the inner wrapping row grows past it
  // by the word margins on both sides, so the first/last word sit flush with the column.
  // (Satori/yoga quirks this avoids: flex-wrap + columnGap miscomputes wrapped height,
  // and a wrapping row without a definite width never wraps at all.)
  return div(
    { width: "100%" },
    div(
      {
        flexGrow: 1,
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : "flex-start",
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1.08,
        letterSpacing: -size * 0.025,
        color: ctx.colors.text,
        margin: `0 ${-size * 0.13}px`,
      },
      ...words.map((w) =>
        div(
          { flexShrink: 0, margin: `0 ${size * 0.13}px` },
          h("span", { style: { color: w.hl ? ctx.colors.accent : ctx.colors.text, whiteSpace: "nowrap" } }, w.t),
          w.tail ? h("span", { style: { color: ctx.colors.text, whiteSpace: "nowrap" } }, w.tail) : null,
        ),
      ),
    ),
  );
}

function subhead(text: string | undefined, size: number, ctx: Ctx, align: "left" | "center") {
  if (!text) return null;
  return div(
    {
      fontSize: size,
      fontWeight: 400,
      lineHeight: 1.35,
      color: ctx.colors.muted,
      textAlign: align,
      justifyContent: align === "center" ? "center" : "flex-start",
    },
    noOrphan(text),
  );
}

function badge(text: string | undefined, size: number, ctx: Ctx, align: "left" | "center") {
  if (!text) return null;
  return div(
    {
      alignSelf: align === "center" ? "center" : "flex-start",
      padding: `${size * 0.45}px ${size * 0.95}px`,
      borderRadius: 999,
      backgroundColor: hexA(ctx.colors.accent, 0.16),
      border: `${Math.max(1, size * 0.08)}px solid ${hexA(ctx.colors.accent, 0.45)}`,
      color: ctx.colors.accent,
      fontSize: size,
      fontWeight: 600,
      letterSpacing: size * 0.02,
    },
    text.toUpperCase(),
  );
}

function brandMark(size: number, ctx: Ctx) {
  return div(
    { alignItems: "center", gap: size * 0.5 },
    ctx.icon
      ? h("img", {
          src: ctx.icon.src,
          width: size * 1.6,
          height: size * 1.6,
          style: { borderRadius: size * 0.38 },
        })
      : null,
    div({ fontSize: size, fontWeight: 600, color: ctx.colors.text, opacity: 0.92 }, ctx.brand.name),
  );
}

/** A phone frame drawn with CSS around a screenshot. `width` is the outer width. */
function phone(shot: LoadedImage, width: number, ctx: Ctx, extra: Style = {}) {
  const pad = width * 0.032;
  const innerW = width - pad * 2;
  const innerH = (innerW * shot.h) / shot.w;
  const radius = width * 0.135;
  return div(
    {
      padding: pad,
      borderRadius: radius,
      backgroundColor: ctx.brand.bezel ?? "#0B0B0F",
      // Blur is capped: resvg panics on very large shadow filter regions (e.g. 9:16 stories).
      boxShadow: `0 ${Math.min(width * 0.05, 40)}px ${Math.min(width * 0.12, 72)}px rgba(0,0,0,0.45)`,
      border: `${Math.max(1, width * 0.006)}px solid rgba(255,255,255,0.14)`,
      ...extra,
    },
    h("img", {
      src: shot.src,
      width: innerW,
      height: innerH,
      style: { borderRadius: radius - pad, objectFit: "cover" },
    }),
  );
}

function phoneHeight(shot: LoadedImage, width: number) {
  const pad = width * 0.032;
  return ((width - pad * 2) * shot.h) / shot.w + pad * 2;
}

function background(ctx: Ctx, ...children: Child[]) {
  const { W, H, colors } = ctx;
  const blob = Math.max(W, H) * 0.9;
  return div(
    {
      width: W,
      height: H,
      position: "relative",
      overflow: "hidden",
      fontFamily: "Brand",
      backgroundImage: `linear-gradient(150deg, ${colors.bg} 0%, ${colors.bg2} 100%)`,
    },
    // soft accent glow
    div({
      position: "absolute",
      width: blob,
      height: blob,
      right: -blob * 0.35,
      bottom: -blob * 0.45,
      borderRadius: blob,
      backgroundImage: `radial-gradient(circle, ${hexA(colors.accent, 0.35)} 0%, ${hexA(colors.accent, 0)} 65%)`,
    }),
    ...children,
  );
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

type Shape = "landscape" | "square" | "portrait" | "tall";

function shapeOf(W: number, H: number): Shape {
  const r = W / H;
  if (r > 1.3) return "landscape";
  if (r > 0.95) return "square";
  if (r > 0.7) return "portrait";
  return "tall";
}

function needShots(ctx: Ctx, n: number) {
  if (ctx.shots.length < n)
    throw new Error(`Image "${ctx.spec.id}" (${ctx.spec.template}) needs ${n} screenshot(s), got ${ctx.shots.length}`);
}

/** A translation shown under the primary text, like a film subtitle. */
function subtitleLine(text: string, size: number, ctx: Ctx, align: "left" | "center", opacity: number) {
  return div(
    {
      fontSize: size,
      fontWeight: 400,
      lineHeight: 1.3,
      color: ctx.colors.text,
      opacity,
      textAlign: align,
      justifyContent: align === "center" ? "center" : "flex-start",
    },
    noOrphan(text.replace(/\*/g, "")),
  );
}

/** Glue the last two words with a no-break space so a line never ends with one lonely word. */
function noOrphan(text: string) {
  return text.replace(/\s+(\S+)\s*$/, " $1");
}

/** Text block used by every template */
function textBlock(ctx: Ctx, opts: { align: "left" | "center"; hl: number; width: number | string }) {
  const { spec } = ctx;
  const subs = spec.subtitles;
  // Bilingual images carry extra lines, so the primary headline shrinks a little.
  const hl = subs.length ? opts.hl * 0.86 : opts.hl;
  const alignItems = opts.align === "center" ? "center" : "flex-start";

  const headlineGroup = subs.length
    ? div(
        { flexDirection: "column", gap: hl * 0.14, alignItems, width: "100%" },
        headline(spec.headline, hl, ctx, opts.align),
        div(
          { flexDirection: "column", gap: hl * 0.04, alignItems, width: "100%" },
          ...subs.map((s) => subtitleLine(s.headline, hl * 0.4, ctx, opts.align, 0.78)),
        ),
      )
    : headline(spec.headline, hl, ctx, opts.align);

  const subheadGroup = spec.subhead
    ? div(
        { flexDirection: "column", gap: hl * 0.06, alignItems, width: "100%" },
        subhead(spec.subhead, hl * 0.4, ctx, opts.align),
        ...subs.map((s) => (s.subhead ? subtitleLine(s.subhead, hl * 0.34, ctx, opts.align, 0.55) : null)),
      )
    : null;

  return div(
    { flexDirection: "column", gap: hl * 0.32, width: opts.width, alignItems },
    badge(spec.badge, hl * 0.28, ctx, opts.align),
    headlineGroup,
    subheadGroup,
  );
}

function hero(ctx: Ctx) {
  needShots(ctx, 1);
  const { W, H } = ctx;
  const shot = ctx.shots[0];
  const shape = shapeOf(W, H);

  if (shape === "landscape") {
    const pad = W * 0.065;
    const pw = Math.min(W * 0.3, (H * 1.05 * shot.w) / shot.h);
    return background(
      ctx,
      div(
        { position: "absolute", left: pad, top: 0, height: H, width: W * 0.56, flexDirection: "column", justifyContent: "center", gap: H * 0.06 },
        brandMark(H * 0.036, ctx),
        textBlock(ctx, { align: "left", hl: H * 0.105, width: "100%" }),
      ),
      phone(shot, pw, ctx, { position: "absolute", right: pad, top: H * 0.13 }),
    );
  }

  const tall = shape === "tall";
  const pad = W * 0.08;
  const hl = W * (tall ? 0.092 : shape === "portrait" ? 0.084 : 0.074);
  const pw = W * (tall ? 0.7 : shape === "portrait" ? 0.6 : 0.5);
  const top = H * (tall ? 0.38 : shape === "portrait" ? 0.42 : 0.44);
  return background(
    ctx,
    div(
      { position: "absolute", left: pad, right: pad, top: H * (tall ? 0.08 : 0.065), flexDirection: "column", alignItems: "center", gap: hl * 0.55 },
      brandMark(W * 0.032, ctx),
      textBlock(ctx, { align: "center", hl, width: "100%" }),
    ),
    phone(shot, pw, ctx, { position: "absolute", left: (W - pw) / 2, top }),
  );
}

function duo(ctx: Ctx) {
  needShots(ctx, 2);
  const { W, H } = ctx;
  const [a, b] = ctx.shots;
  const shape = shapeOf(W, H);

  if (shape === "landscape") {
    const pad = W * 0.065;
    const pw = W * 0.24;
    return background(
      ctx,
      div(
        // Column stops short of the tilted left phone (which starts ~W*0.52 incl. rotation).
        { position: "absolute", left: pad, top: 0, height: H, width: W * 0.4, flexDirection: "column", justifyContent: "center", gap: H * 0.06 },
        brandMark(H * 0.036, ctx),
        textBlock(ctx, { align: "left", hl: H * 0.095, width: "100%" }),
      ),
      phone(b, pw, ctx, { position: "absolute", right: pad, top: H * 0.24, transform: "rotate(7deg)" }),
      phone(a, pw, ctx, { position: "absolute", right: pad + pw * 0.72, top: H * 0.1, transform: "rotate(-5deg)" }),
    );
  }

  const tall = shape === "tall";
  const hl = W * (tall ? 0.09 : 0.078);
  const pw = W * (tall ? 0.5 : 0.42);
  const top = H * (tall ? 0.4 : 0.44);
  return background(
    ctx,
    div(
      { position: "absolute", left: W * 0.08, right: W * 0.08, top: H * (tall ? 0.08 : 0.065), flexDirection: "column", alignItems: "center", gap: hl * 0.55 },
      brandMark(W * 0.032, ctx),
      textBlock(ctx, { align: "center", hl, width: "100%" }),
    ),
    phone(a, pw, ctx, { position: "absolute", left: W * 0.5 - pw * 0.95, top: top + H * 0.03, transform: "rotate(-6deg)" }),
    phone(b, pw, ctx, { position: "absolute", left: W * 0.5 - pw * 0.05, top, transform: "rotate(6deg)" }),
  );
}

function trio(ctx: Ctx) {
  needShots(ctx, 3);
  const { W, H } = ctx;
  const shape = shapeOf(W, H);
  const tall = shape === "tall";
  const landscape = shape === "landscape";

  const hl = landscape ? H * 0.1 : W * (tall ? 0.09 : 0.075);
  // In tall formats the side phones tuck behind the middle one so the trio fills the frame.
  const pwSide = landscape ? W * 0.2 : W * (tall ? 0.36 : 0.27);
  const pwMid = pwSide * (tall ? 1.28 : 1.12);
  const top = landscape ? H * 0.42 : H * (tall ? 0.33 : 0.42);
  const gap = tall ? -pwSide * 0.25 : pwSide * 0.12;
  const total = pwSide * 2 + pwMid + gap * 2;
  const left0 = (W - total) / 2;

  return background(
    ctx,
    div(
      { position: "absolute", left: W * 0.08, right: W * 0.08, top: landscape ? H * 0.08 : H * 0.065, flexDirection: "column", alignItems: "center", gap: hl * 0.45 },
      brandMark(landscape ? H * 0.034 : W * 0.032, ctx),
      textBlock(ctx, { align: "center", hl, width: "100%" }),
    ),
    phone(ctx.shots[0], pwSide, ctx, { position: "absolute", left: left0, top: top + pwSide * 0.18 }),
    phone(ctx.shots[2], pwSide, ctx, { position: "absolute", left: left0 + pwSide + pwMid + gap * 2, top: top + pwSide * 0.18 }),
    phone(ctx.shots[1], pwMid, ctx, { position: "absolute", left: left0 + pwSide + gap, top }),
  );
}

function statement(ctx: Ctx) {
  const { W, H } = ctx;
  const shape = shapeOf(W, H);
  const base = shape === "landscape" ? H : W;
  const bilingual = ctx.spec.subtitles.length > 0;
  // Bilingual statements carry long subtitle lines: smaller headline, no footer name.
  const hl = base * (shape === "landscape" ? 0.13 : 0.11) * (bilingual ? 0.85 : 1);
  return background(
    ctx,
    div(
      { position: "absolute", left: W * 0.09, right: W * 0.09, top: 0, height: H, flexDirection: "column", justifyContent: "center", alignItems: "center", gap: hl * 0.6 },
      ctx.icon
        ? h("img", { src: ctx.icon.src, width: base * 0.17, height: base * 0.17, style: { borderRadius: base * 0.04 } })
        : null,
      textBlock(ctx, { align: "center", hl, width: "100%" }),
    ),
    bilingual ? null : div(
      { position: "absolute", bottom: H * 0.06, left: 0, width: W, justifyContent: "center", fontSize: base * 0.032, fontWeight: 600, color: ctx.colors.muted },
      ctx.brand.name,
    ),
  );
}

const RENDERERS: Record<TemplateId, (ctx: Ctx) => Node> = { hero, duo, trio, statement };

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

/** Bundled fonts have no emoji glyphs, so emojis would render as "NO GLYPH" boxes. */
const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;
const warned = new Set<string>();
function stripEmoji(id: string, s: string): string;
function stripEmoji(id: string, s: string | undefined): string | undefined;
function stripEmoji(id: string, s: string | undefined) {
  if (s === undefined) return s;
  const clean = s.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
  if (clean !== s && !warned.has(id)) {
    warned.add(id);
    console.warn(`! ${id}: emojis removed (not supported in images; put them in the post caption instead)`);
  }
  return clean;
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

/** Pick the string for `lang`. Plain strings are language-neutral. */
function pickText(v: Text | undefined, lang: string): string | undefined {
  if (v === undefined || typeof v === "string") return v;
  return v[lang];
}

/** Languages a Text value is missing (plain strings are never missing). */
function missingLangs(v: Text | undefined, langs: string[]): string[] {
  if (v === undefined || typeof v === "string") return [];
  return langs.filter((l) => !v[l]?.trim());
}

/**
 * Resolve screenshot paths for `lang`. `{lang}` is replaced by `lang`; if that file is
 * missing, by the primary language; if still missing, the `{lang}/` segment is dropped.
 */
function pickShots(v: Shots | undefined, lang: string, primary: string, baseDir: string): string[] {
  if (!v) return [];
  const list = Array.isArray(v) ? v : (v[lang] ?? v[primary] ?? []);
  return list.map((p) => {
    if (!p.includes("{lang}")) return p;
    for (const cand of [p.replaceAll("{lang}", lang), p.replaceAll("{lang}", primary)]) {
      if (existsSync(resolve(baseDir, cand))) return cand;
    }
    return p.replace(/\{lang\}[\\/]?/g, "").replace(/[-_.]?\{lang\}/g, "");
  });
}

interface Job {
  /** Output subfolder ("" = flat) */
  folder: string;
  /** Language whose text is the main text */
  lang: string;
  /** Translation languages shown as subtitles (bilingual only) */
  subs: string[];
}

function planJobs(mode: LangMode, langs: string[], lang: string): Job[] {
  if (mode === "multi") return langs.map((l) => ({ folder: l, lang: l, subs: [] }));
  if (mode === "bilingual") return [{ folder: langs.join("+"), lang: langs[0], subs: langs.slice(1) }];
  return [{ folder: "", lang, subs: [] }];
}

function resolveSpec(spec: ImageSpec, job: Job, primary: string, baseDir: string): Resolved {
  const t = (v: Text | undefined, l: string) => stripEmoji(spec.id, pickText(v, l));
  return {
    id: spec.id,
    template: spec.template,
    format: spec.format,
    colors: spec.colors,
    headline: t(spec.headline, job.lang)!,
    subhead: t(spec.subhead, job.lang),
    badge: t(spec.badge, job.lang),
    screenshots: pickShots(spec.screenshots, job.lang, primary, baseDir),
    subtitles: job.subs.map((l) => ({ headline: t(spec.headline, l)!, subhead: t(spec.subhead, l) })),
  };
}

/**
 * Normalize a color to "#rrggbb". Accepts #rgb, #rrggbb, #rrggbbaa (alpha dropped) and
 * rgb()/rgba() — the forms an agent is likely to copy from a theme file. Anything else
 * (named colors, hsl, Tailwind tokens) returns null so validation can point at it,
 * because `hexA` would otherwise silently produce rgba(NaN,...) and the glow and badge
 * disappear without an error.
 */
function normalizeColor(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    const m = hex[1];
    const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m.slice(0, 6);
    return `#${full.toLowerCase()}`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*[\d.%]+\s*)?\)$/i.exec(s);
  if (rgb) {
    const to2 = (x: string) => Math.min(255, parseInt(x, 10)).toString(16).padStart(2, "0");
    return `#${to2(rgb[1])}${to2(rgb[2])}${to2(rgb[3])}`;
  }
  return null;
}

/** `hex` is already normalized (#rrggbb) by the time templates call this. */
function hexA(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const COLOR_KEYS = ["bg", "bg2", "accent", "text", "muted"] as const;

/** Normalize every color in a colors object in place, returning error strings. */
function normalizeColors(where: string, colors: Record<string, unknown> | undefined): string[] {
  const errs: string[] = [];
  if (!colors) return errs;
  for (const k of COLOR_KEYS) {
    if (colors[k] === undefined) continue;
    const n = normalizeColor(colors[k]);
    if (n) colors[k] = n;
    else errs.push(`${where}.${k}: "${String(colors[k])}" is not a color I can use (use #rrggbb or rgb(r,g,b))`);
  }
  return errs;
}

const MODES: LangMode[] = ["single", "multi", "bilingual"];
const list = (s: string | undefined) => (s ?? "").split(/[,+]/).map((x) => x.trim()).filter(Boolean);

function parseArgs(argv: string[]) {
  const args = { config: "", only: [] as string[], out: "", mode: "" as LangMode | "", langs: [] as string[], lang: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") args.only = list(argv[++i]);
    else if (a === "--out") args.out = argv[++i] ?? "";
    else if (a === "--mode") args.mode = (argv[++i] ?? "") as LangMode;
    else if (a === "--langs") args.langs = list(argv[++i]);
    else if (a === "--lang") args.lang = argv[++i] ?? "";
    else if (!args.config) args.config = a;
  }
  return args;
}

/** CLI flags win over config. `--lang` alone means single mode in that language. */
function resolveI18n(cfg: Config, args: ReturnType<typeof parseArgs>) {
  const langs = args.langs.length ? args.langs : (cfg.i18n?.languages ?? []);
  let mode: LangMode = args.mode || (args.lang ? "single" : (cfg.i18n?.mode ?? "single"));
  if (!MODES.includes(mode)) throw new Error(`Unknown --mode "${mode}" (use ${MODES.join(", ")})`);
  const lang = args.lang || cfg.i18n?.lang || langs[0] || "default";
  const languages = langs.length ? langs : [lang];
  if (mode === "multi" && languages.length < 2) throw new Error(`mode "multi" needs 2+ languages (i18n.languages or --langs es,en)`);
  if (mode === "bilingual" && languages.length < 2)
    throw new Error(`mode "bilingual" needs 2+ languages; the first is primary (i18n.languages or --langs es,en)`);
  if (mode === "single" && args.lang && languages.length && !languages.includes(args.lang)) languages.push(args.lang);
  return { mode, languages, lang, primary: mode === "single" ? lang : languages[0] };
}

/** Screenshots each template consumes. Extras are a mistake (silently dropped otherwise). */
const SHOTS_PER_TEMPLATE: Record<TemplateId, number> = { hero: 1, duo: 2, trio: 3, statement: 0 };

/**
 * Check the config and normalize colors in place. Collects every problem instead of
 * stopping at the first so the agent can fix shots.json in one pass.
 */
function validate(cfg: Config, needed: string[], baseDir: string) {
  const errs: string[] = [];
  if (!cfg.brand?.name) errs.push("brand.name is required");
  for (const l of missingLangs(cfg.brand?.name, needed)) errs.push(`brand.name: missing "${l}"`);
  if (!cfg.brand?.colors?.bg || !cfg.brand?.colors?.accent || !cfg.brand?.colors?.text)
    errs.push("brand.colors.bg, accent and text are required");
  errs.push(...normalizeColors("brand.colors", cfg.brand?.colors));
  if (cfg.brand?.bezel !== undefined) {
    const b = normalizeColor(cfg.brand.bezel);
    if (b) cfg.brand.bezel = b;
    else errs.push(`brand.bezel: "${cfg.brand.bezel}" is not a color I can use (use #rrggbb or rgb(r,g,b))`);
  }
  for (const [key, p] of Object.entries(cfg.brand?.fonts ?? {})) {
    for (const path of Array.isArray(p) ? p : [p]) {
      const problem = typeof path === "string" ? fontProblem(path, baseDir) : `brand.fonts.${key} must be a path`;
      if (problem) errs.push(`brand.fonts.${key}: ${problem}`);
    }
  }
  if (cfg.brand?.icon && !existsSync(resolve(baseDir, cfg.brand.icon))) errs.push(`brand.icon: not found: ${cfg.brand.icon}`);

  if (!Array.isArray(cfg.images) || cfg.images.length === 0) errs.push("images[] must have at least one entry");
  const ids = new Set<string>();
  for (const img of cfg.images ?? []) {
    if (!img.id) errs.push("every image needs an id");
    if (ids.has(img.id)) errs.push(`duplicate id: ${img.id}`);
    ids.add(img.id);
    if (!FORMATS[img.format]) errs.push(`${img.id}: unknown format "${img.format}" (use ${Object.keys(FORMATS).join(", ")})`);
    if (!TEMPLATES.includes(img.template)) errs.push(`${img.id}: unknown template "${img.template}" (use ${TEMPLATES.join(", ")})`);
    if (!img.headline) errs.push(`${img.id}: headline is required`);
    for (const field of ["headline", "subhead", "badge"] as const) {
      const miss = missingLangs(img[field], needed);
      if (miss.length) errs.push(`${img.id}.${field}: missing translation for ${miss.map((l) => `"${l}"`).join(", ")}`);
    }
    errs.push(...normalizeColors(`${img.id}.colors`, img.colors));

    const want = SHOTS_PER_TEMPLATE[img.template];
    if (want !== undefined) {
      const lists: [string, string[]][] = Array.isArray(img.screenshots)
        ? [["screenshots", img.screenshots]]
        : img.screenshots
          ? Object.entries(img.screenshots).map(([l, v]) => [`screenshots.${l}`, v] as [string, string[]])
          : [["screenshots", []]];
      for (const [where, list] of lists) {
        if (list.length !== want)
          errs.push(`${img.id}.${where}: template "${img.template}" takes exactly ${want} screenshot(s), got ${list.length}`);
      }
    }
  }
  if (errs.length) throw new Error("Invalid config:\n  - " + errs.join("\n  - "));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.config) {
    console.error(
      [
        "Usage: npx tsx render.ts <shots.json> [options]",
        "",
        "Options:",
        "  --only id1,id2          render only these image ids",
        "  --out dir               output folder, relative to the current directory",
        "                          (default: config.output, relative to shots.json, or ./out)",
        "  --lang es               single language → out/",
        "  --mode multi            one set per language → out/<lang>/",
        "  --mode bilingual        primary text + translation subtitles → out/<es+en>/",
        "  --langs es,en           languages for multi/bilingual (first = primary)",
      ].join("\n"),
    );
    console.error("\nFormats:");
    for (const [id, f] of Object.entries(FORMATS)) console.error(`  ${id.padEnd(12)} ${f.w}x${f.h}  ${f.label}`);
    console.error(`\nTemplates: ${TEMPLATES.join(", ")}`);
    process.exit(1);
  }

  const configPath = resolve(args.config);
  const baseDir = dirname(configPath);
  const cfg: Config = JSON.parse(readFileSync(configPath, "utf8"));
  const i18n = resolveI18n(cfg, args);
  const jobs = planJobs(i18n.mode, i18n.languages, i18n.lang);
  const needed = [...new Set(jobs.flatMap((j) => [j.lang, ...j.subs]))];
  validate(cfg, needed, baseDir);

  // --out behaves like any CLI flag (relative to cwd); config.output stays next to the JSON.
  const outRoot = args.out ? resolve(args.out) : resolve(baseDir, cfg.output || "out");
  const fonts = loadFonts(cfg.brand as Brand, baseDir);
  const icon = cfg.brand.icon ? loadImage(resolve(baseDir, cfg.brand.icon)) : undefined;
  const cache = new Map<string, LoadedImage>();
  const getShot = (p: string) => {
    const abs = resolve(baseDir, p);
    if (!cache.has(abs)) cache.set(abs, loadImage(abs));
    return cache.get(abs)!;
  };

  const targets = args.only.length ? cfg.images.filter((i) => args.only.includes(i.id)) : cfg.images;
  if (!targets.length) throw new Error(`No images match --only ${args.only.join(",")}`);
  console.log(`mode: ${i18n.mode} · ${jobs.map((j) => (j.subs.length ? `${j.lang} + ${j.subs.join(", ")}` : j.lang)).join(" | ")}`);
  let failed = 0;

  for (const job of jobs) {
    const outDir = job.folder ? join(outRoot, job.folder) : outRoot;
    mkdirSync(outDir, { recursive: true });
    const brand: Brand = { ...(cfg.brand as Brand), name: pickText(cfg.brand.name, job.lang) ?? "" };

    for (const raw of targets) {
      const label = `${job.folder ? job.folder + "/" : ""}${raw.id}`;
      try {
        const spec = resolveSpec(raw, job, i18n.primary, baseDir);
        const { w: W, h: H } = FORMATS[spec.format];
        const c = { ...brand.colors, ...spec.colors };
        const colors = { bg: c.bg, bg2: c.bg2 ?? c.bg, accent: c.accent, text: c.text, muted: c.muted ?? hexA(c.text, 0.72) };
        const ctx: Ctx = { W, H, colors, brand, icon, shots: spec.screenshots.map(getShot), spec };
        const tree = RENDERERS[spec.template](ctx);
        // Satori calls this for every run of text no loaded font can draw. Rather than
        // ship a PNG full of "NO GLYPH" boxes (and a green ✓), fail with the exact text.
        const noGlyph: string[] = [];
        const loadAdditionalAsset = async (languageCode: string, segment: string) => {
          if (languageCode !== "emoji") noGlyph.push(`"${segment}" (${languageCode})`);
          return [];
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const svg = await satori(tree as any, { width: W, height: H, fonts, loadAdditionalAsset });
        if (noGlyph.length)
          throw new Error(
            `no font covers ${[...new Set(noGlyph)].join(", ")}. ` +
              `Add a font with those glyphs to brand.fonts.fallback (e.g. Noto Sans JP/KR/SC/Arabic/Thai).`,
          );
        const png = new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
        const file = join(outDir, `${spec.id}.png`);
        writeFileSync(file, png);
        console.log(`✓ ${label.padEnd(30)} ${spec.template.padEnd(10)} ${spec.format.padEnd(12)} ${W}x${H}`);
      } catch (e) {
        failed++;
        console.error(`✗ ${label}: ${(e as Error).message}`);
      }
    }
  }
  console.log(`\nOutput: ${outRoot}`);

  if (failed) {
    console.error(`\n${failed} image(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
