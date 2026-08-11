/** PLAN §3.9 — UI strings as dictionary modules. `en` is the shape; `ko` must match it. */
export const en = {
  meta: {
    siteName: 'PLAYBOOK',
    tagline: 'The open production floor of an AI studio.',
  },
  nav: {
    library: 'Library',
    pricing: 'Pricing',
    account: 'Account',
    admin: 'Admin',
    localeToggle: 'Language',
    localeEn: 'EN',
    localeKo: 'KO',
    menu: 'Menu',
    close: 'Close',
  },
  auth: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    startWithGoogle: 'Start with Google',
    continueWithGoogle: 'Continue with Google',
    signedInAs: 'Signed in as',
    signInRequired: 'Sign in to open the library.',
    adminOnly: 'Admins only.',
  },
  plan: {
    free: 'Free',
    pro: 'Pro',
    upgrade: 'Unlock every prompt — $9/mo',
    locked: 'Unlock with Pro',
    lockedPrompt: 'Prompt — unlock with Pro',
    lockedParams: 'Parameters — unlock with Pro',
    lockedWorkflow: 'Workflow file — unlock with Pro',
  },
  footer: {
    hireCta: 'Work with the studio',
    advertise: 'Advertise here',
    rights: 'YAGI Workshop',
    privacy: 'Privacy',
    terms: 'Terms',
  },
  ad: {
    placeholder: 'YOUR AD HERE',
    contact: 'advertise@yagiworkshop.xyz',
  },
} as const;

/**
 * Keys are strict, values are widened to `string`: `ko` must define every key `en` defines
 * (and no extras) without being forced to equal the English copy.
 */
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

export type Dictionary = Widen<typeof en>;
