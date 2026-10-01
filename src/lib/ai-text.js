/**
 * The text of a Workers AI text-generation result, whatever the model.
 *
 * Models answer in different shapes: { response } (Llama, Mistral, Gemma),
 * OpenAI chat { choices: [{ message: { content } }] }, or the Responses API
 * { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
 * (gpt-oss). Reasoning a model emits alongside its answer is never returned:
 * only the answer reaches the visitor.
 */
export function aiText(res) {
  if (!res || typeof res !== 'object') return '';
  if (typeof res.response === 'string') return res.response;
  const choice = res.choices?.[0]?.message?.content;
  if (typeof choice === 'string') return choice;
  if (typeof res.output_text === 'string') return res.output_text;
  if (Array.isArray(res.output)) {
    return res.output
      .filter((item) => item?.type === 'message')
      .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
      .filter((c) => c?.type === 'output_text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
  }
  return '';
}
