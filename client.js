/**
 * Client half of dsh-ghost-input.
 *
 * The composer is a Lexical contenteditable; its own tail hint is rendered by
 * `p:last-child::after`. This module keeps a grey continuation in that same
 * slot (through a data attribute of its own, so the host's command hint is
 * never touched), listens for Tab, and asks the host for a completion once the
 * user pauses.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ghost-input',
  factory: () => {
    const STYLE_ID = 'dsh-ghost-input-style';
    const CSS = [
      '[data-composer-input] p[data-ghost-suffix]::after{',
      'content:attr(data-ghost-suffix) !important;',
      'color:var(--dsw-alias-label-caption,#9aa4b2) !important;',
      'pointer-events:none;',
      'white-space:pre-wrap;',
      '}',
    ].join('');

    const DEFAULTS = { delayMs: 600, maxSuffixChars: 80 };

    function apply(ctx) {
      if (typeof document === 'undefined' || typeof window === 'undefined') return;

      const options = { ...DEFAULTS, ...(ctx?.config && typeof ctx.config === 'object' ? ctx.config : {}) };
      const delay = Number.isFinite(options.delayMs) ? Math.max(120, options.delayMs) : DEFAULTS.delayMs;

      const state = {
        ghost: '',
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
        state.anchor = null;
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
        last.setAttribute('data-ghost-suffix', text);
        state.ghost = text;
        state.anchor = composer;
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
        if (!composer || composer.hasAttribute('data-composer-composing')) return;
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

      window.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('input', onInput, true);
      document.addEventListener('compositionstart', onCompositionStart, true);
      document.addEventListener('compositionend', onCompositionEnd, true);
      document.addEventListener('selectionchange', onSelectionChange);
      document.addEventListener('focusout', onFocusOut, true);

      const dispose = () => {
        window.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('input', onInput, true);
        document.removeEventListener('compositionstart', onCompositionStart, true);
        document.removeEventListener('compositionend', onCompositionEnd, true);
        document.removeEventListener('selectionchange', onSelectionChange);
        document.removeEventListener('focusout', onFocusOut, true);
        if (selectionTimer !== null) clearTimeout(selectionTimer);
        cancelPending();
        clearGhost();
        style.remove();
      };

      if (typeof ctx?.effect === 'function') ctx.effect(() => dispose);
      else window.addEventListener('pagehide', dispose, { once: true });
    }

    return { apply };
  },
});
