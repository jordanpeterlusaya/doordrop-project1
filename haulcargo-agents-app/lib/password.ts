export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(password)) return 'Password must include at least one letter.';
  if (!/\d/.test(password)) return 'Password must include at least one number.';
  return null;
}

export function passwordsMatch(password: string, confirm: string): string | null {
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

/** Strong random password for Firebase account bootstrap (phone OTP is primary login). */
export function generateAccountPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let out = 'Ha1!';
  for (let i = 0; i < 20; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
