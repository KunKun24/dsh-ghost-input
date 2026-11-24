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
  factory: () => {
    const STYLE_ID = 'dsh-ghost-input-style';
    /** Room kept after the caret for the Tab key cap before the text is clipped. */
    const BADGE_SPACE = 46;
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
    ].join('');

    const DEFAULTS = { delayMs: 600, maxSuffixChars: 80, hintKey: 'Tab' };

    function apply(ctx) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return;
      try {

      let overrides = {};
      try {
        const config = ctx?.config;
        if (config !== null && typeof config === 'object') overrides = config;
      } catch {
        /* config is only readable when injected; defaults are fine */
      }
      const options = { ...DEFAULTS, ...overrides };
      const delay = Number.isFinite(options.delayMs) ? Math.max(120, options.delayMs) : DEFAULTS.delayMs;

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
      badge.textContent = typeof options.hintKey === 'string' && options.hintKey ? options.hintKey : 'Tab';
      badge.hidden = true;
      document.body.append(badge);

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
        const maxChars = Number.isFinite(options.maxSuffixChars) ? options.maxSuffixChars : DEFAULTS.maxSuffixChars;
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

      const positionBadge = () => {
        if (!state.ghost || !state.anchor) {
          badge.hidden = true;
          return;
        }
        const paragraph = state.anchor.querySelector('p:last-child');
        const rect = caretRect();
        if (!paragraph || !rect) {
          badge.hidden = true;
          return;
        }
        const width = measure(paragraph, state.shown);
        badge.hidden = false;
        badge.style.left = `${Math.round(rect.left + width + 6)}px`;
        badge.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
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

      const insertText = (text) => {
        const composer = state.anchor ?? activeComposer();
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
        clearGhost();
        insertText(text);
      };

      const currentSessionId = () => {
        const element = document.querySelector('[data-conversation-session]');
        return element ? element.getAttribute('data-conversation-session') || undefined : undefined;
      };

      const request = async () => {
        if (!state.enabled || state.composing) return;
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
        if (!state.enabled || state.composing) return;
        if (state.timer !== null) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.timer = null;
          void request();
        }, delay);
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
        if (next && composer.contains(next)) return;
        clearGhost();
        cancelPending();
      };

      const onViewport = () => positionBadge();

      window.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('input', onInput, true);
      document.addEventListener('compositionstart', onCompositionStart, true);
      document.addEventListener('compositionend', onCompositionEnd, true);
      document.addEventListener('selectionchange', onSelectionChange);
      document.addEventListener('focusout', onFocusOut, true);
      window.addEventListener('resize', onViewport);
      window.addEventListener('scroll', onViewport, true);

      const dispose = () => {
        window.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('input', onInput, true);
        document.removeEventListener('compositionstart', onCompositionStart, true);
        document.removeEventListener('compositionend', onCompositionEnd, true);
        document.removeEventListener('selectionchange', onSelectionChange);
        document.removeEventListener('focusout', onFocusOut, true);
        window.removeEventListener('resize', onViewport);
        window.removeEventListener('scroll', onViewport, true);
        if (selectionTimer !== null) clearTimeout(selectionTimer);
        cancelPending();
        clearGhost();
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

    return { apply };
  },
});
