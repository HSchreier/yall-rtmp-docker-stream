// Shared validation constants — used by both AuthService (registration)
// and UsersService (admin edits to an existing account). Kept here rather
// than exported from AuthService so UsersService doesn't have to import
// from a sibling service just for a regex and a number.

// Email: RFC 5322 simplified — catches most valid emails, rejects obvious junk
export const EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Password: at least one uppercase, one lowercase, one digit, one special char
export const PASSWORD_COMPLEXITY_RE = /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])/;

// Stream key: alphanumeric + dash/underscore, exactly 32 chars (matches generateStreamKey output)
export const STREAM_KEY_FORMAT_RE = /^[A-Za-z0-9_-]{32}$/;

// RTMP URL: must start with rtmp:// or rtmps:// followed by valid characters
export const RTMP_URL_RE = /^rtmps?:\/\/[a-zA-Z0-9.-]+(:\d+)?\/[a-zA-Z0-9_.\-/]+$/;

// Bearer token: "Bearer " followed by at least one non-whitespace character
export const BEARER_TOKEN_RE = /^Bearer\s+[^\s]+$/;

// Stream key (for platform APIs like YouTube/Twitch): alphanumeric + dash, no spaces
export const STREAM_KEY_FORMAT_PLATFORM_RE = /^[a-zA-Z0-9_-]{10,200}$/;

export const MIN_PASSWORD_LENGTH = 12;
