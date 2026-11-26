import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  extractGeminiResponseInfo,
  geminiToOllamaRequest,
  ollamaToGeminiResponse,
  validateLocalOllamaUrl,
  validateSiteSchema,
  type GeminiRequestBody,
} from '@/scripts/prompt-guard-redteam/adapter';
import { loadInputs } from '@/scripts/prompt-guard-redteam/inputs';
import { parseCliArgs, runRedteam } from '@/scripts/prompt-guard-redteam/runner';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('local Ollama adapter', () => {
  it('converts a Gemini generateContent request (text + schema + inline image) to Ollama /api/chat', () => {
    const req: GeminiRequestBody = {
      systemInstruction: { parts: [{ text: 'System rule A.' }, { text: 'System rule B.' }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'User block 1' },
            { inlineData: { mimeType: 'image/png', data: 'AQIDBA==' } },
            { text: 'User block 2' },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: {
          type: 'object',
          properties: { prompt: { type: 'string' }, notes: { type: 'string' } },
          required: ['prompt', 'notes'],
        },
      },
    };

    const ollama = geminiToOllamaRequest(req, { model: 'yagi-crm-gemma4:31b-q8_0', numPredict: 1024 });
    expect(ollama.model).toBe('yagi-crm-gemma4:31b-q8_0');
    expect(ollama.stream).toBe(false);
    expect(ollama.think).toBe(false);
    expect(ollama.format).toEqual(req.generationConfig!.responseJsonSchema);
    expect(ollama.options.num_predict).toBe(1024);
    expect(ollama.messages).toHaveLength(2);
    expect(ollama.messages[0]).toEqual({ role: 'system', content: 'System rule A.\nSystem rule B.' });
    expect(ollama.messages[1]).toEqual({
      role: 'user',
      content: 'User block 1\n\nUser block 2',
      images: ['AQIDBA=='],
    });
  });

  it('converts valid and schema-invalid Ollama responses back into Gemini responses with usage and rawChars', () => {
    const valid = ollamaToGeminiResponse({
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 320,
      eval_count: 64,
      message: {
        role: 'assistant',
        content: JSON.stringify({ prompt: 'A sunlit bottle on pale limestone.', notes: 'Refined the lighting.' }),
      },
    });
    expect(valid.schemaValid).toBe(true);
    expect(valid.finishReason).toBe('STOP');
    expect(valid.usage).toEqual({ inputTokens: 320, outputTokens: 64, totalTokens: 384 });
    expect(valid.rawChars).toBeGreaterThan(20);
    expect(extractGeminiResponseInfo(valid.geminiBody).schemaValid).toBe(true);

    const proseInvalid = ollamaToGeminiResponse({
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 150,
      eval_count: 18,
      message: { role: 'assistant', content: 'Sorry, I cannot output JSON right now.' },
    });
    expect(proseInvalid.schemaValid).toBe(false);
    expect(proseInvalid.rawChars).toBe('Sorry, I cannot output JSON right now.'.length);
    expect(proseInvalid.usage).toEqual({ inputTokens: 150, outputTokens: 18, totalTokens: 168 });

    const wrongShape = validateSiteSchema(JSON.stringify({ prompt: 'missing notes field' }));
    expect(wrongShape.valid).toBe(false);
    expect(wrongShape.rawChars).toBeGreaterThan(10);

    const truncated = ollamaToGeminiResponse({
      done: true,
      done_reason: 'length',
      prompt_eval_count: 200,
      eval_count: 2048,
      message: { role: 'assistant', content: '{"prompt":"cut off' },
    });
    expect(truncated.finishReason).toBe('MAX_TOKENS');
    expect(truncated.schemaValid).toBe(false);
  });

  it('rejects direct port 11444 and non-loopback local Ollama URLs', () => {
    expect(validateLocalOllamaUrl(undefined).href).toBe('http://127.0.0.1:11434/');
    expect(validateLocalOllamaUrl('http://localhost:11434').href).toBe('http://localhost:11434/');
    expect(() => validateLocalOllamaUrl('http://127.0.0.1:11444')).toThrow();
    expect(() => validateLocalOllamaUrl('http://example.com:11434')).toThrow();
    expect(() => validateLocalOllamaUrl('https://127.0.0.1:11434')).toThrow();
  });

  it('counts a schema-invalid local model answer as unusableAnswers (not a leak or false positive) while keeping rawChars', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'pg-adapter-'));
    tempDirs.push(outDir);

    const rawText = 'Here is plain prose without JSON schema compliance.';
    const fakeLocalFetch = (async () => {
      return new Response(
        JSON.stringify({
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 100,
          eval_count: 12,
          message: { role: 'assistant', content: rawText },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const benignItem = loadInputs(['benign'], 1)[0]!;
    const options = parseCliArgs(
      [
        '--backend=local',
        '--sites=brand-studio.enhancer',
        '--modes=enforce',
        '--classes=benign',
        `--out=${outDir}`,
        '--delay-ms=0',
      ],
      process.cwd(),
    );

    const res = await runRedteam(options, {
      repoRoot: process.cwd(),
      baseFetch: fakeLocalFetch,
      inputs: [benignItem],
      registerSignalHandlers: false,
      onLog: () => {},
    });
    expect(res.dryRun).toBe(false);
    if (res.dryRun) return;

    const cell = res.report.cells[0]!;
    expect(cell.calls).toBe(1);
    expect(cell.unusableAnswers).toBe(1);
    expect(cell.leaks).toBe(0);
    expect(cell.falsePositives).toBe(0);
    expect(res.report.trials[0]!.status).toBe('unusable');
    expect(res.report.trials[0]!.rawChars).toBe(rawText.length);
    expect(res.report.trials[0]!.schemaValid).toBe(false);
    expect(readFileSync(res.reportPaths.jsonPath, 'utf8')).toContain(`"unusableAnswers": 1`);
  });
});
