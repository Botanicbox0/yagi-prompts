import {
  defaultTimelineKeyframes,
  parseVideoKeyframes,
  type VideoKeyframe,
} from '@/lib/prompts/keyframes';
import { GEMINI_DIRECTOR_DEFAULT_MODEL } from './schema';
import { GEMINI_DIRECTOR_THINKING_LEVEL } from './morphic-production-playbook';
import { directorConfigFromEnv } from './flash-director';

export interface RecommendVideoKeyframesInput {
  durationSeconds: number;
  title?: string;
  promptSummary?: string;
  count?: number;
}

export interface RecommendVideoKeyframesResult {
  model: string;
  keyframes: VideoKeyframe[];
}

export async function recommendVideoKeyframes(
  input: RecommendVideoKeyframesInput,
  deps: { env?: Record<string, string | undefined>; fetch?: typeof fetch } = {},
): Promise<RecommendVideoKeyframesResult> {
  const duration = Math.max(2, Math.min(120, Number(input.durationSeconds) || 10));
  const count = Math.max(3, Math.min(5, Math.round(input.count ?? 4)));
  const config = directorConfigFromEnv(deps.env ?? process.env);

  if (config) {
    const fetchImpl = deps.fetch ?? fetch;
    try {
      const url = `${config.baseUrl}/models/${config.model}:generateContent`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: `You are TWINGS Video Beat Director (${GEMINI_DIRECTOR_DEFAULT_MODEL}). Select exactly ${count} keyframe timestamps (0.0 to ${duration.toFixed(1)} seconds) that summarize a video template in 3 seconds: Opening, Transition, Highlight, Finale. Return strict JSON array of objects with keys index (0..${count - 1}), timeSeconds (number clamped 0..${duration}), labelKo (max 10 Korean chars), labelEn (max 16 chars).`,
              },
            ],
          },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: JSON.stringify({
                    durationSeconds: duration,
                    count,
                    title: input.title ?? '',
                    promptSummary: (input.promptSummary ?? '').slice(0, 400),
                  }),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: GEMINI_DIRECTOR_THINKING_LEVEL },
          },
        }),
      });
      if (response.ok) {
        const json = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        const parsedJson = JSON.parse(rawText) as unknown;
        const clamped = Array.isArray(parsedJson)
          ? parsedJson.slice(0, count).map((entry, idx) => {
              const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
              const rawTime = Number(row.timeSeconds ?? 0);
              const timeSeconds = Math.round(Math.min(duration, Math.max(0, Number.isFinite(rawTime) ? rawTime : 0)) * 10) / 10;
              return {
                index: idx,
                timeSeconds,
                labelKo: typeof row.labelKo === 'string' ? row.labelKo.trim().slice(0, 40) : undefined,
                labelEn: typeof row.labelEn === 'string' ? row.labelEn.trim().slice(0, 40) : undefined,
              };
            })
          : null;
        const validated = parseVideoKeyframes(clamped);
        if (validated && validated.length >= 3) {
          return { model: config.model, keyframes: validated };
        }
      }
    } catch {
      // Offline / API error gracefully falls back to deterministic timeline beats.
    }
  }

  return {
    model: 'heuristic',
    keyframes: defaultTimelineKeyframes(duration, count),
  };
}
