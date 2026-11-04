# /social-shots

Turn your mobile app (Expo / React Native first) into a ready-to-post set of social media
images: real screenshots in phone mockups, on-brand headlines, and captions. In one
language, several languages, or bilingual with translation subtitles. Like
[/brag](https://github.com/latent-spaces/brag), but for images.

![preview](examples/preview.jpg)

## Install

### Claude Code (plugin)

```
/plugin install social-shots --marketplace obedvs/social-shots
```

Or in two steps (any Claude Code version with plugins):

```
/plugin marketplace add obedvs/social-shots
/plugin install social-shots@social-shots
```

Update later with `/plugin marketplace update social-shots`. As a plugin the skill runs
as `/social-shots:social-shots`; you can also just ask for "social images for my app".

### Any agent (Claude Code, Cursor, Codex, Gemini CLI, opencode…)

```bash
npx skills add https://github.com/obedvs/social-shots          # this project
npx skills add https://github.com/obedvs/social-shots -g       # every project
```

Installing into a project (`.claude/skills/social-shots/`) and committing it is the way
to use the skill in cloud sessions too (e.g. Claude Code on the web): it travels with the
repo, so any session that opens the project has it.

### Manual

```bash
git clone https://github.com/obedvs/social-shots ~/.claude/skills/social-shots
cd ~/.claude/skills/social-shots && npm install
```

Dependencies are installed automatically the first time the skill runs, so `npm install`
is optional in the first two methods. Requires Node 18+.

## Use

From your app's root, ask your agent:

```
/social-shots
/social-shots --tone "indie hacker build in public" --lang es --formats x,ig-portrait,story
/social-shots --multi es,en          # one set per language: out/es/, out/en/
/social-shots --bilingual es,en      # Spanish headline + English subtitle: out/es+en/
```

You'll get `social-shots/` in your project with the images in `out/`, the plan in
`shots.json`, and captions for each language. Re-run it any time; edit `shots.json` and
re-render to tweak copy or colors.

## Languages

| mode | output | text |
|------|--------|------|
| `single` | `out/*.png` | one language |
| `multi` | `out/<lang>/*.png` | same set, one folder per language |
| `bilingual` | `out/es+en/*.png` | primary headline + translation as a subtitle line |

Any text field can be a string or `{ "es": "...", "en": "..." }`. Screenshot paths may use
`{lang}` (`screens/{lang}/1.png`) and fall back to the primary language or `screens/1.png`.

## Templates and formats

Templates: `hero` (1 phone), `duo` (2 tilted phones), `trio` (3 phones), `statement` (icon + text).

| format | size | use |
|--------|------|-----|
| `x` | 1200×675 | X / Bluesky / Threads |
| `linkedin` | 1200×627 | LinkedIn |
| `og` | 1200×630 | link preview (`og:image`) |
| `ig-square` | 1080×1080 | Instagram / Facebook feed |
| `ig-portrait` | 1080×1350 | Instagram feed (4:5) |
| `story` | 1080×1920 | Stories, Reels / TikTok cover |
| `ph` | 1270×760 | Product Hunt gallery |

See [SKILL.md](SKILL.md) for the full `shots.json` schema.

## Render manually

```bash
npm install
npm run render -- examples/shots.json --out out
npm run render -- examples/shots.json --mode bilingual --langs es,en --out out
```

## How it works

TypeScript + [Satori](https://github.com/vercel/satori) (layout → SVG) +
[resvg](https://github.com/yisibl/resvg-js) (SVG → PNG). No API keys, no network at render
time, fully deterministic: the agent writes copy and colors into `shots.json` and iterates.

## License

MIT
