/**
 * Host half of dsh-ghost-input.
 *
 * Serves one route, `POST /api/ghost-input/complete`, which turns the current
 * composer draft into a short inline continuation through the session's own
 * model. The browser half owns the caret, the grey rendering and the Tab key.
 */
export const name = 'ghost-input';

export const inject = ['connection', 'llm'];

const DEFAULTS = {
  enabled: true,
  maxTokens: 96,
  temperature: 0.3,
  timeoutMs: 4500,
  maxSuffixChars: 80,
  maxDraftChars: 2000,
  contextMaxChars: 2000,
  cacheTtlMs: 45_000,
  cacheSize: 200,
};

const SYSTEM_PROMPT = [
  'You are the inline continuation engine of a chat composer.',
  'You receive the recent conversation and the exact draft the user is typing right now. Reply with only the text that naturally comes immediately after the draft.',
  'Rules:',
  '- Stay on the topic, tone and details of the conversation: reuse its nouns, names, numbers and decisions instead of inventing new ones.',
  '- Continue the user\'s own sentence or thought. Never answer it, explain it, translate it, or comment on it.',
  '- Never repeat the draft or anything already said in the conversation.',
  '- No quotes, no markdown, no labels, no leading or trailing space, no line breaks.',
  '- Keep it to one short clause, ideally under 30 characters.',
  '- Match the draft\'s language, script and level of formality.',
  '- If the draft already reads as a complete sentence, add the next clause only when it is genuinely predictable.',
  '- If you cannot predict a useful, specific continuation, reply with nothing at all.',
].join('\n');

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function service(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : ctx[name];
  } catch {
    return undefined;
  }
}

/** The session's live model selection, else the deployment default. */
function currentSelection(ctx, sessionId) {
  try {
    const agent = sessionId ? service(ctx, 'agents')?.get?.(sessionId) : undefined;
    const selection = agent?.model?.current?.();
    if (selection && selection.provider && selection.model) return selection;
  } catch {}
  try {
    const selection = service(ctx, 'agentDefaultModel')?.currentSelection?.();
    if (selection && selection.provider && selection.model) return selection;
  } catch {}
  return undefined;
}

function textOfEvent(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.type !== 'user/message' && event.type !== 'assistant/message') return '';
  const role = event.type === 'user/message' ? 'user' : 'assistant';
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  const content = Array.isArray(data.content)
    ? data.content
    : Array.isArray(data.message?.content)
      ? data.message.content
      : [];
  const text = content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);
  return text ? { role, text } : undefined;
}

/** A short tail of the conversation, newest last. */
function recentContext(ctx, sessionId, limit) {
  if (!sessionId) return '';
  const session = service(ctx, 'sessions')?.get?.(sessionId);
  const events = session?.events;
  if (!Array.isArray(events)) return '';
  const parts = [];
  for (let index = events.length - 1; index >= 0 && parts.length < 10; index -= 1) {
    const entry = textOfEvent(events[index]);
    if (entry) parts.unshift(`${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.text}`);
  }
  const joined = parts.join('\n');
  return joined.length > limit ? joined.slice(-limit) : joined;
}

/** The workspace folder name, when the session carries one. */
function workspaceOf(ctx, sessionId) {
  if (!sessionId) return '';
  try {
    const cwd = service(ctx, 'sessions')?.get?.(sessionId)?.header?.cwd;
    if (typeof cwd === 'string' && cwd) {
      const parts = cwd.split(/[\\/]+/u).filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : '';
    }
  } catch {}
  return '';
}

/** Strip the model's packaging so only the continuation survives. */
function sanitize(raw, draft, maxChars) {
  let text = typeof raw === 'string' ? raw : '';
  if (!text) return '';
  text = text.replace(/\r\n?/gu, '\n');
  const newline = text.indexOf('\n');
  if (newline !== -1) text = text.slice(0, newline);
  text = text.trim();
  text = text.replace(/^["'“”‘’`]+/u, '').replace(/["'“”‘’`]+$/u, '');
  text = text.trim();
  if (!text) return '';
  const trimmedDraft = draft.trim();
  if (trimmedDraft && text.startsWith(trimmedDraft)) text = text.slice(trimmedDraft.length).trim();
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return text.trim();
}

export function apply(ctx, config = {}) {
  const settings = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) };
  /** key -> { text, expires } ; text '' is a negative cache entry. */
  const cache = new Map();
  /** sessionId -> AbortController of the single in-flight request. */
  const inflight = new Map();
  /** provider/model -> least reasoning effort id (undefined when unknown). */
  const effortCache = new Map();

  function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      cache.delete(key);
      return undefined;
    }
    return entry.text;
  }

  function cacheSet(key, text) {
    if (cache.size >= settings.cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { text, expires: Date.now() + settings.cacheTtlMs });
  }

  /** Least reasoning effort the route supports, so a completion is not spent on thinking. */
