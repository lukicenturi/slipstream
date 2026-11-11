/** The result of a reverse lookup for many addresses. */
export interface NameLookup {
  /** Lower-case address -> name. Only addresses with a name. */
  names: Map<string, string>;
  /** False when some addresses could not be checked (an upstream call failed). */
  complete: boolean;
}

/** Thrown when an upstream name service fails (not for "no such name"). */
export class NameServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "NameServiceError";
  }
}
