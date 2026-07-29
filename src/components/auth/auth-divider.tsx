export function AuthDivider({ label = "or continue with email" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
