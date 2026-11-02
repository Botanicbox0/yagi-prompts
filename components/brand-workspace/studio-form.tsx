import type { ReactNode } from "react";
import { BACK_FIELD, OP_FIELD } from "@/lib/admin/form";
import { BRAND_STUDIO_ACTION_PATH, type BrandHostStudioOperation } from "@/lib/admin/brand-host-studio";

/**
 * `OpForm` for brand.twings.app, where `/admin/do` is closed: the same JS-free multipart POST, to the
 * brand host's studio door instead. `op` is typed to that door's allowlist, so a panel cannot point
 * it at any other registered operation.
 */
export function StudioForm({ op, back, children, className }: {
  op: BrandHostStudioOperation;
  /** A brand campaign page; the door refuses anything else. */
  back: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <form method="post" action={BRAND_STUDIO_ACTION_PATH} encType="multipart/form-data" className={className}>
      <input type="hidden" name={OP_FIELD} value={op} />
      <input type="hidden" name={BACK_FIELD} value={back} />
      {children}
    </form>
  );
}
