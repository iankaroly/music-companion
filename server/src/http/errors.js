// One error type with a status code, and one handler that renders it.
//
// Every failure a client can cause — a bad id, an unsupported file, anchors
// that go backwards — is thrown as an ApiError with the status it deserves.
// Everything else is a bug in this server and comes back as a 500 with its
// detail hidden in production, because an OMR stack trace names paths.

export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details);
export const notFound = (what) => new ApiError(404, `${what} not found`);
export const unsupported = (message) => new ApiError(415, message);
export const tooLarge = (message) => new ApiError(413, message);

/** Express error middleware. Must keep all four parameters to be recognised. */
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const body = {
    error: {
      message: status === 500 && process.env.NODE_ENV === 'production'
        ? 'internal error'
        : err.message,
      status,
      details: err.details ?? null,
    },
  };
  if (status >= 500) {
    // Log the real thing; the client gets the sanitised version above.
    console.error(`[${req.method} ${req.originalUrl}]`, err);
  }
  res.status(status).json(body);
}
