# Sound studio design — local music workspace facts (read-only audit, 2026-11-20)

Nothing was generated, no service touched. Source: `D:\dev\music-creator` (config, skills, logs of 10 finished jobs), the staff production bridge repo, `GET /gpu/status`.

## Licence (local files, verbatim)
- Weights — `engines/YuE-official/MODEL_LICENSE`: "The YuE2-3B, YuE2-Vae and YuE2-Vae-legacy checkpoint weights are licensed under Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)".
- Same file: "The individual creator permission does not authorize commercial use of the model weights by companies. Companies wishing to use the model weights commercially should contact [an HKUST address] to discuss a commercial license".
- Same file, individuals only: "grant personal users, content creators and musicians acting in an individual capacity permission … to publish, distribute, sell, license or otherwise monetize those outputs".
- Code, skill, docs: Apache 2.0 (README:283). README:277: "Commercial use by companies | Contact us to discuss a commercial license for the model weights." The README (line 369) gives a different contact address from MODEL_LICENSE.
- SheetSage2 / MERT2 weights (melody transcription of a reference song): CC BY-NC 4.0.
- VAE code: MIT notices (Stability AI Oobleck, NVIDIA BigVGAN). Demucs code MIT; `htdemucs_ft` weights licence not confirmed. Applio (RVC) MIT with terms requiring rights for commercial use.
- Models: HF `m-a-p/YuE2-3B` (7.26 GB safetensors, no quantization), `m-a-p/YuE2-Vae`; official clone origin `github.com/multimodal-art-projection/YuE` commit `1647252d` (2026-10-06).

## Capabilities
- No length parameter (same request gave 68 s and 168 s); ceiling about 6 minutes.
- Inputs: style tags, lyrics, cot mode, seed, abc score, cfg. No BPM, no negative prompt, no reference voice, no audio reference, no extend, no inpainting; any edit re-renders the whole song.
- Instrumental is a re-render with the vocal part moved to an instrument; "no vocals" is not guaranteed (about half leak vocals with the plain tag, community note).
- Model card languages: zh, en. Korean untested (one Korean song in the official demos).
- Output 48 kHz stereo FLAC 24-bit, mp3 320k; own mastering to -14 LUFS / -1 dBTP in every mode.
- Stems only through Demucs after the fact.

## Runtime on this workstation (10 finished jobs, logs 2026-10-27 to 11-04)
- Compute per second of audio: median 0.66 s (range 0.32–4.73); songs of 60 s or more: median 0.49 s; 168 s and 200 s songs took 57 s and 64 s.
- Whole job wall clock: median 45 s; 25–91 s when the GPU was free; one job 574 s, mostly waiting for another GPU hold.
- Peak VRAM 7.9–8.5 GB. Official card: RTX 4090, 214.85 s song in 71.04 s, peak 11.18 GiB, one song at a time.

## How it runs
- Standalone Python in WSL (not ComfyUI), Gradio UI on 127.0.0.1:7860 (off at audit time), CLI `scripts/mc doctor|gpu|generate`.
- GPU guard: one music job at a time (flock), waits up to 900 s while ComfyUI or an inference holds the card, then fails `GpuBusy`; holds through the arbiter; job limit 1200 s; if ComfyUI starts mid-job the job continues.
- Staff bridge already exists: `POST /api/production/jobs {studio:"music", params:{mode: song|bgm, style, lyrics, ...}}` on the admin host, staff token auth, 5 queued jobs per requester, worker `yagi-production-worker` (active) claims one job at a time and calls `scripts/mc generate`; outputs mp3 + wav through signed download links. No customer auth or billing. No music job has run through it yet (outputs folder empty).

## Quality notes in the workspace docs
- Raw YuE2: vocals -17.4 to -17.9 LUFS, BGM peaks clipping, narrow stereo, boxy low-mids; codec resonance peaks 320–7200 Hz, soft drum attacks (25 Hz frames), roll-off above 11 kHz.

## GPU now
`comfy_hold: false`, nothing running, about 88 GB free. ComfyUI, gpu-arbiter and the production worker are active.
