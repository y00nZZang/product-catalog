/** The only intentionally loose field is the provider's heterogeneous tool-output array.
 * Workflow-specific model data stays unknown until its Zod schema validates it.
 * This is also the persisted cache payload: do not include headers or credentials here.
 */
export interface ModelResponse {
  status?: string | null;
  output?: any[];
  output_text: string;
  output_parsed?: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    };
  } | null;
}
