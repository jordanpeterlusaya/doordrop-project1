const nav = document.querySelector("[data-nav]");
const burger = document.querySelector("[data-burger]");
const form = document.querySelector("[data-form]");
const note = document.querySelector("[data-note]");

burger?.addEventListener("click", () => nav?.classList.toggle("open"));

nav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => nav.classList.remove("open"));
});

const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const phoneOk = (value) => /^[+\d][\d\s-]{7,}$/.test(value.trim());

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll("input, textarea").forEach((field) => field.classList.remove("invalid"));
  note.className = "note";
  note.textContent = "";
  if (!String(data.name || "").trim()) {
    form.name.classList.add("invalid");
    note.classList.add("err");
    note.textContent = "Please enter your name.";
    return;
  }
  if (!emailOk(String(data.email || ""))) {
    form.email.classList.add("invalid");
    note.classList.add("err");
    note.textContent = "Please enter a valid email.";
    return;
  }
  if (!phoneOk(String(data.phone || ""))) {
    form.phone.classList.add("invalid");
    note.classList.add("err");
    note.textContent = "Please enter a valid phone number.";
    return;
  }
  if (String(data.message || "").trim().length < 12) {
    form.message.classList.add("invalid");
    note.classList.add("err");
    note.textContent = "Please enter a short message.";
    return;
  }
  note.classList.add("ok");
  note.textContent = "Thank you. Your enquiry has been recorded.";
  form.reset();
});
