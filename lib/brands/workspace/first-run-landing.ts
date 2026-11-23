/** Where `organization.create` lands once a brand finishes onboarding. */
export function resolveFirstRunLanding(studioV2Open: boolean): '/brand/home' | '/brand' {
  return studioV2Open ? '/brand/home' : '/brand';
}
