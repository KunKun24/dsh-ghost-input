/**
 * Client half of dsh-ghost-input.
 *
 * The composer is a Lexical contenteditable; its own tail hint is rendered by
 * `p:last-child::after`. This module keeps a grey continuation in that same
 * slot (through a data attribute of its own, so the host's command hint is
 * never touched), floats a small `Tab` key cap behind it, listens for Tab, and
 * asks the host for a completion once the user pauses.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ghost-input',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const STYLE_ID = 'dsh-ghost-input-style';
    /** Room kept after the caret for the Tab key cap before the text is clipped. */
    const BADGE_SPACE = 46;
    const TOUCH_HINT = '轻点';

    /** True on phones/tablets, where no physical Tab key exists. */
    const isCoarsePointer = () => typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    const CSS = [
      '[data-composer-input] p[data-ghost-suffix]::after{',
      'content:attr(data-ghost-suffix) !important;',
      'color:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8b93a7) 55%, transparent) !important;',
      'pointer-events:none;',
      'white-space:pre;',
      '}',
      '[data-ghost-tab]{',
      'position:fixed;',
      'display:inline-flex;align-items:center;justify-content:center;',
      'padding:1px 5px;',
      'border:1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary,#8b93a7) 22%, transparent);',
      'border-radius:4px;',
      'background:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8b93a7) 6%, transparent);',
      'color:color-mix(in srgb, var(--dsw-alias-label-tertiary,#8b93a7) 70%, transparent);',
      'font-family:inherit;font-size:10px;font-weight:500;line-height:1.35;letter-spacing:.03em;',
      'transform:translateY(-50%);',
      'pointer-events:none;user-select:none;',
      'z-index:2147483000;',
      '}',
      '[data-ghost-tab][hidden]{display:none}',
      '[data-ghost-measure]{position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none}',
      '[data-ghost-tap]{',
      'position:fixed;margin:0;padding:0;border:0;background:transparent;',
      'cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;',
      'z-index:2147483001;',
      '}',
      '[data-ghost-tap][hidden]{display:none}',
      '[data-ghost-pill]{',
      'position:fixed;display:inline-flex;align-items:center;justify-content:center;gap:5px;',
      'height:34px;padding:0 12px;margin:0;',
      'border:1px solid color-mix(in srgb, var(--dsw-alias-label-tertiary,#8b93a7) 30%, transparent);',
      'border-radius:999px;',
      'background:color-mix(in srgb, var(--dsw-alias-bg-base,#fff) 92%, transparent);',
      'color:color-mix(in srgb, var(--dsw-alias-label-primary,#1a2332) 78%, transparent);',
      'font-family:inherit;font-size:12px;font-weight:500;line-height:1;',
      'box-shadow:0 2px 10px rgba(0,0,0,.10);',
      'cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;',
      'z-index:2147483002;',
      '}',
      '[data-ghost-pill][hidden]{display:none}',
    ].join('');

    const DEFAULTS = {
      enabled: true,
      delayMs: 600,
      maxSuffixChars: 80,
      hintKey: 'Tab',
      maxTokens: 96,
      temperature: 0.3,
      timeoutMs: 4500,
      useContext: true,
    };


    const BRAND = 'var(--dsw-alias-brand-primary, #4d6bfe)';
    const MUTED = 'var(--dsw-alias-text-secondary, #8b93a7)';
    const LINE = 'var(--dsw-alias-border-secondary, rgba(128,128,128,.22))';
    const REPO = 'https://github.com/KunKun24/dsh-ghost-input';

    const COPY = {
      zh: {
        title: '输入框续写 · 参数设置',
        lead: '改动即时保存，下一次停顿就按新参数工作，不需要刷新页面。',
        enabled: ['总开关', '关掉后不再向模型发任何请求'],
        delay: ['停顿延迟', '停手多久之后才去问模型；太短会打断思路，太长会显得迟钝'],
        chars: ['最多显示字数', '灰字最长显示多少字，超出的部分按行宽截断'],
        tokens: ['输出上限', '一次续写的 token 上限，太小会被推理过程吃光'],
        temp: ['采样温度', '越低越稳、越贴上下文；越高越发散'],
        timeout: ['超时', '超过这个时间没返回就静默放弃这次续写'],
        hint: ['键帽文字', '灰字后面那个小键帽上显示的文字'],
        context: ['带上对话上下文', '关闭后只看当前草稿，省 token 但续写会更泛'],
        reset: '恢复默认',
        saved: '已保存',
        loading: '读取中…',
        failed: '读取失败，检查插件是否已启用',
        star: '喜欢的话点个 star 吧',
      },
      en: {
        title: 'Ghost input · Settings',
        lead: 'Changes are saved as you edit and apply to the next pause; no reload needed.',
        enabled: ['Enabled', 'Off means no model request at all'],
        delay: ['Pause delay', 'How long you stop typing before the model is asked'],
        chars: ['Max characters', 'Longest continuation shown before it is clipped to the line'],
        tokens: ['Output budget', 'Token ceiling for one continuation'],
        temp: ['Temperature', 'Lower stays closer to the draft and the conversation'],
        timeout: ['Timeout', 'Give up silently after this long'],
        hint: ['Key cap label', 'Text on the small key cap after the grey text'],
        context: ['Use conversation context', 'Off: only the draft, cheaper but blander'],
        reset: 'Reset defaults',
        saved: 'Saved',
        loading: 'Loading…',
        failed: 'Could not read settings — is the plugin enabled?',
        star: 'Star it if you find it useful',
      },
    };

    const copy = () => (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '') ? COPY.zh : COPY.en);

    function SlidersIcon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('line', { key: 'a', x1: 4, y1: 7, x2: 20, y2: 7 }),
        h('circle', { key: 'b', cx: 9, cy: 7, r: 2.4, fill: 'currentColor', stroke: 'none' }),
        h('line', { key: 'c', x1: 4, y1: 17, x2: 20, y2: 17 }),
        h('circle', { key: 'd', cx: 15, cy: 17, r: 2.4, fill: 'currentColor', stroke: 'none' })
      );
    }

    function GithubMark({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' },
        h('path', {
          d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z',
        })
      );
    }

    function Switch({ checked, onChange }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked,
        onClick: () => onChange(!checked),
        style: {
          width: 44, height: 24, borderRadius: 12, border: 0, padding: 0, flex: 'none',
          position: 'relative', cursor: 'pointer',
          background: checked ? BRAND : 'rgba(128,128,128,.35)',
          transition: 'background .18s',
        },
      }, h('span', {
        style: {
          position: 'absolute', top: 3, left: checked ? 23 : 3,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left .18s', boxShadow: '0 1px 2px rgba(0,0,0,.28)',
        },
      }));
    }

    function Row({ title, hint, children }) {
      return h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 20,
          padding: '14px 0', borderBottom: '1px solid ' + LINE,
        },
      },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: 13.5, fontWeight: 500 } }, title),
          hint ? h('div', { style: { fontSize: 12, color: MUTED, marginTop: 3, lineHeight: 1.55 } }, hint) : null
        ),
        h('div', { style: { flex: 'none', minWidth: 150, display: 'flex', justifyContent: 'flex-end' } }, children)
      );
    }

    function Range({ value, min, max, step, onChange, label }) {
      return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        h('input', {
          type: 'range', min, max, step, value,
          onChange: (event) => onChange(Number(event.target.value)),
          style: { width: 110, accentColor: BRAND },
        }),
        h('span', { style: { fontSize: 12.5, color: MUTED, minWidth: 52, textAlign: 'right' } }, label)
      );
    }

    function NumberBox({ value, min, max, onChange }) {
      return h('input', {
        type: 'number', min, max, value,
        onChange: (event) => onChange(Number(event.target.value)),
        style: {
          width: 92, padding: '5px 8px', fontSize: 13, textAlign: 'right',
          border: '1px solid ' + LINE, borderRadius: 8, background: 'transparent',
          color: 'inherit', outline: 'none',
        },
      });
    }

    function TextBox({ value, onChange }) {
      return h('input', {
        type: 'text', value, maxLength: 8,
        onChange: (event) => onChange(event.target.value),
        style: {
          width: 92, padding: '5px 8px', fontSize: 13, textAlign: 'center',
          border: '1px solid ' + LINE, borderRadius: 8, background: 'transparent',
          color: 'inherit', outline: 'none',
        },
      });
    }

    function RepoCard() {
      const t = copy();
      return h('a', {
        href: REPO, target: '_blank', rel: 'noopener noreferrer',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none',
          padding: '6px 12px 6px 10px', borderRadius: 999,
          border: '1px solid ' + LINE, color: MUTED,
          fontSize: 12.5, textDecoration: 'none', whiteSpace: 'nowrap',
          transition: 'color .15s, border-color .15s',
        },
        onMouseEnter: (event) => {
          event.currentTarget.style.color = 'var(--dsw-alias-text-primary, inherit)';
          event.currentTarget.style.borderColor = BRAND;
        },
        onMouseLeave: (event) => {
          event.currentTarget.style.color = MUTED;
          event.currentTarget.style.borderColor = LINE;
        },
      },
        h(GithubMark, null),
        h('span', null, `${t.star} ›`)
      );
    }

    function SettingsPanel() {
      const t = copy();
      const [config, setConfig] = React.useState(null);
      const [status, setStatus] = React.useState(t.loading);
      const timer = React.useRef(null);

      React.useEffect(() => {
        let alive = true;
        fetch('/api/ghost-input/config', { credentials: 'same-origin' })
          .then((response) => response.json())
          .then((data) => {
            if (!alive) return;
            if (data && data.ok) {
              setConfig(data.config);
              setStatus('');
            } else {
              setStatus(t.failed);
            }
          })
          .catch(() => alive && setStatus(t.failed));
        return () => {
          alive = false;
          if (timer.current !== null) clearTimeout(timer.current);
        };
      }, []);

      const save = (patch) => {
        const next = { ...config, ...patch };
        setConfig(next);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('dsh-ghost-input:config', { detail: next }));
        }
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(async () => {
          try {
            const response = await fetch('/api/ghost-input/config', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(next),
            });
            const data = await response.json();
            if (data && data.ok) {
              setStatus(t.saved);
              setTimeout(() => setStatus(''), 1600);
            } else {
              setStatus('保存失败');
            }
          } catch {
            setStatus('保存失败');
          }
        }, 400);
      };

      const header = h('div', {
        style: { display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 4 },
      },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { style: { fontSize: 18, fontWeight: 600 } }, t.title),
          h('div', { style: { fontSize: 12.5, color: MUTED, marginTop: 6, lineHeight: 1.6 } }, t.lead)
        ),
        h(RepoCard, null)
      );

      const body = config
        ? h('div', null,
            h(Row, { title: t.enabled[0], hint: t.enabled[1] },
              h(Switch, { checked: !!config.enabled, onChange: (value) => save({ enabled: value }) })
            ),
            h(Row, { title: t.delay[0], hint: t.delay[1] },
              h(Range, {
                value: config.delayMs, min: 200, max: 1500, step: 50,
                label: `${config.delayMs} ms`,
                onChange: (value) => save({ delayMs: value }),
              })
            ),
            h(Row, { title: t.chars[0], hint: t.chars[1] },
              h(Range, {
                value: config.maxSuffixChars, min: 20, max: 200, step: 10,
                label: `${config.maxSuffixChars}`,
                onChange: (value) => save({ maxSuffixChars: value }),
              })
            ),
            h(Row, { title: t.tokens[0], hint: t.tokens[1] },
              h(NumberBox, {
                value: config.maxTokens, min: 16, max: 512,
                onChange: (value) => save({ maxTokens: value }),
              })
            ),
            h(Row, { title: t.temp[0], hint: t.temp[1] },
              h(Range, {
                value: config.temperature, min: 0, max: 1, step: 0.05,
                label: Number(config.temperature).toFixed(2),
                onChange: (value) => save({ temperature: value }),
              })
            ),
            h(Row, { title: t.timeout[0], hint: t.timeout[1] },
              h(NumberBox, {
                value: config.timeoutMs, min: 500, max: 10000,
                onChange: (value) => save({ timeoutMs: value }),
              })
            ),
            h(Row, { title: t.hint[0], hint: t.hint[1] },
              h(TextBox, { value: config.hintKey, onChange: (value) => save({ hintKey: value }) })
            ),
            h(Row, { title: t.context[0], hint: t.context[1] },
              h(Switch, { checked: !!config.useContext, onChange: (value) => save({ useContext: value }) })
            ),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 } },
              h('button', {
                type: 'button',
                onClick: () => save({
                  enabled: true, delayMs: 600, maxSuffixChars: 80,
                  maxTokens: 96, temperature: 0.3, timeoutMs: 4500,
                  hintKey: 'Tab', useContext: true,
                }),
                style: {
                  padding: '7px 14px', fontSize: 12.5, borderRadius: 8,
                  border: '1px solid ' + LINE, background: 'transparent',
                  color: 'inherit', cursor: 'pointer',
                },
              }, t.reset),
              h('span', { style: { fontSize: 12, color: MUTED } }, status)
            )
          )
        : h('div', { style: { padding: '40px 0', fontSize: 13, color: MUTED } }, status || t.loading);

      return h('div', {
        style: {
          maxWidth: 760, margin: '0 auto', padding: '38px 28px 60px',
          fontSize: 13.5, lineHeight: 1.6,
        },
      }, header, body);
    }

    function registerSlots(ctx) {
      try {
        if (!ctx || !ctx.slots) return;
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({
            name: 'sidebar.panellist',
            id: 'ghost-input',
            order: 35,
            label: () => (copy() === COPY.zh ? '参数设置' : 'Ghost settings'),
          }, SlidersIcon)
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'ghost-input' }, SettingsPanel)
        );
      } catch {
        /* a host without the sidebar slots still gets the composer behaviour */
      }
    }

    function apply(ctx) {
      registerSlots(ctx);
      if (typeof document === 'undefined' || typeof window === 'undefined') return;
      try {

      /** Live settings: patch config, then whatever the settings panel saved on the host. */
      const config = { ...DEFAULTS };
      try {
        const own = ctx?.config;
        if (own !== null && typeof own === 'object') Object.assign(config, own);
      } catch {
        /* config is only readable when injected; defaults are fine */
      }
      const adoptConfig = (raw) => {
        if (!raw || typeof raw !== 'object') return;
        for (const key of Object.keys(DEFAULTS)) {
          if (raw[key] !== undefined) config[key] = raw[key];
        }
        if (typeof badge?.textContent === 'string') syncBadge();
      };

      fetch('/api/ghost-input/config', { credentials: 'same-origin' })
        .then((response) => response.json())
        .then((data) => {
          if (data && data.ok) adoptConfig(data.config);
        })
        .catch(() => {});

      const state = {
        ghost: '',
        shown: '',
        anchor: null,
        timer: null,
        controller: null,
        composing: false,
        seq: 0,
        enabled: true,
      };

      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.append(style);

      const badge = document.createElement('span');
      badge.setAttribute('data-ghost-tab', '');
      const syncBadge = () => {
        const configured = typeof config.hintKey === 'string' && config.hintKey ? config.hintKey : 'Tab';
        badge.textContent = configured === 'Tab' && isCoarsePointer() ? TOUCH_HINT : configured;
      };
      syncBadge();
      badge.hidden = true;
      document.body.append(badge);

      const tap = document.createElement('button');
      tap.setAttribute('data-ghost-tap', '');
      tap.type = 'button';
      tap.tabIndex = -1;
      tap.setAttribute('aria-label', '收下这段续写');
      tap.hidden = true;
      document.body.append(tap);

      const pill = document.createElement('button');
      pill.setAttribute('data-ghost-pill', '');
      pill.type = 'button';
      pill.tabIndex = -1;
      pill.setAttribute('aria-label', '收下续写，长按丢弃');
      pill.hidden = true;
      pill.innerHTML = '<span aria-hidden="true" style="font-size:13px;line-height:1">⇥</span><span>补全</span>';
      document.body.append(pill);

      const measureEl = document.createElement('span');
      measureEl.setAttribute('data-ghost-measure', '');
      document.body.append(measureEl);

      /** Width of `text` when rendered with the paragraph's own font. */
      const measure = (paragraph, text) => {
        if (!text) return 0;
        const computed = window.getComputedStyle(paragraph);
        measureEl.style.fontFamily = computed.fontFamily;
        measureEl.style.fontSize = computed.fontSize;
        measureEl.style.fontWeight = computed.fontWeight;
        measureEl.style.letterSpacing = computed.letterSpacing;
        measureEl.textContent = text;
        return measureEl.getBoundingClientRect().width;
      };

      /** The caret's viewport rectangle, or null when there is no live caret. */
      const caretRect = () => {
        const selection = document.getSelection();
        if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(false);
        const rect = range.getBoundingClientRect();
        if (!rect || (!rect.width && !rect.height)) return null;
        return rect;
      };

      /** Clip the continuation so it and the key cap stay on the caret's line. */
      const fitToLine = (paragraph, text) => {
        const maxChars = Number.isFinite(config.maxSuffixChars) ? config.maxSuffixChars : DEFAULTS.maxSuffixChars;
        let candidate = text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
        const rect = caretRect();
        if (!rect) return candidate;
        const budget = paragraph.getBoundingClientRect().right - rect.left - BADGE_SPACE;
        if (budget <= 8) return '';
        if (measure(paragraph, candidate) <= budget) return candidate;
        let low = 1;
        let high = candidate.length;
        let best = '';
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const slice = `${candidate.slice(0, middle)}…`;
          if (measure(paragraph, slice) <= budget) {
            best = slice;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        return best;
      };

      const hideTouchTargets = () => {
        tap.hidden = true;
        pill.hidden = true;
        tap.style.width = '0px';
      };

      const positionBadge = () => {
        if (!state.ghost || !state.anchor) {
          badge.hidden = true;
          hideTouchTargets();
          return;
        }
        const paragraph = state.anchor.querySelector('p:last-child');
        const rect = caretRect();
        if (!paragraph || !rect) {
          badge.hidden = true;
          hideTouchTargets();
          return;
        }
        const width = measure(paragraph, state.shown);
        badge.hidden = false;
        badge.style.left = `${Math.round(rect.left + width + 6)}px`;
        badge.style.top = `${Math.round(rect.top + rect.height / 2)}px`;

        // Phones have no Tab key: the faded continuation and its key cap become
        // one tap target, with a floating chip as the fallback when that target
        // is too small to hit comfortably.
        if (!isCoarsePointer()) {
          hideTouchTargets();
          return;
        }
        const badgeWidth = badge.getBoundingClientRect().width || 30;
        const tapWidth = Math.max(44, Math.round(width + badgeWidth + 16));
        tap.hidden = false;
        tap.style.left = `${Math.round(rect.left - 4)}px`;
        tap.style.top = `${Math.round(rect.top - 6)}px`;
        tap.style.width = `${tapWidth}px`;
        tap.style.height = `${Math.round(rect.height + 12)}px`;
        pill.hidden = false;

        const card = state.anchor.closest('[data-composer-card]') || state.anchor;
        const cardRect = card.getBoundingClientRect();
        const pillWidth = pill.getBoundingClientRect().width || 74;
        const right = Math.max(12, Math.min(window.innerWidth - cardRect.right + 8, window.innerWidth - pillWidth - 12));
        pill.style.right = `${Math.round(right)}px`;
        pill.style.top = `${Math.round(Math.max(8, cardRect.top - 44))}px`;
      };

      const composerOf = (node) => {
        const element = node && node.nodeType === 3 ? node.parentElement : node;
        return element && typeof element.closest === 'function' ? element.closest('[data-composer-input]') : null;
      };

      const activeComposer = () => {
        const selection = document.getSelection();
        const fromSelection = composerOf(selection?.anchorNode ?? null);
        if (fromSelection) return fromSelection;
        return composerOf(document.activeElement);
      };

      const caretAtEnd = (composer) => {
        const selection = document.getSelection();
        if (!selection || !selection.isCollapsed || selection.rangeCount === 0) return false;
        const node = selection.anchorNode;
        if (!node || !composer.contains(node)) return false;
        const range = document.createRange();
        range.selectNodeContents(composer);
        try {
          range.setStart(node, selection.anchorOffset);
        } catch {
          return false;
        }
        return range.toString().length === 0;
      };

      const draftText = (composer) => {
        const blocks = composer.querySelectorAll('p');
        if (blocks.length === 0) return composer.textContent ?? '';
        return Array.from(blocks, (block) => block.textContent ?? '').join('\n');
      };

      const clearGhost = () => {
        state.seq += 1;
        state.ghost = '';
        state.shown = '';
        state.anchor = null;
        badge.hidden = true;
        hideTouchTargets();
        for (const paragraph of document.querySelectorAll('[data-composer-input] p[data-ghost-suffix]')) {
          paragraph.removeAttribute('data-ghost-suffix');
        }
      };

      const cancelPending = () => {
        if (state.timer !== null) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        if (state.controller) {
          state.controller.abort();
          state.controller = null;
        }
      };

      const showGhost = (composer, text) => {
        if (!text || !caretAtEnd(composer)) return;
        const last = composer.querySelector('p:last-child');
        if (!last) return;
        const shown = fitToLine(last, text);
        if (!shown) return;
        last.setAttribute('data-ghost-suffix', shown);
        state.ghost = text;
        state.shown = shown;
        state.anchor = composer;
        positionBadge();
      };

      const insertText = (text, target) => {
        const composer = target ?? state.anchor ?? activeComposer();
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, text);
        } catch {
          inserted = false;
        }
        if (inserted && composer && (composer.textContent ?? '').includes(text)) return true;
        const selection = document.getSelection();
        if (!selection || selection.rangeCount === 0) return false;
        const range = selection.getRangeAt(0);
        const node = document.createTextNode(text);
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        composerOf(node.parentElement)?.dispatchEvent(
          new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }),
        );
        return true;
      };

      const acceptGhost = () => {
        if (!state.ghost) return;
        const text = state.ghost;
        const target = state.anchor ?? activeComposer();
        clearGhost();
        insertText(text, target);
        try {
          target?.focus({ preventScroll: true });
        } catch {
          target?.focus?.();
        }
      };

      const currentSessionId = () => {
        const element = document.querySelector('[data-conversation-session]');
        return element ? element.getAttribute('data-conversation-session') || undefined : undefined;
      };

      const request = async () => {
        if (!config.enabled || state.composing) return;
        const composer = activeComposer();
        if (!composer) return;
        if (composer.hasAttribute('data-composer-composing')) return;
        const inlineStyle = composer.getAttribute('style') ?? '';
        if (inlineStyle.includes('--dsh-composer-hint')) return;
        if (!caretAtEnd(composer)) return;
        const draft = draftText(composer);
        const trimmed = draft.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('/') || trimmed.startsWith('@')) return;

        const seq = state.seq;
        cancelPending();
        const controller = new AbortController();
        state.controller = controller;
        try {
          const response = await fetch('/api/ghost-input/complete', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSessionId(), draft }),
            signal: controller.signal,
          });
          if (!response.ok) return;
          const data = await response.json();
          if (seq !== state.seq) return;
          const text = typeof data?.text === 'string' ? data.text : '';
          if (!text) {
            clearGhost();
            return;
          }
          showGhost(composer, text);
        } catch {
          /* aborted or offline: leave the composer untouched */
        } finally {
          if (state.controller === controller) state.controller = null;
        }
      };

      const schedule = () => {
        if (!config.enabled || state.composing) return;
        if (state.timer !== null) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.timer = null;
          void request();
        }, Math.max(200, Number(config.delayMs) || DEFAULTS.delayMs));
      };

      const onKeyDown = (event) => {
        if (event.isComposing) return;
        if (event.key === 'Tab' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && state.ghost
          && composerOf(event.target) === state.anchor) {
          event.preventDefault();
          event.stopPropagation();
          acceptGhost();
          schedule();
          return;
        }
        if (event.key === 'Escape' && state.ghost && composerOf(event.target) === state.anchor) {
          clearGhost();
          cancelPending();
        }
      };

      const onInput = (event) => {
        const composer = composerOf(event.target);
        if (!composer) return;
        clearGhost();
        schedule();
      };

      const onCompositionStart = (event) => {
        if (!composerOf(event.target)) return;
        state.composing = true;
        clearGhost();
        cancelPending();
      };

      const onCompositionEnd = (event) => {
        if (!composerOf(event.target)) return;
        state.composing = false;
        schedule();
      };

      let selectionTimer = null;
      const onSelectionChange = () => {
        if (!state.ghost) return;
        if (selectionTimer !== null) clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => {
          selectionTimer = null;
          if (!state.ghost) return;
          const composer = state.anchor ?? activeComposer();
          if (!composer || !caretAtEnd(composer)) clearGhost();
          else positionBadge();
        }, 140);
      };

      const onFocusOut = (event) => {
        const composer = composerOf(event.target);
        if (!composer) return;
        const next = event.relatedTarget;
        if (next && (composer.contains(next) || next === tap || next === pill)) return;
        clearGhost();
        cancelPending();
      };

      const onViewport = () => positionBadge();
      const onConfigEvent = (event) => adoptConfig(event?.detail);

      // Touch: tap the faded continuation (or its key cap) to accept it; the
      // floating chip accepts on tap and discards on a long press.
      let pillTimer = null;
      const stopPillTimer = () => {
        if (pillTimer !== null) {
          clearTimeout(pillTimer);
          pillTimer = null;
        }
      };

      const onTapPointerDown = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      const onTapPointerUp = (event) => {
        event.preventDefault();
        event.stopPropagation();
        acceptGhost();
        schedule();
      };

      const onPillPointerDown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        stopPillTimer();
        pillTimer = setTimeout(() => {
          pillTimer = null;
          clearGhost();
          cancelPending();
        }, 480);
      };

      const onPillPointerUp = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (pillTimer !== null) {
          stopPillTimer();
          acceptGhost();
          schedule();
        }
      };

      const onPillPointerCancel = () => stopPillTimer();

      tap.addEventListener('pointerdown', onTapPointerDown);
      tap.addEventListener('pointerup', onTapPointerUp);
      pill.addEventListener('pointerdown', onPillPointerDown);
      pill.addEventListener('pointerup', onPillPointerUp);
      pill.addEventListener('pointercancel', onPillPointerCancel);

      window.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('input', onInput, true);
      document.addEventListener('compositionstart', onCompositionStart, true);
      document.addEventListener('compositionend', onCompositionEnd, true);
      document.addEventListener('selectionchange', onSelectionChange);
      document.addEventListener('focusout', onFocusOut, true);
      window.addEventListener('resize', onViewport);
      window.addEventListener('scroll', onViewport, true);
      window.addEventListener('dsh-ghost-input:config', onConfigEvent);

      const dispose = () => {
        window.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('input', onInput, true);
        document.removeEventListener('compositionstart', onCompositionStart, true);
        document.removeEventListener('compositionend', onCompositionEnd, true);
        document.removeEventListener('selectionchange', onSelectionChange);
        document.removeEventListener('focusout', onFocusOut, true);
        window.removeEventListener('resize', onViewport);
        window.removeEventListener('scroll', onViewport, true);
        window.removeEventListener('dsh-ghost-input:config', onConfigEvent);
        if (selectionTimer !== null) clearTimeout(selectionTimer);
        stopPillTimer();
        tap.removeEventListener('pointerdown', onTapPointerDown);
        tap.removeEventListener('pointerup', onTapPointerUp);
        pill.removeEventListener('pointerdown', onPillPointerDown);
        pill.removeEventListener('pointerup', onPillPointerUp);
        pill.removeEventListener('pointercancel', onPillPointerCancel);
        cancelPending();
        clearGhost();
        tap.remove();
        pill.remove();
        badge.remove();
        measureEl.remove();
        style.remove();
      };

      if (typeof ctx?.effect === 'function') ctx.effect(() => dispose);
      else window.addEventListener('pagehide', dispose, { once: true });
      } catch {
        /* a host detail changed: leave the composer untouched instead of breaking the page */
      }
    }

    return { apply, inject: ['slots'] };
  },
});
