// Shared validation constants — used by both AuthService (registration)
// and UsersService (admin edits to an existing account). Kept here rather
// than exported from AuthService so UsersService doesn't have to import
// from a sibling service just for a regex and a number.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 12;
