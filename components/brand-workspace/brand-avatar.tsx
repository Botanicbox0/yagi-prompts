/**
 * A brand's logo, or its first letter when it has none. Always shown next to the brand name, so the
 * image itself is decorative (`alt=""`) and screen readers hear the name once, from the text.
 * `logoUrl` is only ever the private, re-authorized logo route; never a remote address.
 */
export function BrandAvatar({ name, logoUrl, size = "md" }: { name: string; logoUrl: string | null; size?: "sm" | "md" }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "";
  return (
    <span className="bw-brand-avatar" data-size={size} data-brand-avatar={logoUrl ? "logo" : "initial"} aria-hidden="true">
      {logoUrl ? <img src={logoUrl} alt="" width={36} height={36} decoding="async" /> : initial}
    </span>
  );
}
