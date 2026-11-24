# dsh-ghost-input

Inline continuation (ghost text) for the DeepSeek Harness composer — stop typing, and the model writes the rest of the sentence in grey right after the caret. Press `Tab` to keep it.

> A plugin for DeepSeek Harness (DSH). Without DSH there is nothing for it to run in.

## What it does

Type half a sentence in the composer and pause (about 0.6 s). The plugin asks the model currently selected for that session for a continuation and shows it as light grey text after the caret:

- `Tab` — accept the continuation; the caret moves to its end
- `Esc`, keep typing, move the caret, switch session — discard immediately
- Shown only when the caret sits at the end of the draft and nothing is selected
- Never fires while an IME composition is open, so it does not fight candidate words
- Skipped when the draft starts with `/` or `@` (commands and references own those)

Whether a continuation is worth showing is the model's decision: a draft that is too short, a context that is too thin, or a low-confidence case returns an empty string and the plugin stays quiet.

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

## Configuration

The plugin row's config lives in `cordis.patch.yml` (or the plugin page). Every key is optional:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Master switch |
| `maxTokens` | `48` | Output cap for one continuation |
| `temperature` | `0.3` | Sampling temperature; lower is steadier |
| `timeoutMs` | `4500` | Per-request timeout; failures stay silent |
| `maxSuffixChars` | `80` | Longest continuation shown, truncated beyond that |

The browser-side pause is fixed at 600 ms (edit `DEFAULTS` at the top of `client.js`).

## Cost and privacy

- One model request per **pause**, not per keystroke; only one request stays in flight, and a new keystroke aborts it.
- A continuation for the same draft is cached for 45 seconds, so repeated pauses cost nothing.
- The request contains a short tail of the conversation plus the current draft. Both already go to the model provider you are using; the plugin sends them nowhere else and stores nothing.

## Known limitations

- The composer is a host-owned Lexical `contenteditable`, and DSH does not expose its editing API to plugins, so this plugin drives it through DOM events. A large composer rewrite may need a matching update here.
- The grey continuation reuses the host's `p:last-child::after` hint slot and yields whenever the host's own command hint is showing.
- Very short drafts (one or two characters) still request a completion; whether to continue is the model's call, at the cost of one tiny request.

## License

MIT
