/** A modal may intercept only the enquiry section on the page that actually owns the form. */
export function inquiryDestination(href: string, currentHref: string): URL | null {
  const current = new URL(currentHref);
  const destination = new URL(href, current);
  return destination.origin === current.origin
    && destination.pathname === current.pathname
    && destination.hash === '#brands' ? destination : null;
}

export function inquirySelections(destination: URL, types: readonly string[], useCases: readonly string[]) {
  const type = destination.searchParams.get('type');
  const useCase = destination.searchParams.get('useCase');
  return {
    type: type && types.includes(type) ? type : 'campaign',
    useCase: useCase && useCases.includes(useCase) ? useCase : 'undecided',
  };
}
