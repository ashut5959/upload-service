// Errors that are expected, operational conditions (bad input, missing resource,
// conflicting state) rather than bugs. The global error handler exposes their
// `message` to clients even in production; anything else gets masked.
export class AppError extends Error {
  readonly status: number;
  readonly isOperational = true;
  readonly details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 404, details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, details);
  }
}
