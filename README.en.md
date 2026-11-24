# dsh-ghost-input

[简体中文](README.md) · [**English**](README.en.md)

![version](https://img.shields.io/badge/version-0.2.1-blue)
![AIGC](https://img.shields.io/badge/AIGC-assisted-ff9f43)
![human review](https://img.shields.io/badge/human%20review-completed-2ea44f)
![license](https://img.shields.io/badge/license-MIT-2ea44f)

Inline continuation (ghost text) for the DeepSeek Harness composer — stop typing, and the model writes the rest of the sentence in grey right after the caret. Press `Tab` to keep it.

![Ghost text with the Tab key cap](docs/screenshot.png)

> A plugin for DeepSeek Harness (DSH). Without DSH there is nothing for it to run in.

## What it does

Type half a sentence in the composer and pause (about 0.6 s). The plugin asks the model currently selected for that session for a continuation and shows it as light grey text after the caret:

- A small `Tab` key cap floats right after the grey text, so the shortcut is discoverable; the cap stays faint and never steals focus
- `Tab` — accept the continuation; the caret moves to its end
- `Esc`, keep typing, move the caret, switch session — discard immediately
- Shown only when the caret sits at the end of the draft and nothing is selected
- Never fires while an IME composition is open, so it does not fight candidate words
- Skipped when the draft starts with `/` or `@` (commands and references own those)

**On phones** there is no `Tab` key, so the plugin switches to touch:

- The key cap reads “轻点” (tap) — tap the faded continuation itself (or the cap) to accept it, the keyboard stays open
- A small `⇥ 补全` chip floats above the composer: tap to accept, **long press** to discard
- Everything else is unchanged: typing on, moving the caret or switching sessions discards the suggestion

The continuation is grounded in the recent conversation and the draft itself, so it picks up the topic and wording already in play. Whether it is worth showing is the model's decision: a draft that is too short, a context that is too thin, or a low-confidence case returns an empty string and the plugin stays quiet.

## Install

### From GitHub (recommended)

```bash
dsh plugin install https://github.com/KunKun24/dsh-ghost-input
```

Or open **Plugins** → **Add plugin** in the DSH web UI and paste the repository URL.

### From a checkout

```bash
git clone https://github.com/KunKun24/dsh-ghost-input.git
dsh plugin install ./dsh-ghost-input
```

Then enable the `ghost-input` row under **Plugins** and refresh the page. The bundle carries both halves:

- the Host half registers `POST /api/ghost-input/complete` and runs one short completion through `ctx.llm` with the session's own model;
- the browser half watches the composer (a Lexical contenteditable) for pauses, `Tab`, and IME events, then renders the result as grey trailing text.

## Settings

Installing the plugin adds a **Settings** entry to the sidebar: pause delay, longest continuation, output budget, temperature, timeout, key cap label, whether conversation context is used, and the master switch all live there. Edits save as you go and apply to the next pause without a reload; the GitHub card in the top-right corner opens the repository, so you can leave a star if you find it useful.

The host clamps every value it writes and stores them in `<DSH_HOME>/ghost-input/settings.json` (default `~/.dsh/ghost-input/settings.json`), so upgrading the plugin never wipes them.

The plugin row's config in `cordis.patch.yml` (or the plugin page) still works as the initial value. Every key is optional:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch |
| `delayMs` | `600` | How long you stop typing before the request (200–1500 ms) |
| `maxTokens` | `96` | Output cap for one continuation |
| `temperature` | `0.3` | Sampling temperature; lower is steadier |
| `timeoutMs` | `4500` | Per-request timeout; failures stay silent |
| `maxSuffixChars` | `80` | Longest continuation shown, clipped to the line |
| `hintKey` | `Tab` | Text drawn on the key cap after the grey continuation |
| `useContext` | `true` | Send the recent conversation tail and workspace name |

## Cost and privacy

- One model request per **pause**, not per keystroke; only one request stays in flight, and a new keystroke aborts it.
- A continuation for the same draft is cached for 45 seconds, so repeated pauses cost nothing.
- The request contains a short tail of the conversation plus the current draft. Both already go to the model provider you are using; the plugin sends them nowhere else and stores nothing.

## Known limitations

- The composer is a host-owned Lexical `contenteditable`, and DSH does not expose its editing API to plugins, so this plugin drives it through DOM events. A large composer rewrite may need a matching update here.
- The grey continuation is drawn by the last paragraph's `::after`, right after the caret; the plugin yields while an official command hint or an IME composition is showing.
- Very short drafts (one or two characters) still request a completion; whether to continue is the model's call, at the cost of one tiny request.
- On phones, while a suggestion is showing, tapping that thin strip accepts it instead of moving the caret; tap elsewhere to move the caret.

## AI disclosure

This plugin's code and documentation were written with **AIGC (AI-generated content) assistance** and have been reviewed by a human:

- Every line was read and edited by hand; nothing was pasted in raw
- Behaviour was verified item by item on a live DSH instance in a headless browser: the ghost text appears, `Tab` accepts, `Esc` discards, IME composition suppresses it, results are cached for 45 seconds, and the tap / long-press paths work on phones
- Before release, the host route's authentication, the model call's cost boundary and where the data goes were checked manually

Human review is not a zero-defect guarantee. If reality disagrees with this document, please open an [issue](https://github.com/KunKun24/dsh-ghost-input/issues).

## License

MIT
