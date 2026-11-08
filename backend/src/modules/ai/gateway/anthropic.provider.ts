/**
 * Claude through the Anthropic API (official SDK).
 *
 *   - Thinking is left at the model default (adaptive) and effort is "low": short
 *     answers to self-service questions, where speed matters more than depth.
 *   - The system prompt and tools never change between calls, so they are cached
 *     (cache_control) and each question pays mostly for itself.
 *   - Tools are strict: the model's tool input always matches the schema.
 *   - On a refusal the API may hand the request to a fallback model in the same
 *     call ("fallbacks: default"); a refusal that remains is reported as refused.
 *   - The reply's content blocks (thinking, tool calls) go back unchanged on the
 *     next call of the same question, as the API requires.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AiCallRequest, AiCallResult, AiProvider } from './provider.js';

/** Models that accept server-side refusal fallbacks ("fallbacks: default"). */
const FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    apiKey?: string,
  ) {
    // without a key the SDK uses ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile
    this.client = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async call(request: AiCallRequest): Promise<AiCallResult> {
    const fallback = FALLBACK_MODELS.has(this.model);
    const response = await this.client.beta.messages.create(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        system: [
          {
            type: 'text',
            text: request.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: toMessages(request),
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
          strict: true,
        })),
        output_config: { effort: 'low' },
        ...(fallback
          ? {
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default' as const,
            }
          : {}),
      },
      // the gateway owns the time limit; one quick retry for a dropped connection or 429/5xx
      { signal: request.signal, maxRetries: 1 },
    );

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const toolCalls = response.content
      .filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      )
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    const stop =
      response.stop_reason === 'refusal'
        ? 'refused'
        : response.stop_reason === 'tool_use' && toolCalls.length
          ? 'tool_calls'
          : response.stop_reason === 'max_tokens'
            ? 'truncated'
            : 'answer';

    return {
      stop,
      text,
      toolCalls,
      raw: response.content,
      model: response.model,
      usage: {
        inputTokens:
          response.usage.input_tokens +
          (response.usage.cache_read_input_tokens ?? 0) +
          (response.usage.cache_creation_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

function toMessages(request: AiCallRequest): Anthropic.Beta.BetaMessageParam[] {
  return request.messages.map((m): Anthropic.Beta.BetaMessageParam => {
    switch (m.role) {
      case 'user':
        if (!m.files?.length) return { role: 'user', content: m.text };
        return {
          role: 'user',
          content: [
            ...m.files.map((f): Anthropic.Beta.BetaContentBlockParam =>
              f.mediaType === 'application/pdf'
                ? {
                    type: 'document',
                    source: {
                      type: 'base64',
                      media_type: 'application/pdf',
                      data: f.data.toString('base64'),
                    },
                  }
                : {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: f.mediaType as
                        'image/png' | 'image/jpeg' | 'image/webp',
                      data: f.data.toString('base64'),
                    },
                  },
            ),
            { type: 'text', text: m.text },
          ],
        };
      case 'assistant':
        return {
          role: 'assistant',
          content:
            (m.raw as Anthropic.Beta.BetaContentBlockParam[] | undefined) ??
            m.text,
        };
      case 'tool_results':
        return {
          role: 'user',
          content: m.results.map((r) => ({
            type: 'tool_result' as const,
            tool_use_id: r.callId,
            content: r.content,
            is_error: r.isError ?? false,
          })),
        };
    }
  });
}
