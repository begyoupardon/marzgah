# Languages and fonts

The app supports Persian (`fa`, the default) and English (`en`). Choose a language in the account menu, or use the language button on the sign-in, home and customer subscription pages. The `marzgah-locale` cookie saves the choice for one year. The root route reads it on each request so HTML language, direction and initial content agree during server rendering. Language state lives in a React provider, not a shared server singleton.

Use `useI18n()` for `t`, `locale`, `direction`, `numberLocale` and the number, date, byte and toman formatters. Persian uses the Persian calendar and digits; English uses the Gregorian calendar and Latin digits. Currency remains toman in both languages. Keep identifiers, customer names, notes and messages unchanged; isolate technical values with `dir="ltr"` or `dir="auto"` as appropriate.

Persian source messages are translation keys in `src/lib/i18n/en.json`. Add a complete message with numbered placeholders when word order depends on a value, for example `t('کاربر: {0}', { 0: username })`. React escapes the result normally. Do not concatenate user data into translation keys. Localize shared schema and server errors where they are displayed, while preserving the original validation rules and stored data. Catalog templates also handle already formatted server validation messages.

Arad is served from `/Arad-VF.woff2`. Fontsource does not publish an Arad package. Poppins is installed through `@fontsource/poppins`, with local Latin stylesheets for weights 400, 500, 600 and 700 imported in `src/styles.css`. Vite bundles those font files; neither language requires a font CDN. Explicit `lang="fa"` and `lang="en"` spans use the matching font even inside the other language.

Run `bun test src/lib/i18n/core.test.ts` to check interpolation coverage, request-independent translators, fallback behavior and locale-specific formatting. Also check both directions, language persistence after reload, mobile navigation, account menus and long English labels when changing layouts.