async function leastEffort(ctx, selection, effortsCache) {
  const key = `${selection.provider}/${selection.model}`;
  if (effortsCache.has(key)) return effortsCache.get(key);
  let effort;
  try {
    const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model);
    const efforts = info?.reasoning?.efforts;
    if (Array.isArray(efforts) && efforts.length > 0) {
      const preferred = ['none', 'off', 'minimal', 'low'];
      const match = efforts.find((entry) => preferred.includes(String(entry?.id ?? '').toLowerCase()));
      const id = match?.id ?? efforts[0]?.id;
      if (id !== undefined) effort = id;
    }
  } catch {}
  effortsCache.set(key, effort);
  return effort;
}

async function complete(ctx2, body) {
    const draft = typeof body?.draft === 'string' ? body.draft : '';
    if (!draft.trim()) return { ok: true, text: '', reason: 'empty' };
    if (draft.length > settings.maxDraftChars) return { ok: true, text: '', reason: 'too-long' };

    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : undefined;
    const selection = currentSelection(ctx2, sessionId);
    if (!selection) return { ok: true, text: '', reason: 'no-model' };

    const key = `${selection.provider}/${selection.model}\u0000${draft}`;
    const cached = cacheGet(key);
    if (cached !== undefined) return { ok: true, text: cached, reason: 'cache' };

    const previous = sessionId ? inflight.get(sessionId) : undefined;
    if (previous) previous.abort();
    const controller = new AbortController();
    if (sessionId) inflight.set(sessionId, controller);

    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    const contextText = recentContext(ctx2, sessionId, settings.contextMaxChars);
    const workspace = workspaceOf(ctx2, sessionId);
    const userText = [
      workspace ? `<workspace>\n${workspace}\n</workspace>` : '',
      contextText ? `<context>\n${contextText}\n</context>` : '',
      `<draft>\n${draft.slice(-settings.maxDraftChars)}\n</draft>`,
      'Reply with the continuation text only, immediately following the draft.',
    ]
      .filter(Boolean)
      .join('\n\n');

    const effort = await leastEffort(ctx2, selection, effortCache);

    let out = '';
    let blockText = '';
    let failure;
    let finishReason;
    try {
      const stream = ctx2.llm.stream({
        provider: selection.provider,
        model: selection.model,
        ...(effort !== undefined ? { reasoningEffort: effort } : {}),
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        stop: ['\n'],
        signal: controller.signal,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text;
        if (chunk.type === 'block-end' && chunk.block?.type === 'text' && typeof chunk.block.text === 'string') {
          blockText += chunk.block.text;
        }
        if (chunk.type === 'finish') {
          finishReason = chunk.reason?.kind ?? chunk.reason;
          if (chunk.failure) failure = chunk.failure;
        }
      }
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
      if (sessionId && inflight.get(sessionId) === controller) inflight.delete(sessionId);
    }

    if (failure) {
      const code = failure?.code ?? String(failure?.message ?? failure);
      return { ok: true, text: '', reason: `model-error:${code}` };
    }

    if (!out && blockText) out = blockText;
    const text = sanitize(out, draft, settings.maxSuffixChars);
    cacheSet(key, text);
    return { ok: true, text, ...(text ? {} : { reason: `empty:${finishReason ?? 'unknown'}` }) };
  }

  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/ghost-input/complete',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        if (!settings.enabled) return json({ ok: true, text: '', reason: 'disabled' });
        let body = {};
        try {
          body = await request.json();
        } catch {}
        try {
          return json(await complete(ctx, body));
        } catch (error) {
          return json({ ok: false, error: String(error?.message ?? error) }, 500);
        }
      },
    }),
  );
}
