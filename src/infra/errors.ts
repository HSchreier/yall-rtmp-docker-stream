// Typed error hierarchy — docs/TECHNICAL.md §Error handling, logging & try/catch discipline.
// HttpApi's central error wrapper checks `instanceof AppError` to pick a response;
// anything else becomes a generic 500 with no detail in the body.

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly status = 400;
  readonly code = "VALIDATION_ERROR";
}

export class AuthError extends AppError {
  readonly status = 401;
  readonly code = "AUTH_ERROR";

  constructor(message = "Unauthorized") {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = "FORBIDDEN";

  constructor(message = "Forbidden") {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = "NOT_FOUND";

  constructor(message = "Not found") {
    super(message);
  }
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = "CONFLICT";
}

export class UpstreamError extends AppError {
  readonly status = 503;
  readonly code = "UPSTREAM_ERROR";
}
