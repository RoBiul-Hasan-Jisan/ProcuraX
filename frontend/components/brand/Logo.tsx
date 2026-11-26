/** ProcuraX mark: two beams crossing into an X, one steel, one amber (molten steel). Pure SVG, no assets. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="ProcuraX logo">
      <rect width="64" height="64" rx="14" fill="#12294a" />
      <path d="M15 14h13l21 36H36z" fill="#cbd5e1" />
      <path d="M49 14H36L15 50h13z" fill="#f59e0b" stroke="#12294a" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}
