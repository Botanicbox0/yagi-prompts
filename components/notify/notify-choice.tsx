import type { Dictionary } from '@/lib/i18n/dictionaries';
import { pushPublicKey } from '@/lib/notify/push';
import type { RenderStatus } from '@/lib/renders/repo';
import { InstallCard } from '@/components/pwa/install-card';
import { NotifyChoicePanel } from './notify-choice-panel';

/**
 * The completion-notice choice, one line per page (docs/PLATFORM-2.0.md §5.2–§5.3):
 *
 *   /renders/{id} waiting (queued · running · held) → "완성되면 알려드릴까요?"
 *   /renders/{id} succeeded                         → the one-time install card
 *   /account                                        → the same choice as a setting, then the card
 *
 * A server component on purpose: it reads the VAPID public key from the environment (null when
 * push is off here) and hands the browser that key and nothing else. The install card promises a
 * completion alert, so it only appears where push actually exists; on /account the choice already
 * walks an iPhone through the home screen, so the card there is Android's alone.
 */
export function NotifyChoice({ dict, context, status }: { dict: Dictionary; context: 'render' | 'account'; status?: RenderStatus }) {
  const copy = dict.appShell;
  const publicKey = pushPublicKey();
  if (context === 'render') {
    if (status === 'succeeded') return publicKey === null ? null : <InstallCard copy={copy.install} />;
    if (status !== 'queued' && status !== 'running' && status !== 'held') return null;
    return <NotifyChoicePanel copy={copy.notify} iosHelp={copy.install.iosBody} publicKey={publicKey} mode="ask" />;
  }
  return (
    <>
      <NotifyChoicePanel copy={copy.notify} iosHelp={copy.install.iosBody} publicKey={publicKey} mode="settings" />
      {publicKey !== null && <InstallCard copy={copy.install} allowed={['android']} />}
    </>
  );
}
