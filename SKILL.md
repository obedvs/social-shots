---
name: social-shots
description: Turn a mobile app project (Expo / React Native first) into a ready-to-post set of social media marketing images — X, LinkedIn, Instagram, Stories, Product Hunt — with on-brand headlines, phone mockups of real screenshots, and post captions, in one language, several languages, or bilingual with translation subtitles. Use when the user says /social-shots, "brag with images", or asks for social/marketing images, launch graphics or promo posts for their app.
---

# /social-shots

You built it. Now show it off. This skill reads the user's app, takes real screenshots,
and renders a polished set of social images plus share copy. Rendering is deterministic
(Satori + resvg in TypeScript), so you control every pixel through a JSON file and can
iterate fast.

`SKILL_DIR` below means the folder containing this SKILL.md (when installed as a Claude
Code plugin, that's `${CLAUDE_PLUGIN_ROOT}`). Never write into `SKILL_DIR` except for
`npm install`; all project output goes in the user's project.

## Output

Everything goes in `social-shots/` at the project root:

```
social-shots/
  screens/            raw app screenshots (input; optionally screens/<lang>/)
  shots.json          the image plan (you write this)
  out/                rendered images — layout depends on the language mode:
    *.png               single   (one language)
    es/*.png, en/*.png  multi    (one folder per language)
    es+en/*.png         bilingual (primary text + translation subtitles)
  captions.md         post copy (single) — or captions/<lang>.md / captions/es+en.md
```

## Language modes

Pick one before planning. If the user didn't say, infer from the app: an Expo app with
`locales` in `app.json`, `expo-localization`, `i18next` or `locales/*.json` supports
several languages — ask once which mode they want, offering these three:

| mode | what you get | when |
|------|--------------|------|
| `single` | one set in one language → `out/` | one market; default |
| `multi` | the same set once per language → `out/<lang>/` | posting to separate audiences/accounts per language |
| `bilingual` | primary language as the headline, translation as a smaller subtitle line under it → `out/es+en/` | one post that must reach both audiences (e.g. Spanish + English followers) |

Text fields accept a plain string (same in every language) or one string per language:
`"headline": { "es": "Notas privadas *para dos*", "en": "Private notes *for two*" }`.
Brand name works the same way.

Translations must be written, not machine-literal: adapt the hook to sound native, keep
the same claim, and keep `*highlights*` on the equivalent words. In bilingual mode the
translation is rendered without highlights, so keep it short (it's a subtitle).

Screenshots can be localized too: put them in `screens/es/`, `screens/en/` and reference
`"screens/{lang}/1.png"`. If a language's file is missing it falls back to the primary
language, then to `screens/1.png` — so UI that doesn't change across languages needs only
one copy. In bilingual mode the primary language's screenshots are used.

## Workflow

Work through these phases in order. Keep the user in the loop at the two checkpoints
(after the plan, after the first render); otherwise just do the work.

### 1. Setup (first run only)

```bash
[ -d "$SKILL_DIR/node_modules" ] || npm install --prefix "$SKILL_DIR"
```

PowerShell: `if (-not (Test-Path "$SKILL_DIR/node_modules")) { npm install --prefix "$SKILL_DIR" }`

Requires Node 18+. No API keys, no network at render time. Works on macOS, Linux and
Windows (iOS simulator capture in phase 3 is macOS-only; Android works everywhere).

### 2. Understand the app

Read, don't guess. In an Expo project look at:

- `app.json` / `app.config.ts` — `name`, `slug`, `icon`, `splash.backgroundColor`,
  `android.adaptiveIcon.backgroundColor`, `primaryColor`, `userInterfaceStyle`.
- Theme sources — `constants/Colors.ts`, `theme.ts`, `tailwind.config.js` (NativeWind),
  `tamagui.config.ts`, `unistyles`, or any `colors` object. Pick the real primary/accent.
- `app/` (expo-router) or `src/screens` / `navigation/` — list the screens and what each does.
- `README.md`, `package.json` description, App Store / Play listing text if present.
- `assets/fonts/` — if the app ships a custom font (TTF/OTF), use it for the images.
- Languages — `app.json` `locales`, `locales/*.json`, i18n setup. Existing store copy
  (e.g. a `store/` folder, fastlane metadata) is the best source of approved translations.
- Existing marketing assets — store screenshots, a previous `/brag` output. Reuse their
  copy and raw captures instead of asking the user for new ones.

From this, write down (internally) the **one-line value prop**, the **3–6 features worth
showing**, and the **audience**. Images sell outcomes, not features: "Never miss a dose"
beats "Medication reminders screen".

### 3. Get screenshots

Screenshots go in `social-shots/screens/` as PNG/JPG. Prefer, in order:

1. **User-provided** — ask the user to drop simulator screenshots there (iOS Simulator:
   ⌘S; Android Emulator: camera button). Tell them which screens you want, by name,
   based on phase 2. Ask them to use realistic demo data, not empty states.
2. **Capture from a running simulator** (if the user has one open with the app running):
   - iOS: `xcrun simctl io booted screenshot social-shots/screens/<name>.png`
   - Android: `adb exec-out screencap -p > social-shots/screens/<name>.png`
   Navigate between screens with a deep link: `npx uri-scheme open "<scheme>://<route>" --ios`
   (scheme from `app.json`), or ask the user to tap through while you capture.
3. **Maestro** (if `.maestro/` exists or the user wants full automation) — a flow with
   `takeScreenshot` steps.

Tips that make a big visual difference:
- iOS status bar: `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 --cellularBars 4`
- Use the same device for all shots (consistent aspect ratio). 6.1"/6.7" iPhone is ideal.
- Light mode screens pop on dark backgrounds and vice versa.

Look at each screenshot (Read the image) before planning so headlines match what's on screen.

### 4. Plan the set → checkpoint

Default set (adjust to the user's channels):

| id | template | format | purpose |
|----|----------|--------|---------|
| launch-x | hero | x | launch announcement |
| feature-1-x | duo | x | strongest feature |
| launch-ig | hero | ig-portrait | feed post |
| features-ig | trio | ig-square | overview carousel cover |
| launch-story | hero | story | Stories / Reels / TikTok cover |
| hook-ig | statement | ig-square | bold claim / stat, no phone |
| ph-gallery | trio | ph | Product Hunt (only if launching there) |

Show the user the plan as a short table with each headline (and its translation when
the mode isn't `single`), plus the language mode. Ask once whether to change anything;
if they're not around, proceed.

### 5. Write `shots.json`

```jsonc
{
  "brand": {
    "name": "Habitly",
    "icon": "../assets/images/icon.png",          // relative to shots.json
    "colors": {
      "bg": "#120C2E",      // gradient start (usually dark brand color)
      "bg2": "#2A1B6B",     // gradient end (optional)
      "accent": "#5EE6D0",  // highlighted words, badges, glow
      "text": "#FFFFFF",    // headline
      "muted": "#C9C3E6"    // subhead (optional, defaults to text @72%)
    },
    "fonts": { "regular": "../assets/fonts/Brand-Regular.ttf", "bold": "../assets/fonts/Brand-Bold.ttf" }, // optional; default Inter
    "bezel": "#0B0B0F"      // optional phone frame color
  },
  "output": "out",
  "i18n": {                          // optional; omit for a single-language app
    "languages": ["es", "en"],       // first = primary
    "mode": "single"                 // single | multi | bilingual (CLI flags override)
  },
  "images": [
    {
      "id": "launch-x",
      "template": "hero",            // hero | duo | trio | statement
      "format": "x",                 // see formats table
      "badge": { "es": "Nuevo", "en": "New" },              // optional pill above headline
      "headline": {                                          // *word* = accent color
        "es": "Hábitos que *por fin* se quedan",
        "en": "Build habits that *actually stick*"
      },
      "subhead": { "es": "Rachas y recordatorios en un toque.", "en": "Streaks and reminders in one tap." },
      "screenshots": ["screens/{lang}/home.png"],            // or plain "screens/home.png"
      "colors": { "bg": "#000000" }  // optional per-image overrides
    }
  ]
}
```

Single-language configs can keep using plain strings everywhere.

**Templates**

| template | screenshots | best for |
|----------|-------------|----------|
| `hero` | 1 | launch posts, single key screen |
| `duo` | 2 | before/after, feature + detail (tilted, overlapping phones) |
| `trio` | 3 | overview, carousel covers; middle screenshot is featured |
| `statement` | 0 | bold claims, stats, quotes, "now available" (icon + text) |

**Formats**

| format | size | use |
|--------|------|-----|
| `x` | 1200×675 | X / Twitter, Bluesky, Threads link-style |
| `linkedin` | 1200×627 | LinkedIn feed |
| `og` | 1200×630 | link preview for the landing page |
| `ig-square` | 1080×1080 | Instagram / Threads / Facebook feed |
| `ig-portrait` | 1080×1350 | Instagram feed (takes more screen space — preferred) |
| `story` | 1080×1920 | Stories, Reels/TikTok cover, WhatsApp status |
| `ph` | 1270×760 | Product Hunt gallery |

**Copy rules**
- Headline: 3–7 words, max ~45 characters. Highlight 1–3 words with `*...*`, never the whole line.
- Subhead: optional, one short sentence. Skip it in `story` if the headline is long.
- Badge: 1–3 words ("New", "Free", "iOS & Android", "v2.0").
- No emojis in images (the renderer strips them — fonts have no emoji glyphs). Put emojis in captions.
- Write in the language the user's app/audience uses.

**Color rules**
- Background should contrast strongly with the screenshots' dominant color.
- `accent` must be readable on `bg` — use the brand's brightest color, not its darkest.
- Keep one palette for the whole set so it reads as a campaign; vary only via per-image overrides if needed.

### 6. Render

```bash
R="npx --prefix $SKILL_DIR tsx $SKILL_DIR/scripts/render.ts"
$R social-shots/shots.json                                  # mode from i18n (default: single, primary language)
$R social-shots/shots.json --lang en                        # single, in English → out/
$R social-shots/shots.json --mode multi                     # every language → out/es/, out/en/
$R social-shots/shots.json --mode multi --langs es,en,pt    # choose languages
$R social-shots/shots.json --mode bilingual --langs es,en   # es headline + en subtitle → out/es+en/
$R social-shots/shots.json --only launch-x,launch-story     # re-render only some (combine with any mode)
```

The renderer fails with a list like `launch-x.headline: missing translation for "en"`
when a language the mode needs is missing — fill it in rather than dropping the language.

If `npx --prefix` isn't resolving `tsx`, run `"$SKILL_DIR/node_modules/.bin/tsx"` directly.

### 7. Review every image → checkpoint

Open each PNG with the Read tool and check:
- Headline wraps cleanly (no single orphan word on the last line; shorten copy if so).
- Text doesn't overlap the phone; nothing important is cropped.
- Screenshot content is legible and relevant to the headline.
- Contrast is good; accent words stand out.
- Every language: translations often run 20–30% longer (German, Spanish, Portuguese).
  If one language overflows, shorten that language's copy instead of the others'.
- Bilingual: subtitles stay readable at phone size and don't crowd the phone mockup;
  if they do, drop the translated subhead for that image (keep the headline translation).

Fix by editing copy or colors in `shots.json` and re-rendering with `--only`. Iterate until
clean, then show the user the set.

### 8. Captions

Write captions with, per image: the platform, a ready-to-paste caption (hook first
line, 1–3 short lines, CTA with store link placeholder), and 3–5 hashtags for
Instagram/LinkedIn only. Emojis welcome here. Match the tone the user asked for (default:
confident, plain, no hype words like "revolutionary").

- `single` → `social-shots/captions.md` in that language.
- `multi` → `social-shots/captions/<lang>.md`, one file per language, written natively
  (hashtags that people in that language actually use, not translated ones).
- `bilingual` → `social-shots/captions/es+en.md`: primary language first, then a blank
  line and the translation; hashtags from both languages.

### 9. Wrap up

Tell the user where the images are, which one to post first, and offer variants
(another language, different palette, more feature posts).

## Arguments

- `/social-shots` — full workflow.
- `--tone "<description>"` — steer copy (e.g. "playful", "indie hacker build-in-public").
- `--formats x,story` — limit formats.
- `--lang es` — single language.
- `--multi es,en` — one set per language (separate folders).
- `--bilingual es,en` — primary language + translation subtitles (first is primary).

## Troubleshooting

- `Image not found` — paths in `shots.json` are relative to the JSON file.
- Custom font fails — Satori needs TTF/OTF/WOFF, not WOFF2.
- `needs N screenshot(s)` — template/screenshot count mismatch (see templates table).
- Screenshots with transparent or rounded corners already applied work fine; avoid
  screenshots that already include a device frame (they'll get double-framed).
