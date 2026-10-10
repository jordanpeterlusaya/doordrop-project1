export function loginAuthErrorMessage(code: string): string {
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Nenosiri si sahihi.';
    case 'auth/user-not-found':
      return 'Akaunti hii haipo. Jisajili kwanza.';
    case 'auth/email-already-in-use':
      return 'Barua pepe tayari inatumika.';
    case 'auth/weak-password':
      return 'Nenosiri liwe angalau herufi 6.';
    case 'auth/invalid-email':
      return 'Barua pepe si sahihi.';
    case 'auth/too-many-requests':
      return 'Majaribio mengi. Jaribu tena baadaye.';
    default:
      if (/firebase/i.test(code) || code.startsWith('auth/')) return 'Imeshindwa. Jaribu tena.';
      return 'Imeshindwa. Jaribu tena.';
  }
}

export function swahiliError(message: string): string {
  const map: Record<string, string> = {
    'Shipment not found.': 'Mzigo haukupatikana.',
    'Not your shipment.': 'Mzigo huu si wa kampuni yako.',
    'Mark loaded first.': 'Weka alama ya kupakiwa kwanza.',
    'Mark arrived first.': 'Weka alama ya kufika kwanza.',
    'No company on this login.': 'Akaunti hii haijaunganishwa na kampuni.',
  };
  return map[message] || message || 'Imeshindwa. Jaribu tena.';
}
