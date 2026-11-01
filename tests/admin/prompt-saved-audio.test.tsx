import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaDrop } from '@/components/admin/media-drop';
import { mediaDropLabels, PromptFields, StagedMedia } from '@/components/admin/prompt-fields';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { adminMediaPath, authorizeAdminMedia, promptAdminRef } from '@/lib/media/admin-authorize';
import { loadPromptById, loadPromptBySlug } from '@/lib/prompts/repo';
import { parsePromptMedia } from '@/lib/prompts/schemas';
import { FIXTURE_USERS } from '../../scripts/fixtures';
import { seedPrompts } from '../../scripts/seed';
import { adminHarness, expectOk, upload, viewerOf, type AdminHarness } from '../helpers/admin';
import { runner } from '../helpers/pglite';

/**
 * Staff report (2026-11-02): an mp3 attached to a template "could not be checked after saving". The
 * file was saved, but the edit form only had a player for a file just picked, and the admin media
 * path knew poster and video only, so nothing on the admin could play the audio a row already has.
 */
describe('saved audio on the admin', () => {
  const dict = getDictionary('ko');
  let harness: AdminHarness;

  beforeEach(async () => {
    harness = await adminHarness();
    const sql = runner(harness.db);
    for (const user of Object.values(FIXTURE_USERS)) {
      await sql.query('insert into auth.users (id) values ($1) on conflict (id) do nothing', [user.id]);
      await sql.query(
        `insert into profiles (id, email, display_name, locale, plan, is_admin)
         values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing`,
        [user.id, user.email, user.displayName, user.locale, user.plan, user.isAdmin],
      );
    }
    await seedPrompts({ sql, storage: harness.storage });
  });

  afterEach(async () => harness.close());

  /** A published row with no audio, then the mp3 the staff member attached, through the real save. */
  async function saveAudio() {
    const before = (await loadPromptBySlug(runner(harness.db), 'neon-alley-dolly'))!;
    expect(parsePromptMedia(before.media).audio).toBeUndefined();
    expectOk(
      await harness.run('prompt.update', {
        id: before.id,
        slug: before.slug,
        title: before.title,
        titleKo: before.titleKo ?? '',
        promptText: before.promptText,
        useCase: 'tutorial',
        handle: '',
        textVisibility: before.textVisibility,
        featured: '',
        audio: upload('song.mp3', 'MP3-BYTES', 'audio/mpeg'),
      }),
    );
    return (await loadPromptById(runner(harness.db), before.id))!;
  }

  it('lets an admin, and only an admin, open the saved file', async () => {
    const row = await saveAudio();
    const ref = promptAdminRef(row.id, 'audio');

    const decision = await authorizeAdminMedia(runner(harness.db), viewerOf('admin'), ref);
    expect(decision.status).toBe('ok');
    if (decision.status !== 'ok') return;
    expect(decision.object.mime).toBe('audio/mpeg');
    expect(decision.object.bucket).toBe('content');
    expect(new TextDecoder().decode(await harness.storage.read('content', decision.object.key))).toBe('MP3-BYTES');

    expect(await authorizeAdminMedia(runner(harness.db), viewerOf('anon'), ref)).toEqual({ status: 'unauthorized' });
    expect(await authorizeAdminMedia(runner(harness.db), viewerOf('free'), ref)).toEqual({ status: 'forbidden' });
    expect(await authorizeAdminMedia(runner(harness.db), viewerOf('pro'), ref)).toEqual({ status: 'forbidden' });
  });

  it('answers not found for a row that has no audio', async () => {
    const row = (await loadPromptBySlug(runner(harness.db), 'neon-alley-dolly'))!;
    expect(await authorizeAdminMedia(runner(harness.db), viewerOf('admin'), promptAdminRef(row.id, 'audio'))).toEqual({
      status: 'not_found',
    });
  });

  it('says on the edit form that the row already has audio', async () => {
    const row = await saveAudio();
    const html = renderToStaticMarkup(<PromptFields row={row} dict={dict} />);
    expect(html).toContain('data-audio-existing');
    expect(html).toContain(dict.admin.mediaAudioSaved);
  });

  it('shows no saved audio on a row without one, or on the create form', async () => {
    const row = (await loadPromptBySlug(runner(harness.db), 'neon-alley-dolly'))!;
    expect(renderToStaticMarkup(<PromptFields row={row} dict={dict} />)).not.toContain('data-audio-existing');
    expect(renderToStaticMarkup(<PromptFields row={null} dict={dict} />)).not.toContain('data-audio-existing');
  });

  it('holds the player with a visible state until the saved file has loaded', () => {
    const html = renderToStaticMarkup(
      <MediaDrop
        videoName="video"
        posterName="poster"
        audioName="audio"
        labels={mediaDropLabels(dict.admin)}
        existingAudioSrc="/api/admin/media/x"
      />,
    );
    expect(html).toContain('data-audio-existing="loading"');
    expect(html).toContain(dict.admin.mediaAudioLoading);
  });

  it('plays the audio on the moderation panel too, even when it is the only media', async () => {
    const row = await saveAudio();
    const html = renderToStaticMarkup(<StagedMedia row={row} dict={dict} />);
    expect(html).toContain('<audio');
    expect(html).toContain(adminMediaPath(promptAdminRef(row.id, 'audio')).replace(/&/g, '&amp;'));

    const audioOnly = { ...row, media: { audio: parsePromptMedia(row.media).audio } } as typeof row;
    const alone = renderToStaticMarkup(<StagedMedia row={audioOnly} dict={dict} />);
    expect(alone).toContain('<audio');
    expect(alone).not.toContain(dict.admin.noMedia);
  });
});
