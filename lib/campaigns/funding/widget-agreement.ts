export interface FundingAgreementWidget {
  on(
    event: "agreementStatusChange",
    callback: (status: { agreedRequiredTerms: boolean }) => void,
  ): void;
  // Present in the official v2/standard runtime; feature-detect because its public types omit it.
  getAgreementStatus?: () => Promise<{ agreedRequiredTerms: boolean }>;
}

export async function observeFundingAgreement(
  widget: FundingAgreementWidget,
  setAgreed: (agreed: boolean) => void,
) {
  let changed = false;
  widget.on("agreementStatusChange", (status) => {
    changed = true;
    setAgreed(status.agreedRequiredTerms === true);
  });
  if (!widget.getAgreementStatus) return;
  const initial = await widget.getAgreementStatus();
  // A checkbox change while the snapshot is in flight is newer than that snapshot.
  if (!changed) setAgreed(initial.agreedRequiredTerms === true);
}
