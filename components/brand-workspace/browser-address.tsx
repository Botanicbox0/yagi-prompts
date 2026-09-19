'use client';
import { useEffect, useState } from 'react';
import { invitationBrowserAddress, PENDING_BRAND_INVITATION_KEY } from '@/lib/auth/invitation-transfer';

export function BrowserAddress({ target }: { target: string }) {
  const [address, setAddress] = useState(target);
  useEffect(() => {
    try { setAddress(invitationBrowserAddress(target, sessionStorage.getItem(PENDING_BRAND_INVITATION_KEY))); }
    catch { setAddress(target); }
  }, [target]);
  return <p data-webview-next className="mt-3 border border-hairline p-4 font-mono text-code break-all select-all">{address}</p>;
}
