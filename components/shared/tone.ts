/** The text colour class for a signed value: green above 0, red below 0. */
export function signTone(value: number): string {
  if (value > 0) return "text-long";
  if (value < 0) return "text-short";
  return "text-muted-foreground";
}
