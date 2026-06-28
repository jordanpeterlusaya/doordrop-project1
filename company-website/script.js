const menuToggle = document.querySelector("[data-menu-toggle]");
const navMenu = document.querySelector(".nav");
const navLinks = document.querySelectorAll(".nav-links a");
const counterElements = document.querySelectorAll("[data-counter]");
const revealElements = document.querySelectorAll(".reveal");
const contactForm = document.querySelector("[data-contact-form]");
const feedback = document.querySelector("[data-form-feedback]");
const actionButtons = document.querySelectorAll(".btn");
const header = document.querySelector(".site-header");

// Handle mobile navigation toggling.
const closeMenu = () => {
  if (!menuToggle || !navMenu) {
    return;
  }

  menuToggle.setAttribute("aria-expanded", "false");
  navMenu.classList.remove("is-open");
};

if (menuToggle && navMenu) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    navMenu.classList.toggle("is-open", !isOpen);
  });

  document.addEventListener("click", (event) => {
    if (!navMenu.classList.contains("is-open")) {
      return;
    }

    if (navMenu.contains(event.target) || menuToggle.contains(event.target)) {
      return;
    }

    closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    const targetId = link.getAttribute("href");

    if (targetId && targetId.startsWith("#")) {
      const targetSection = document.querySelector(targetId);

      if (targetSection) {
        event.preventDefault();

        const headerOffset = header ? header.offsetHeight : 0;
        const targetTop =
          targetSection.getBoundingClientRect().top + window.scrollY - headerOffset - 16;

        window.scrollTo({
          top: Math.max(targetTop, 0),
          behavior: "smooth",
        });
      }
    }

    if (!menuToggle || !navMenu) {
      return;
    }

    closeMenu();
  });
});

// Reveal sections with a soft upward motion as they enter view.
const revealObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      entry.target.classList.add("visible");
      observer.unobserve(entry.target);
    });
  },
  {
    threshold: 0.18,
    rootMargin: "0px 0px -40px 0px",
  }
);

revealElements.forEach((element) => {
  revealObserver.observe(element);
});

// Animate trust stats once the numbers are visible.
const animateCounter = (element) => {
  const target = Number(element.dataset.counter || 0);
  const duration = 1800;
  const startTime = performance.now();

  const updateCounter = (currentTime) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.floor(target * eased);

    element.textContent = formatCounter(value, target);

    if (progress < 1) {
      window.requestAnimationFrame(updateCounter);
    }
  };

  window.requestAnimationFrame(updateCounter);
};

const formatCounter = (value, target) => {
  if (target >= 1000) {
    return `${value.toLocaleString()}+`;
  }

  return `${value}+`;
};

const counterObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      animateCounter(entry.target);
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.5 }
);

counterElements.forEach((element) => {
  counterObserver.observe(element);
});

const validateEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const validatePhone = (value) => /^[+\d][\d\s-]{7,}$/.test(value.trim());

if (contactForm && feedback) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const formData = new FormData(contactForm);
    const entries = Object.fromEntries(formData.entries());
    const fields = Array.from(contactForm.querySelectorAll("input, textarea"));
    const nameField = contactForm.querySelector("#name");
    const emailField = contactForm.querySelector("#email");
    const phoneField = contactForm.querySelector("#phone");
    const messageField = contactForm.querySelector("#message");

    fields.forEach((field) => field.classList.remove("invalid"));
    feedback.className = "form-feedback";
    feedback.textContent = "";

    const errors = [];

    if (!String(entries.name || "").trim()) {
      errors.push("Please enter your name.");
      nameField?.classList.add("invalid");
    }

    if (!validateEmail(String(entries.email || ""))) {
      errors.push("Please enter a valid email address.");
      emailField?.classList.add("invalid");
    }

    if (!validatePhone(String(entries.phone || ""))) {
      errors.push("Please enter a valid phone number.");
      phoneField?.classList.add("invalid");
    }

    if (String(entries.message || "").trim().length < 12) {
      errors.push("Please write a message with at least 12 characters.");
      messageField?.classList.add("invalid");
    }

    if (errors.length > 0) {
      feedback.classList.add("error");
      feedback.textContent = errors[0];
      return;
    }

    feedback.classList.add("success");
    feedback.textContent =
      "Thank you. Your message looks ready to send. Connect this form to your backend when needed.";
    contactForm.reset();
  });
}

// Add a subtle ripple on primary interactions.
actionButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    const ripple = document.createElement("span");
    ripple.className = "btn-ripple";

    const rect = button.getBoundingClientRect();
    const x = event.clientX ? event.clientX - rect.left : rect.width / 2;
    const y = event.clientY ? event.clientY - rect.top : rect.height / 2;

    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;

    button.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  });
});

// Deepen the header once the page moves beyond the hero.
const syncHeaderState = () => {
  if (!header) {
    return;
  }

  header.classList.toggle("is-scrolled", window.scrollY > 24);
};

syncHeaderState();
window.addEventListener("scroll", syncHeaderState, { passive: true });
