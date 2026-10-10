export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Nenosiri liwe angalau herufi 8.';
  if (!/[A-Za-z]/.test(password)) return 'Nenosiri liwe na herufi angalau moja.';
  if (!/\d/.test(password)) return 'Nenosiri liwe na namba angalau moja.';
  return null;
}

export function passwordsMatch(password: string, confirm: string): string | null {
  if (password !== confirm) return 'Nenosiri halifanani.';
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
