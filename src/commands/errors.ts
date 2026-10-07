export class PermissionError extends Error {
  constructor(public readonly permission: string) {
    super(`PERMISSION_DENIED:${permission}`);
    this.name = "PermissionError";
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`NOT_FOUND:${what}`);
    this.name = "NotFoundError";
  }
}

/** The request is fine, but the record is in a state where it cannot be done. */
export class ConflictError extends Error {
  constructor(public readonly code: string) {
    super(`CONFLICT:${code}`);
    this.name = "ConflictError";
  }
}

export class AlreadyExistsError extends Error {
  constructor(what: string) {
    super(`ALREADY_EXISTS:${what}`);
    this.name = "AlreadyExistsError";
  }
}
