document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('section').forEach((sec) => {
    if (
      sec.classList.contains('open') ||
      sec.classList.contains('no-collapse') ||
      sec.classList.contains('request-form-section')
    ) {
      return;
    }
    const h2 = sec.querySelector('h2');
    if (!h2) return;
    h2.addEventListener('click', () => {
      sec.classList.toggle('collapsed');
    });
  });

  const printBtn = document.getElementById('printBtn');
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  const form = document.getElementById('deleteAccountForm');
  if (!form) return;

  const errorEl = document.getElementById('formError');
  const successEl = document.getElementById('formSuccess');

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
    if (successEl) {
      successEl.hidden = true;
      successEl.textContent = '';
    }

    const fullName = String(form.fullName?.value || '').trim();
    const phone = String(form.phone?.value || '').trim();
    const email = String(form.email?.value || '').trim();
    const accountContact = String(form.accountContact?.value || '').trim() || phone || email;
    const reason = String(form.reason?.value || form.notes?.value || '').trim();
    const confirmed = form.confirmDelete ? Boolean(form.confirmDelete.checked) : true;

    if (!fullName || !accountContact || !confirmed) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent =
          'Tafadhali jaza jina na simu/barua pepe. Please complete the required fields.';
      }
      return;
    }

    const body = [
      'Ombi la kufuta akaunti ya doordrop / Account deletion request',
      '',
      `Jina / Name: ${fullName}`,
      `Akaunti (simu/email) / Account contact: ${accountContact}`,
      phone && email ? `Phone: ${phone}` : null,
      phone && email ? `Email: ${email}` : null,
      `Sababu / Reason: ${reason || '—'}`,
      '',
      'Ninathibitisha ninataka akaunti yangu na data zangu binafsi zifutwe.',
      'I confirm I want my doordrop account and personal data deleted.',
    ]
      .filter(Boolean)
      .join('\n');

    const mailto =
      'mailto:doordrop225@gmail.com' +
      '?subject=' +
      encodeURIComponent('Delete my doordrop account') +
      '&body=' +
      encodeURIComponent(body);

    window.location.href = mailto;

    if (successEl) {
      successEl.hidden = false;
      successEl.textContent =
        'Fungua barua pepe yako kutuma ombi. Open your email app to send the request. Tutakamilisha ndani ya siku 30 baada ya uthibitisho.';
    }
  });
});
