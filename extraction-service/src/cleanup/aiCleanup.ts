import { logger } from '../logger';

// ── Provider-agnostic AI cleanup adapter ─────────────────────────

interface AICleanupAdapter {
  readonly name: string;
  readonly available: boolean;
  cleanupRouteText(rawText: string): Promise<string>;
}

// ── No-op adapter (default when no AI provider configured) ────────

const noopAdapter: AICleanupAdapter = {
  name: 'noop',
  available: true,
  async cleanupRouteText(text) {
    return text;
  },
};

// ── OpenAI adapter ────────────────────────────────────────────────

function buildOpenAIAdapter(apiKey: string, model: string): AICleanupAdapter {
  return {
    name: 'openai',
    available: true,

    async cleanupRouteText(rawText: string): Promise<string> {
      const prompt = [
        'You are cleaning up route sheet text extracted from a PDF or Word document.',
        'The text may have broken lines, OCR artifacts, or garbled characters.',
        '',
        'Rules:',
        '- Reconstruct broken address lines (e.g., "123 Main\\nSt" → "123 Main St")',
        '- Remove OCR garbage (random symbols, garbled words that are clearly not addresses)',
        '- Normalize apartment/unit formatting (Apt, #, Unit, Suite → consistent)',
        '- Preserve one address per line',
        '- Keep sequence numbers if present (1., 2., etc.)',
        '- Do NOT add, remove, or reorder addresses',
        '- Do NOT add commentary, headings, or explanations',
        '- Return ONLY the cleaned address list, nothing else',
        '',
        'Text to clean:',
        '---',
        rawText,
        '---',
      ].join('\n');

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 4096,
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`OpenAI API error ${response.status}: ${body.slice(0, 200)}`);
      }

      type OpenAIResponse = {
        choices: Array<{ message: { content: string | null } }>;
      };
      const data = (await response.json()) as OpenAIResponse;
      const cleaned = data.choices[0]?.message?.content?.trim() ?? '';

      if (!cleaned) throw new Error('OpenAI returned empty content');
      return cleaned;
    },
  };
}

// ── Factory ───────────────────────────────────────────────────────

function buildAdapter(): AICleanupAdapter {
  const provider = (process.env['AI_CLEANUP_PROVIDER'] ?? '').toLowerCase();

  if (provider === 'openai') {
    const apiKey = process.env['OPENAI_API_KEY'] ?? '';
    const model  = process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini';
    if (!apiKey) {
      logger.warn('AI_CLEANUP', 'AI_CLEANUP_PROVIDER=openai but OPENAI_API_KEY not set — falling back to noop');
      return noopAdapter;
    }
    logger.info('AI_CLEANUP', `AI cleanup enabled: openai / ${model}`);
    return buildOpenAIAdapter(apiKey, model);
  }

  return noopAdapter;
}

const adapter = buildAdapter();

// ── Public interface ──────────────────────────────────────────────

export async function cleanupExtractedRouteText(text: string): Promise<{ text: string; aiCleanupApplied: boolean }> {
  if (adapter.name === 'noop') {
    return { text, aiCleanupApplied: false };
  }

  try {
    const cleaned = await adapter.cleanupRouteText(text);
    logger.info('AI_CLEANUP', `Cleanup complete via ${adapter.name}`);
    return { text: cleaned, aiCleanupApplied: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn('AI_CLEANUP', `Cleanup failed — using raw text: ${msg}`);
    return { text, aiCleanupApplied: false };
  }
}

export function aiCleanupProviderName(): string {
  return adapter.name;
}
