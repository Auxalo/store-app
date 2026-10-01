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

export class AlreadyExistsError extends Error {
  constructor(what: string) {
    super(`ALREADY_EXISTS:${what}`);
    this.name = "AlreadyExistsError";
  }
}
