/**
 * The one door to an AI model (spec §8: "the model provider is hidden behind one
 * internal AI gateway"). Business code builds prompts and tools in these neutral
 * shapes; a provider translates them to its own API. Switching or mixing models
 * changes only the provider, never the assistant or the explanations.
 */

/** A tool the model may ask to run. inputSchema is JSON Schema (all fields required, no extras). */
export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type AiMessage =
  /** files: photos or PDFs the model reads (the document reader, WP22); never masked, see DocumentReaderService */
  | {
      role: 'user';
      text: string;
      files?: Array<{ mediaType: string; data: Buffer }>;
    }
  /** raw: the provider's own reply, replayed unchanged on the next call (tool use, thinking). */
  | { role: 'assistant'; text: string; raw?: unknown }
  | {
      role: 'tool_results';
      results: Array<{ callId: string; content: string; isError?: boolean }>;
    };

export interface AiCallRequest {
  system: string;
  messages: AiMessage[];
  tools: AiToolSpec[];
  maxTokens: number;
  language: 'bn' | 'en';
  /** Aborted when the gateway's time limit is reached. */
  signal: AbortSignal;
}

export interface AiCallResult {
  /** answer: final text · tool_calls: run them and call again · refused: the model declined · truncated: hit the length limit */
  stop: 'answer' | 'tool_calls' | 'refused' | 'truncated';
  text: string;
  toolCalls: AiToolCall[];
  raw: unknown;
  /** The model that actually answered (may differ from the configured one after a fallback). */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  call(request: AiCallRequest): Promise<AiCallResult>;
}

/** Nest injection token for the configured provider (null when AI_PROVIDER=off). */
export const AI_PROVIDER = Symbol('AI_PROVIDER');
