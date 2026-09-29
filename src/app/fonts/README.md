# Self-hosted fonts

Loaded in `src/app/layout.tsx` with `next/font/local`. They replace
`next/font/google`, whose build-time download intermittently crashed the
production build (vercel/next.js#99114).

| File | Family | Axes (min / default / max) | CSS variable |
| --- | --- | --- | --- |
| `fraunces-latin-variable.woff2` | Fraunces | opsz 9/9/144, wght 100/900/900, SOFT 0/0/100, WONK 0/1/1 | `--font-display` |
| `plus-jakarta-sans-latin-variable.woff2` | Plus Jakarta Sans | wght 200/400/800 | `--font-sans` |
| `jetbrains-mono-latin-variable.woff2` | JetBrains Mono | wght 100/400/800 (declared 400–500) | `--font-mono` |

Upright styles only (the app never used italics). Each licence is alongside as
`OFL-*.txt` (SIL Open Font License 1.1).

## Provenance

Source: the official Google Fonts repository, `github.com/google/fonts`, commit
`23e54b51ddffbc7713c583748e3bd86f62b1fa4a`:

- `ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf`
- `ofl/plusjakartasans/PlusJakartaSans[wght].ttf`
- `ofl/jetbrainsmono/JetBrainsMono[wght].ttf`

Each was subset to the same `latin` unicode range Google serves and converted to
WOFF2 with fontTools, keeping every layout feature and all variation tables:

```sh
pip install fonttools brotli
pyftsubset "<font>.ttf" \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" \
  --flavor=woff2 --layout-features='*' --layout-scripts='*' --name-IDs='*' --notdef-outline \
  --output-file="<name>.woff2"
```

Characters outside that range (e.g. Cyrillic, Greek, Vietnamese, extended Latin)
fall back to the system font.
