export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Password rule shared with the backend (AuthDtos / UserDtos). Returns an error message or null. */
export function passwordError(pw) {
  if (pw.length < 8 || pw.length > 72) return "Password must be 8-72 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain at least one letter and one number";
  return null;
}

// Mirrors the backend rules in AuthDtos.RegisterRequest so users see problems before submitting.
export function validateRegistration(f) {
  const v = {};
  if (!f.firstName.trim()) v.firstName = "First name is required";
  if (!f.lastName.trim()) v.lastName = "Last name is required";
  if (!EMAIL_RE.test(f.email.trim())) v.email = "Enter a valid email address";
  const pw = passwordError(f.password);
  if (pw) v.password = pw;
  if (f.confirm !== f.password) v.confirm = "Passwords do not match";
  return v;
}
